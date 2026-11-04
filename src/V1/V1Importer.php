<?php

namespace App\V1;

use App\Api\Input\EntryText;
use App\Day\Objective;
use App\Day\Quarter;
use App\Day\SlotContent;
use App\Day\UserCalendar;
use App\Entity\Day;
use App\Entity\DaySend;
use App\Entity\EmptyDayWatch;
use App\Entity\Favorite;
use App\Entity\JiraConnection;
use App\Entity\Settings;
use App\Entity\Ticket;
use App\Entity\V1Import;
use App\Jira\JiraAccount;
use App\Jira\JiraAddress;
use App\Jira\JiraClient;
use App\Jira\TokenCipher;
use App\Sending\Worklog;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Le passage de la v1 à la v2, au premier démarrage : journées, objectifs, saisies,
 * pauses, commentaires, dernier envoi, favoris, et le Jira de l'ancien fichier.
 *
 * Il se fait une fois, en entier ou pas du tout, et l'ancienne base n'est jamais touchée.
 * Ce que la v2 refuserait n'est ni arrondi ni deviné : c'est laissé de côté et gardé pour
 * l'écran. Une journée envoyée qui y perd une saisie se dit modifiée : Jira peut en avoir
 * plus qu'elle n'en montre.
 *
 * Aucun appel à Jira ici : le démarrage n'attend pas le réseau. Le compte que le jeton
 * représente se confirme à la première réponse de Jira (JiraLink::record).
 *
 * @phpstan-import-type LeftOut from V1Import
 */
final readonly class V1Importer
{
    /** Les journées écrites avant de vider la mémoire : une base de plusieurs années tient dans la limite de PHP. */
    private const int BATCH = 50;

    private const string V1_TIME = '!Y-m-d H:i:s';

    public function __construct(
        private EntityManagerInterface $entityManager,
        private TokenCipher $cipher,
        private JiraClient $jira,
        private UserCalendar $calendar,
        private ClockInterface $clock,
        #[Autowire('%env(resolve:DAYTRACK_V1_DATABASE)%')]
        private string $path,
    ) {
    }

    /**
     * @throws \RuntimeException l'ancienne base ne se lit pas : rien n'est écrit
     */
    public function import(?V1Jira $v1Jira): V1ImportResult
    {
        if (!is_file($this->path)) {
            return V1ImportResult::NoV1Base;
        }

        $done = $this->entityManager->getRepository(V1Import::class)->findOneBy([]);
        if (null !== $done) {
            clearstatcache(true, $this->path);

            // Revenu en v1 puis repassé en v2 : ce qui y a été saisi entre-temps n'est pas repris.
            return filemtime($this->path) > $done->importedAt->getTimestamp() ? V1ImportResult::V1ChangedSince : V1ImportResult::AlreadyDone;
        }

        // Le point de départ des jours vides n'est pas une donnée : la migration le pose
        // avant toute reprise.
        foreach ([Day::class, Favorite::class, JiraConnection::class, Settings::class] as $entity) {
            if ($this->count($entity) > 0) {
                return V1ImportResult::V2InUse;
            }
        }

        $v1 = V1Database::read($this->path);
        $connection = $this->entityManager->getConnection();
        $connection->beginTransaction();

        try {
            $jira = null === $v1Jira ? null : $this->linkJira($v1Jira);
            $leftOut = $this->writeDays($v1, $jira);
            $leftOut['favorites'] = $this->writeFavorites($v1);
            $this->writeTickets($v1);
            $now = $this->clock->now();
            $this->watchEmptyDaysFrom($now);
            $this->entityManager->persist(new V1Import($now, $leftOut));
            $this->entityManager->flush();
            $connection->commit();
        } catch (\Throwable $exception) {
            if ($connection->isTransactionActive()) {
                $connection->rollBack();
            }

            throw $exception;
        }

        $this->entityManager->clear();

        return V1ImportResult::Done;
    }

    /**
     * Les journées reprises sont d'avant la reprise : le point de départ des jours vides
     * passe à son heure, et aucun congé de la v1, vide, ne se signale « Incomplet ».
     */
    private function watchEmptyDaysFrom(\DateTimeImmutable $importedAt): void
    {
        $watch = $this->entityManager->getRepository(EmptyDayWatch::class)->findOneBy([]);

        if (null === $watch) {
            $this->entityManager->persist(new EmptyDayWatch($importedAt));
        } else {
            $watch->notBefore($importedAt);
        }
    }

    /**
     * @param class-string $entity
     */
    private function count(string $entity): int
    {
        return $this->entityManager->getRepository($entity)->count();
    }

    /**
     * Un fichier inutilisable — l'adresse d'exemple du modèle de la v1, par exemple — ne
     * reliait rien : la bienvenue s'affiche, plutôt qu'un bandeau de refus incompréhensible.
     */
    private function linkJira(V1Jira $v1Jira): ?JiraConnection
    {
        $address = JiraAddress::parse($v1Jira->address);

        if (null === $address || ('https://api.atlassian.com' === $address->site)) {
            return null;
        }

        $connection = new JiraConnection(
            $address->site,
            $this->jira->apiFor($address),
            $address->cloudId ?? $address->site,
            $v1Jira->email,
            $this->cipher->encrypt($v1Jira->token),
            new JiraAccount(JiraConnection::UNCONFIRMED, ''),
        );
        $this->entityManager->persist($connection);
        $this->entityManager->flush();

        return $connection;
    }

    /**
     * @return LeftOut
     */
    private function writeDays(V1Database $v1, ?JiraConnection $jira): array
    {
        $leftOut = ['entries' => [], 'objectives' => [], 'favorites' => []];
        $pending = 0;

        foreach ($v1->days as $v1Day) {
            $date = UserCalendar::date($v1Day->date);
            $objective = self::nearestObjective($v1Day->target);

            if ($objective !== $v1Day->target) {
                $leftOut['objectives'][] = ['date' => $v1Day->date, 'from' => $v1Day->target, 'to' => $objective];
            }

            $refused = [];
            $changes = null === $date ? [] : self::quarters($v1Day, $refused);
            if (null === $date) {
                $refused = array_map(self::leftOutEntry(...), $v1Day->entries);
            }
            $leftOut['entries'] = [...$leftOut['entries'], ...$refused];

            // Les tickets touchés se gardent même sans heure d'envoi : c'est ce qui permet de
            // retirer de Jira les heures d'un ticket sorti de la journée.
            $touched = array_values(array_filter(array_map(EntryText::ticket(...), $v1Day->syncedTickets), self::isTicket(...)));
            $sentAt = null === $v1Day->syncedAt ? null : self::v1Time($v1Day->syncedAt);

            // Une journée vide à l'objectif habituel se lit déjà ainsi sans ligne.
            if (null === $date || ([] === $changes && Objective::HABITUAL === $objective && [] === $touched)) {
                continue;
            }

            $day = new Day($date, $objective);
            if (Objective::HABITUAL !== $objective) {
                $day->chooseObjective($objective);
            }
            $day->change($changes);
            $this->entityManager->persist($day);

            $worklogs = Worklog::ofDay($day->grid(), $date, $this->calendar);
            if ([] !== $touched || (null !== $sentAt && [] !== $worklogs)) {
                $this->entityManager->persist(DaySend::fromV1($day, $jira, $sentAt, $worklogs, [] === $refused, $touched));
            }

            if (++$pending >= self::BATCH) {
                $this->entityManager->flush();
                $this->entityManager->clear();
                $pending = 0;
            }
        }

        $this->entityManager->flush();
        $this->entityManager->clear();

        return $leftOut;
    }

    /**
     * Les quarts d'heure de la journée, saisie après saisie. Une saisie que la v2 refuse
     * reste entière de côté : la moitié d'une saisie serait une heure inventée. Sur un
     * chevauchement, la première venue dans la journée reste.
     *
     * @param list<array{date: string, start: string, end: ?string, ticket: ?string}> $refused
     *
     * @param-out list<array{date: string, start: string, end: ?string, ticket: ?string}> $refused
     *
     * @return array<int, SlotContent>
     */
    private static function quarters(V1Day $day, array &$refused): array
    {
        $changes = [];

        foreach ($day->entries as $entry) {
            $quarters = self::quartersOf($entry, $day->date);
            $content = self::contentOf($entry);

            if (null === $quarters || null === $content || [] !== array_intersect_key(array_flip($quarters), $changes)) {
                $refused[] = self::leftOutEntry($entry, $day->date);
                continue;
            }

            foreach ($quarters as $quarter) {
                $changes[$quarter] = $content;
            }
        }

        return $changes;
    }

    /**
     * @return list<int>|null null si la saisie ne tient pas dans la grille de ce jour
     */
    private static function quartersOf(V1Entry $entry, string $date): ?array
    {
        $start = self::v1Time($entry->startedAt);
        $end = null === $entry->endedAt ? null : self::v1Time($entry->endedAt);

        if (null === $start || null === $end || $date !== $start->format('Y-m-d') || $date !== $end->format('Y-m-d')) {
            return null;
        }

        $from = Quarter::parse($start->format('H:i'));
        $to = Quarter::parse($end->format('H:i'));

        if (null === $from || null === $to || '00' !== $start->format('s') || '00' !== $end->format('s')
            || !Quarter::isBoundary($from) || !Quarter::isBoundary($to) || $from >= $to) {
            return null;
        }

        return Quarter::between($from, $to);
    }

    private static function contentOf(V1Entry $entry): ?SlotContent
    {
        if ('break' === $entry->type) {
            return SlotContent::pause();
        }

        $ticket = EntryText::ticket($entry->ticket);

        return 'work' === $entry->type && self::isTicket($ticket) ? SlotContent::work($ticket, self::line($entry->comment, 500)) : null;
    }

    /**
     * @phpstan-assert-if-true string $ticket
     */
    private static function isTicket(?string $ticket): bool
    {
        return null !== $ticket && \strlen($ticket) <= EntryText::TICKET_MAX && 1 === preg_match(EntryText::TICKET_PATTERN, $ticket);
    }

    /** Un texte d'une ligne, comme l'écran l'exige : un saut de ligne de la v1 devient une espace, rien ne se perd. */
    private static function line(?string $text, int $max): ?string
    {
        $line = EntryText::line(null === $text ? null : preg_replace('/[\p{Cc}\p{Zl}\p{Zp}]+/u', ' ', $text) ?? $text);

        return null === $line ? null : mb_substr($line, 0, $max);
    }

    /**
     * @return array{date: string, start: string, end: ?string, ticket: ?string}
     */
    private static function leftOutEntry(V1Entry $entry, ?string $date = null): array
    {
        return [
            'date' => $date ?? substr($entry->startedAt, 0, 10),
            'start' => substr($entry->startedAt, 11, 5),
            'end' => null === $entry->endedAt ? null : substr($entry->endedAt, 11, 5),
            'ticket' => $entry->ticket,
        ];
    }

    /** La valeur permise la plus proche : au quart d'heure, de 0h00 à 13h00. */
    private static function nearestObjective(int $target): int
    {
        $quarters = (int) round($target / Quarter::MINUTES);

        return max(Objective::MIN, min(Objective::MAX, $quarters * Quarter::MINUTES));
    }

    /** La v1 écrit l'heure sans fuseau. */
    private static function v1Time(string $time): ?\DateTimeImmutable
    {
        $parsed = \DateTimeImmutable::createFromFormat(self::V1_TIME, $time, new \DateTimeZone('UTC'));

        return false === $parsed ? null : $parsed;
    }

    /**
     * La liste garde l'ordre de la v1, sans trou, et un seul favori par ticket.
     *
     * @return list<string> les favoris qui n'ont pas la forme d'un ticket : la v2 les refuserait
     */
    private function writeFavorites(V1Database $v1): array
    {
        $position = 0;
        $seen = [];
        $refused = [];

        foreach ($v1->favorites as $favorite) {
            $ticket = EntryText::ticket($favorite->ticket);

            if (!self::isTicket($ticket)) {
                $refused[] = $favorite->ticket;
                continue;
            }

            if (isset($seen[$ticket])) {
                continue;
            }

            $seen[$ticket] = true;
            $this->entityManager->persist(new Favorite($ticket, self::line($favorite->name, Favorite::NAME_MAX), $position++));
        }

        $this->entityManager->flush();
        $this->entityManager->clear();

        return $refused;
    }

    /**
     * Le titre que la v1 gardait s'affiche en attendant que Jira réponde : à relire, comme
     * un ticket dont le site vient de changer. Son type, lui, attend Jira.
     */
    private function writeTickets(V1Database $v1): void
    {
        $titles = [];

        foreach ($v1->days as $day) {
            foreach ($day->entries as $entry) {
                $key = EntryText::ticket($entry->ticket);
                if (self::isTicket($key)) {
                    $titles[$key] = $entry->title ?? $titles[$key] ?? null;
                }
            }
        }
        foreach ($v1->favorites as $favorite) {
            $key = EntryText::ticket($favorite->ticket);
            if (self::isTicket($key)) {
                $titles[$key] ??= $favorite->title;
            }
        }

        foreach ($titles as $key => $title) {
            $ticket = new Ticket($key);
            $line = self::line($title, Ticket::TITLE_MAX);
            if (null !== $line) {
                $ticket->remember($line);
            }
            $this->entityManager->persist($ticket);
        }

        $this->entityManager->flush();
        $this->entityManager->clear();
    }
}
