<?php

namespace App\Day;

use App\Database\LockedTransaction;
use App\Entity\Day;
use App\Entity\Recurrence;
use App\Entity\RecurrenceSkip;
use App\Recurrence\RecurrenceClash;
use App\Recurrence\RecurrenceForecast;
use App\Recurrence\RecurrencePoser;
use App\Recurrence\RecurrenceRefused;
use App\Recurrence\RecurrenceSpec;
use App\Recurrence\SeenRecurrence;
use App\Recurrence\UntilChange;
use App\Recurrence\UntilRewind;
use App\Repository\DayRepository;
use App\Repository\DaySendRepository;
use App\Repository\RecurrenceRepository;
use App\Sending\SendClosure;
use App\Settings\UserSettings;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Le seul chemin par lequel une journée s'écrit.
 *
 * Un geste s'applique en entier ou pas du tout, et seulement sur la version de la
 * journée qu'il a vue : celui d'un onglet en retard est refusé, sans rien écrire. Les
 * récurrences se posent avant (RecurrencePoser) : le geste se juge sur la journée qui
 * les a reçues.
 *
 * Un jour à venir se juge sur ce qu'il montre, ses fois prévues comprises
 * (RecurrenceForecast) : un geste qui en touche une la pose pour de bon, détachée, et
 * rien ne la prévoit plus ; annuler la rend à la prévision, sans rien écrire.
 */
final readonly class DayWriter
{
    public function __construct(
        private EntityManagerInterface $entityManager,
        private LockedTransaction $transaction,
        private DayRepository $days,
        private UserSettings $settings,
        private RecurrenceRepository $recurrences,
        private RecurrencePoser $poser,
        private UserCalendar $calendar,
        private RecurrenceForecast $forecast,
        private SendClosure $closure,
        private DaySendRepository $sends,
    ) {
    }

    /**
     * Un geste de la grille. Il ne change que cette fois d'une récurrence : un quart d'heure
     * qu'il lui prend détache la fois entière (Day::change), que rien ne repose plus.
     * Annuler et rétablir la lui rendent, par $links, et rendent leur fin aux récurrences
     * qu'un geste de la fenêtre avait changées, par $rewinds. Jamais sur une journée mise à
     * 0h00, ni sur un jour à venir non travaillé : la fois revient à sa série sans s'y écrire
     * (returned), et rétablir la détache de nouveau, par $detaches.
     *
     * @param array<int, ?SlotContent> $changes  chaque quart d'heure nommé, par son début, et ce qu'il devient
     * @param array<int, Uuid>         $links    la récurrence qui pose chacun, parmi $changes ; déjà vérifiée (LinksMatchRecurrences)
     * @param list<UntilRewind>        $rewinds
     * @param bool                     $restores annuler : une fois prévue qu'il réécrit lui cède (changeOccurrences)
     * @param list<Uuid>               $detaches rétablir : les récurrences dont l'annulation a rendu la fois à sa série
     *
     * @return ?Day la journée écrite, ou null si le geste ne fait que vider une
     *              journée qui n'existe pas encore : elle reste sans ligne
     *
     * @throws StaleDay
     * @throws RecurrenceRefused
     */
    public function changeSlots(\DateTimeImmutable $date, int $version, array $changes, array $links = [], array $rewinds = [], bool $restores = false, array $detaches = []): ?Day
    {
        $this->poser->pose();

        // Un jour jamais saisi ne naît que de ce que le geste y saisit (write) : effacer, ou
        // rendre une fois à sa prévision, ne le crée pas.
        return $this->write($date, $version, [] !== $rewinds, function (Day $day, array $planned) use ($date, $changes, $links, $rewinds, $restores, $detaches): void {
            // Chacune lue une fois, sous le verrou : chargée plus tôt pour vérifier les liens
            // du geste (LinksMatchRecurrences), sa fin a pu changer depuis dans un autre onglet.
            $read = [];
            foreach ([...array_map(static fn (UntilRewind $rewind): Uuid => $rewind->recurrence, $rewinds), ...$links] as $id) {
                $read[$id->toRfc4122()] ??= $this->lockedRecurrence($id) ?? throw new StaleDay();
            }
            foreach ($rewinds as $rewind) {
                $recurrence = $read[$rewind->recurrence->toRfc4122()];
                // Annuler ne rend qu'une fin qu'elle a eue, jamais d'avant la veille de son
                // premier jour : un autre appelant que la page n'obtient rien de plus.
                if ($recurrence->until?->format('Y-m-d') !== $rewind->from?->format('Y-m-d')
                    || (null !== $rewind->to && $rewind->to < $recurrence->withdrawnUntil())) {
                    throw new StaleDay();
                }
                $this->endOn($recurrence, $rewind->to);
            }
            // Une récurrence déplacée — coupée avec les suivantes, puis collée ailleurs — ne revit
            // pas à ses deux places : annuler la coupe attend qu'on ait annulé le collage, et
            // rétablir le collage, qu'on ait rétabli la coupe. Le geste se refuse, et dit lequel.
            foreach ($rewinds as $rewind) {
                if (self::isLonger($rewind->to, $rewind->from)) {
                    $this->assertMoved($read[$rewind->recurrence->toRfc4122()], $read);
                }
            }
            // Une fin rendue qui la prolonge ne la ramène pas sur un créneau qu'une autre a pris
            // depuis : jamais deux récurrences sur un créneau. Le geste se refuse comme sur des
            // créneaux changés ailleurs, sans rien écrire.
            foreach ($rewinds as $rewind) {
                if (self::isLonger($rewind->to, $rewind->from)
                    && null !== RecurrenceClash::earliest($read[$rewind->recurrence->toRfc4122()], $this->recurrences->findAll(), $this->calendar->today(), $this->recurrences->skippedAfter($this->calendar->today()), $this->sends->closedAfter($this->calendar->today()))) {
                    throw new StaleDay();
                }
            }
            // Annuler ne relie un quart d'heure qu'à une récurrence qui tombe ce jour-là.
            foreach ($links as $id) {
                if (!$read[$id->toRfc4122()]->fallsOn($date)) {
                    throw new StaleDay();
                }
            }
            $relinks = array_map(static fn (Uuid $id): Recurrence => $read[$id->toRfc4122()], $links);
            $this->assertRelinkFree($date, $relinks);
            $returned = $this->returned($day, $date, $relinks);
            $this->changeOccurrences($day, $date, array_replace($changes, array_fill_keys(array_keys($returned), null)), array_diff_key($relinks, $returned), $planned, $restores);
            $this->returnToSeries($day, $date, $returned);
            $this->detachAgain($day, $date, $detaches, $read, $rewinds);
            // Une fin rendue qui l'arrête avant ce jour sans qu'une autre y prenne sa place —
            // rétablir un effacement ou un arrêt avec les suivantes, annuler sa création — n'y
            // laisse pas de saut, comme le geste d'origine (saveRecurrence) : repoussée un jour,
            // elle y reviendrait comme ailleurs. Rétablir une coupe garde le sien, comme la coupe.
            foreach ([] === $links ? $rewinds : [] as $rewind) {
                $recurrence = $read[$rewind->recurrence->toRfc4122()];
                if (!$recurrence->reaches($date)) {
                    $this->recurrences->unskip($recurrence, $date);
                }
            }
        });
    }

    /**
     * « Enregistrer » dans la fenêtre d'un ticket ou d'une pause, la case « Récurrence »
     * cochée ou décochée : créer la récurrence du bloc, la changer à partir de cette fois,
     * ou l'arrêter à partir de cette fois.
     *
     * Changer une récurrence la coupe en deux, comme dans Google Agenda : l'ancienne finit
     * la veille du jour touché, et garde ce qu'elle a déjà posé ; la nouvelle part de ce
     * jour, avec ce qu'elle y pose — et, au même rythme, ses fois sautées après lui. Changer
     * seulement sa fin la change en place. Une récurrence qui ne change que dans ses fois à
     * venir ne touche jamais une fois passée : depuis un jour passé, elle change à partir de
     * demain (changePast).
     *
     * Un bloc ne porte la récurrence que si elle tombe ce jour-là : créée un vendredi pour
     * chaque lundi, elle laisse le bloc du vendredi sans elle.
     *
     * Une récurrence coupée qu'on colle se crée, et nomme celle dont elle vient ($follows), qui ne
     * va plus jusqu'à ce jour : la nouvelle la continue (Recurrence::follow), et, au même rythme,
     * reprend ses fois effacées ou détachées après lui, comme une récurrence qu'on change. Encore
     * là ce jour — sa coupe annulée depuis —, le collage se refuse : elle reviendrait deux fois.
     * Inconnue, rien n'est repris ni refusé.
     *
     * Une récurrence changée depuis que la fenêtre l'a vue — sa fin, depuis un autre jour,
     * sans que cette journée change de version — ne se remplace pas : la fenêtre écraserait
     * ce qu'elle n'a pas vu, et deux récurrences tomberaient les mêmes jours.
     *
     * @param array<int, ?SlotContent> $changes  ce que la fenêtre écrit ce jour-là
     * @param ?RecurrenceSpec          $spec     le rythme et la fin, ou null pour la case décochée
     * @param ?SeenRecurrence          $replaces la récurrence du bloc modifié, telle que la fenêtre l'a vue, ou null pour en créer une
     * @param ?Uuid                    $follows  à la création, la récurrence coupée dont vient celle qu'on colle
     *
     * @throws StaleDay
     * @throws RecurrenceRefused
     */
    public function saveRecurrence(\DateTimeImmutable $date, int $version, array $changes, ?RecurrenceSpec $spec, ?SeenRecurrence $replaces, ?Uuid $follows = null): RecurrenceSave
    {
        $this->poser->pose();
        if (null !== $spec) {
            $this->checkSpec($date, $spec, $replaces);
        }
        $untils = [];
        // Une journée jamais saisie ne naît que de ce que la fenêtre y écrit : une fois prévue
        // effacée avec les suivantes, ou une récurrence créée sur un jour à venir, qui s'y
        // prévoit sans s'écrire, ne la créent pas.
        $day = $this->write($date, $version, false, function (Day $day, array $planned) use ($date, $changes, $spec, $replaces, $follows, &$untils): void {
            $today = $this->calendar->today();
            // Ce que la fenêtre a vu : les saisies, et un jour à venir, ses fois prévues.
            $shown = RecurrenceForecast::shown($day->grid(), $planned);
            $old = null;
            if (null !== $replaces) {
                $old = $this->lockedRecurrence($replaces->id);
                // Changée ailleurs depuis que la fenêtre l'a vue, arrêtée avant ce jour, elle ne
                // le concerne plus.
                if (null === $old || !$replaces->matches($old) || null !== $old->until && $old->until < $date || [] === self::occurrenceIn($shown, $old)) {
                    throw new StaleDay();
                }
            }
            $content = self::oneContent($changes);
            if (null === $old) {
                if (null === $spec || null === $content || !self::oneRange(array_keys($changes))) {
                    throw RecurrenceRefused::notOneRange();
                }
                $starts = array_keys($changes);
                $new = new Recurrence($content, min([Quarter::DAY_END, ...$starts]), max([Quarter::FIRST, ...$starts]) + Quarter::MINUTES, $spec->rhythm, $date, $spec->until, max($date, $today));
                $source = $this->followed($follows, $new, $date);
                $carried = $this->carriedFrom($source, $new, $date);
                $this->assertFree($new, $carried);
                if (null !== $source) {
                    $new->follow($source);
                }
                $this->entityManager->persist($new);
                $this->recurrences->carry($carried, $new);
                $untils[] = UntilChange::of($new, $new->withdrawnUntil());
                $this->changeOccurrences($day, $date, $changes, self::linksIfFalls($new, $date, array_keys($changes)), $planned);

                return;
            }
            if ($date < $today) {
                $untils = $this->changePast($day, $date, $today, $old, $changes, $content, $spec);

                return;
            }
            // Les autres morceaux de cette fois suivent le bloc modifié.
            $occurrence = array_diff(self::occurrenceIn($shown, $old), array_keys($changes));
            $before = $old->until;
            // Arrêtée à partir de cette fois — le bloc reste, sans elle, ou s'efface avec elle.
            if (null === $spec) {
                $this->endOn($old, $date <= $old->firstDay ? $old->withdrawnUntil() : $date->modify('-1 day'));
                $untils[] = UntilChange::of($old, $before);
                $all = $changes;
                foreach ($occurrence as $start) {
                    $all[$start] = $shown->contentAt($start);
                }
                $this->changeOccurrences($day, $date, $all, [], $planned);
                // Elle ne va plus jusqu'à ce jour : rien n'est à y sauter. Repoussée un jour
                // depuis une fois d'avant, elle y reviendrait comme ailleurs, comme une série
                // d'agenda qu'on prolonge.
                $this->recurrences->unskip($old, $date);

                return;
            }
            // Ses heures, à partir de cette fois : les mêmes quand la fenêtre change le bloc, plus
            // longues ou plus courtes quand la grille l'allonge ou le raccourcit. Relié hors de la
            // plage de sa récurrence, un quart d'heure ne se rendrait plus par annuler
            // (LinksMatchRecurrences) : tout autre geste se refuse.
            $hours = self::hoursAfter($old, $changes);
            if (null === $hours) {
                throw RecurrenceRefused::notOneRange();
            }
            [$start, $end] = $hours;
            $content ??= $old->content();
            $sameHours = $start === $old->start && $end === $old->end;
            if ($sameHours && $content->equals($old->content()) && $spec->rhythm->equals($old->rhythm())) {
                if ($spec->until?->format('Y-m-d') !== $before?->format('Y-m-d')) {
                    $this->endOn($old, $spec->until);
                    $this->assertMovedLonger($old, $before);
                    $this->assertFreeLonger($old, $before);
                    $untils[] = UntilChange::of($old, $before);
                }
                $this->changeOccurrences($day, $date, $changes, array_fill_keys(array_keys($changes), $old), $planned);

                return;
            }
            $this->endOn($old, $date <= $old->firstDay ? $old->withdrawnUntil() : $date->modify('-1 day'));
            $untils[] = UntilChange::of($old, $before);
            $new = new Recurrence($content, $start, $end, $spec->rhythm, $date, $spec->until, max($date, $today));
            $this->assertMovedLonger($old, $before, $new);
            // Au même rythme — un autre ticket ou commentaire, d'autres heures, sa fin peut-être —, la nouvelle
            // reprend la suite de l'ancienne : ses fois effacées ou détachées après ce jour le
            // restent, sans prendre leur créneau, et celles qu'un jour à 0h00 retient lui
            // reviendront avec son objectif. Annuler la coupe les laisse à la nouvelle, retirée,
            // où elles ne comptent plus : rétablir la refait telle quelle.
            $carried = $spec->rhythm->equals($old->rhythm()) ? $this->recurrences->skipsAfter($old, $date) : [];
            $this->assertFree($new, $carried);
            // Une collée remplacée le jour même de son collage, retirée, passe la main : la nouvelle
            // continue sa coupée, et ne revit pas avec elle (assertMoved).
            if ($date <= $old->firstDay && null !== $old->follows) {
                $new->follow($old);
            }
            $this->entityManager->persist($new);
            $this->recurrences->carry($carried, $new);
            $untils[] = UntilChange::of($new, $new->withdrawnUntil());
            // Raccourcie, ce qu'elle quitte ce jour-là s'efface : seul ce qu'elle garde s'y relie.
            $all = $changes + array_fill_keys($occurrence, $content);
            $kept = array_keys(array_filter($all, static fn (?SlotContent $cell): bool => null !== $cell));
            $this->changeOccurrences($day, $date, $all, self::linksIfFalls($new, $date, $kept), $planned);
        });

        return new RecurrenceSave($day, $untils);
    }

    /**
     * La fenêtre d'un bloc qui revient, sur un jour passé. Les fois passées ne changent
     * jamais : le rythme ou la fin changent à partir de demain, et ce qu'on change au bloc
     * ne vaut que pour cette fois, qu'il détache. Décocher la case l'arrête après aujourd'hui,
     * et détache le bloc.
     *
     * @param array<int, ?SlotContent> $changes
     *
     * @return list<UntilChange>
     *
     * @throws RecurrenceRefused
     */
    private function changePast(Day $day, \DateTimeImmutable $date, \DateTimeImmutable $today, Recurrence $old, array $changes, ?SlotContent $content, ?RecurrenceSpec $spec): array
    {
        $untils = [];
        $before = $old->until;
        // La dernière fois de l'ancienne définition : aujourd'hui, ou sa fin si elle est avant.
        $last = null === $before || $before > $today ? $today : $before;
        if (null !== $spec && (null === $content || [] !== array_diff(array_keys($changes), $old->quarters()))) {
            throw RecurrenceRefused::notOneRange();
        }
        if (null === $spec || !$spec->rhythm->equals($old->rhythm())) {
            $tomorrow = $today->modify('+1 day');
            if (null !== $spec && null !== $spec->until && $spec->until < $tomorrow) {
                throw RecurrenceRefused::endsBefore($tomorrow, $today);
            }
            if ($last->format('Y-m-d') !== $before?->format('Y-m-d')) {
                $this->endOn($old, $last);
                $untils[] = UntilChange::of($old, $before);
            }
            if (null !== $spec) {
                $new = new Recurrence($old->content(), $old->start, $old->end, $spec->rhythm, $tomorrow, $spec->until, $today);
                $this->assertMovedLonger($old, $before, $new);
                $this->assertFree($new);
                $this->entityManager->persist($new);
                $untils[] = UntilChange::of($new, $new->withdrawnUntil());
            }
        } elseif ($spec->until?->format('Y-m-d') !== $before?->format('Y-m-d')) {
            // Posée jusqu'à aujourd'hui, elle ne finit pas avant : ses fois posées resteraient siennes.
            if (null !== $spec->until && $spec->until < $today) {
                throw RecurrenceRefused::endsBefore($today, $today);
            }
            $this->endOn($old, $spec->until);
            $this->assertMovedLonger($old, $before);
            $this->assertFreeLonger($old, $before);
            $untils[] = UntilChange::of($old, $before);
        }
        $keeps = null !== $content && null !== $spec && $content->equals($old->content());
        $this->changeOccurrences($day, $date, $changes, $keeps ? array_fill_keys(array_keys($changes), $old) : [], []);

        return $untils;
    }

    /**
     * La coupée dont vient une récurrence qu'on colle ce jour-là ($new), ou null si elle est
     * inconnue. Encore là ce jour, sa coupe a été annulée depuis ; collée déjà ailleurs, la collée
     * encore là pendant la période de la nouvelle : la coller la ferait revenir deux fois.
     *
     * @throws RecurrenceRefused
     */
    private function followed(?Uuid $follows, Recurrence $new, \DateTimeImmutable $date): ?Recurrence
    {
        $source = null === $follows ? null : $this->lockedRecurrence($follows);
        if (null !== $source && $source->reaches($date)) {
            throw RecurrenceRefused::cutUndone();
        }
        // Collée déjà ailleurs, et encore là sur la période de la nouvelle : un onglet dupliqué
        // après la coupe la collerait deux fois. Une coupe plus tôt de la même, qui finit avant ce
        // collage, se colle.
        foreach (null === $source ? [] : $this->liveFollowers($source, fn (Uuid $id): ?Recurrence => $this->lockedRecurrence($id)) as $pasted) {
            if ($new->reaches($pasted->firstDay) && $pasted->reaches($date)) {
                throw RecurrenceRefused::pastedElsewhere($pasted->firstDay);
            }
        }

        return $source;
    }

    /**
     * Les fois sautées qu'une récurrence collée reprend de la coupée dont elle vient : celles
     * d'après le jour du collage, si la coupée revient au même rythme ; aucune sinon. Celle du
     * jour même ne se reprend pas : le collage y pose la nouvelle, et la compter libre cacherait
     * un créneau pris ce jour-là (assertFree).
     *
     * @return list<RecurrenceSkip>
     */
    private function carriedFrom(?Recurrence $source, Recurrence $new, \DateTimeImmutable $date): array
    {
        if (null === $source || !$new->rhythm()->equals($source->rhythm())) {
            return [];
        }

        return $this->recurrences->skipsAfter($source, $date);
    }

    /**
     * Une fin rendue qui prolonge une récurrence déplacée ne la fait pas revivre à ses deux
     * places. Collée, elle ne revient pas tant que la coupée va jusqu'à son premier jour :
     * rétablir le collage attend qu'on ait rétabli la coupe. Coupée, elle ne va pas jusqu'au
     * premier jour d'une collée encore là : annuler la coupe attend qu'on ait annulé le collage.
     * Déplacée plusieurs fois, ou collée puis remplacée le jour même, un maillon retiré renvoie
     * au suivant : à sa propre coupée en remontant, à ses propres collées en descendant.
     * Collée, elle ne revient pas non plus sur la période d'une autre collée de la même coupe,
     * encore là : un onglet dupliqué l'a collée ailleurs pendant qu'elle était annulée.
     *
     * @param array<string, Recurrence> $read celles que le geste a déjà lues, et peut-être changées
     *
     * @throws RecurrenceRefused
     */
    private function assertMoved(Recurrence $recurrence, array $read): void
    {
        $locked = fn (Uuid $id): ?Recurrence => $read[$id->toRfc4122()] ?? $this->lockedRecurrence($id);
        if (!$recurrence->isWithdrawn() && null !== $recurrence->cutOn) {
            $source = $this->liveSource($recurrence, $locked);
            if (null !== $source && $source->reaches($recurrence->firstDay)) {
                throw RecurrenceRefused::cutFirst($recurrence->cutOn);
            }
            $twin = $this->pastedTwin($recurrence, $locked);
            if (null !== $twin) {
                throw RecurrenceRefused::pasteFirst($twin->firstDay);
            }
        }
        $follower = $this->reachedFollower($recurrence, $locked);
        if (null !== $follower) {
            throw RecurrenceRefused::pasteFirst($follower->firstDay);
        }
    }

    /**
     * La fenêtre ne repousse pas la fin d'une coupée au-delà du premier jour d'une collée encore
     * là, qui tombe encore après aujourd'hui : elle revivrait à ses deux places. Refusé sous
     * « Jusqu'au ». Une collée finie avant ne gêne pas : les fois passées ne changent jamais.
     * Quand la fenêtre change autre chose — le ticket, le commentaire, les heures, le rythme —,
     * c'est la nouvelle récurrence ($new), qui la remplace à partir de ce jour, dont la fin se
     * juge face aux collées de la coupée.
     *
     * @throws RecurrenceRefused
     */
    private function assertMovedLonger(Recurrence $recurrence, ?\DateTimeImmutable $before, ?Recurrence $new = null): void
    {
        $reaching = $new ?? $recurrence;
        if (!self::isLonger($reaching->until, $before)) {
            return;
        }
        $follower = $this->reachedFollower($recurrence, fn (Uuid $id): ?Recurrence => $this->lockedRecurrence($id), $this->calendar->today()->modify('+1 day'), $reaching);
        if (null !== $follower) {
            throw RecurrenceRefused::pasteFirst($follower->firstDay, 'recurrence.until');
        }
    }

    /**
     * La coupée encore là que continue cette collée : la sienne, ou, retirée, celle qu'elle
     * continuait elle-même. Null s'il n'y en a pas.
     *
     * @param \Closure(Uuid): ?Recurrence $locked
     */
    private function liveSource(Recurrence $recurrence, \Closure $locked): ?Recurrence
    {
        $source = null === $recurrence->follows ? null : $locked($recurrence->follows);
        while (null !== $source && $source->isWithdrawn() && null !== $source->follows) {
            $source = $locked($source->follows);
        }

        return null === $source || $source->isWithdrawn() ? null : $source;
    }

    /**
     * Une autre collée encore là de la même coupe, dont la période croise celle de cette collée ;
     * null s'il n'y en a pas. La coupe se cherche en remontant les maillons retirés, comme sa
     * coupée (liveSource) : une collée remplacée le jour même, ou recoupée ce jour-là, continue
     * encore la même.
     *
     * @param \Closure(Uuid): ?Recurrence $locked
     */
    private function pastedTwin(Recurrence $recurrence, \Closure $locked): ?Recurrence
    {
        $source = null === $recurrence->follows ? null : $locked($recurrence->follows);
        while (null !== $source && $source->isWithdrawn() && null !== $source->follows) {
            $source = $locked($source->follows);
        }
        foreach (null === $source ? [] : $this->liveFollowers($source, $locked) as $pasted) {
            if (!$pasted->id->equals($recurrence->id) && $recurrence->reaches($pasted->firstDay) && $pasted->reaches($recurrence->firstDay)) {
                return $pasted;
            }
        }

        return null;
    }

    /**
     * Les collées encore là qui continuent cette récurrence, par leur identifiant : les siennes,
     * et, pour une collée retirée, celles qui la continuent.
     *
     * @param \Closure(Uuid): ?Recurrence $locked
     *
     * @return list<Recurrence>
     */
    private function liveFollowers(Recurrence $recurrence, \Closure $locked): array
    {
        $live = [];
        foreach ($this->recurrences->followersOf($recurrence) as $follower) {
            $follower = $locked($follower->id);
            if (null !== $follower) {
                array_push($live, ...($follower->isWithdrawn() ? $this->liveFollowers($follower, $locked) : [$follower]));
            }
        }

        return $live;
    }

    /**
     * La première collée encore là jusqu'au premier jour de laquelle cette récurrence va — ou
     * $reaching, qui la remplace —, et qui va elle-même jusqu'à $after s'il est donné ; null s'il
     * n'y en a pas.
     *
     * @param \Closure(Uuid): ?Recurrence $locked
     */
    private function reachedFollower(Recurrence $recurrence, \Closure $locked, ?\DateTimeImmutable $after = null, ?Recurrence $reaching = null): ?Recurrence
    {
        $reaching ??= $recurrence;
        foreach ($this->liveFollowers($recurrence, $locked) as $follower) {
            if ($reaching->reaches($follower->firstDay) && (null === $after || $follower->reaches($after))) {
                return $follower;
            }
        }

        return null;
    }

    /**
     * Les heures d'une récurrence changée à partir de cette fois, [début, fin], ou null si le
     * geste ne s'y prête pas. La fenêtre écrit dans sa plage — un autre ticket ou commentaire,
     * un autre rythme —, et ses heures ne changent pas. La grille l'allonge, d'un contenu
     * identique au sien qui prolonge sa plage, ou la raccourcit, en effaçant son haut ou son
     * bas : ses heures deviennent sa plage d'avant, plus ce qui la prolonge, ou moins ce qui
     * s'en efface, d'un seul tenant et jamais vide. Rien d'autre : ni un autre contenu hors de sa
     * plage, ni un effacement qui la couperait en deux, ni les deux à la fois, qui la déplacerait.
     *
     * @param array<int, ?SlotContent> $changes
     *
     * @return ?array{int, int}
     */
    private static function hoursAfter(Recurrence $old, array $changes): ?array
    {
        $own = $old->quarters();
        $content = self::oneContent($changes);
        if (null !== $content && [] === array_diff(array_keys($changes), $own)) {
            return [$old->start, $old->end];
        }
        $quarters = array_fill_keys($own, true);
        $erased = false;
        $added = false;
        foreach ($changes as $start => $cell) {
            if (null === $cell) {
                if (!isset($quarters[$start])) {
                    return null;
                }
                unset($quarters[$start]);
                $erased = true;
            } elseif ($cell->equals($old->content())) {
                $added = $added || !\in_array($start, $own, true);
                $quarters[$start] = true;
            } else {
                return null;
            }
        }
        // L'un ou l'autre : allonger et raccourcir d'un même geste la déplacerait.
        if ($erased && $added) {
            return null;
        }
        $starts = array_keys($quarters);
        if ([] === $starts || !self::oneRange($starts)) {
            return null;
        }

        return [min($starts), max($starts) + Quarter::MINUTES];
    }

    /**
     * Les quarts d'heure qu'une récurrence pose ce jour-là, ou aucun si elle n'y tombe pas.
     *
     * @param list<int> $quarters
     *
     * @return array<int, Recurrence>
     */
    private static function linksIfFalls(Recurrence $recurrence, \DateTimeImmutable $date, array $quarters): array
    {
        return $recurrence->fallsOn($date) ? array_fill_keys($quarters, $recurrence) : [];
    }

    /**
     * Les quarts d'heure de sa fois ce jour-là, posés ou prévus.
     *
     * @return list<int>
     */
    private static function occurrenceIn(Grid $shown, Recurrence $recurrence): array
    {
        $id = $recurrence->id->toRfc4122();

        return array_values(array_filter(Quarter::between(Quarter::FIRST, Quarter::DAY_END), static fn (int $start): bool => $shown->linkAt($start) === $id));
    }

    /**
     * @throws StaleDay
     * @throws NonWorkingDay
     */
    public function setObjective(\DateTimeImmutable $date, int $version, int $objective): Day
    {
        $this->poser->pose();
        // Hors du verrou, sans risque : un objectif écrit sur un jour décoché au même
        // instant dans un autre onglet ne se lit pas, un jour non travaillé se lisant sans
        // objectif (DayReader).
        if (!$this->settings->isWorkingDay($date)) {
            throw new NonWorkingDay();
        }

        return $this->write($date, $version, true, function (Day $day, array $planned) use ($date, $objective): void {
            // Lu sous le verrou, comme à la naissance d'une journée.
            $habitual = $this->settings->habitualObjective();
            $wasOff = $day->isDeclaredOff();
            if ($objective === $habitual) {
                $day->returnToHabitual($habitual);
            } else {
                $day->chooseObjective($objective);
            }
            if (!$wasOff && $day->isDeclaredOff()) {
                $this->holdOccurrences($day, $date, $planned);
            } elseif ($wasOff && !$day->isDeclaredOff()) {
                $this->releaseOccurrences($day, $date);
            }
        }) ?? throw new \LogicException('Un objectif crée toujours sa journée.');
    }

    /**
     * Mise à 0h00, la journée perd les blocs que ses récurrences y ont posés — ceux qui
     * portent leur flèche —, sans toucher à ses autres saisies ; un jour à venir ne prévoit
     * plus rien. Chaque récurrence retirée, posée ou prévue, le retient, pour le jour où la
     * journée reviendra à un objectif : un congé posé d'avance puis annulé une fois le jour
     * venu retrouve ce que la fenêtre de l'objectif annonçait retirer.
     *
     * @param array<int, Recurrence> $planned les fois prévues avant le 0h00, par quart d'heure
     */
    private function holdOccurrences(Day $day, \DateTimeImmutable $date, array $planned): void
    {
        $removed = [];
        $held = [];
        foreach ($planned as $recurrence) {
            $held[spl_object_id($recurrence)] = $recurrence;
        }
        foreach ($day->linkedQuarters() as $start => $recurrence) {
            if ($recurrence->reaches($date)) {
                $removed[$start] = null;
                $held[spl_object_id($recurrence)] = $recurrence;
            }
        }
        $day->change($removed);
        foreach ($held as $recurrence) {
            $this->recurrences->hold($recurrence, $date);
        }
    }

    /**
     * Revenue à un objectif, la journée retrouve les fois que son passage à 0h00 avait
     * retirées, et seulement celles-là : une fois effacée ou détachée avant ne revient pas,
     * ni une récurrence qui n'y avait rien posé. Un jour à venir les prévoit de nouveau ; un
     * jour venu les reçoit comme du poseur, sur ses quarts d'heure libres.
     */
    private function releaseOccurrences(Day $day, \DateTimeImmutable $date): void
    {
        foreach ($this->recurrences->release($date) as $recurrence) {
            if (!$recurrence->fallsOn($date) || $this->forecast->plans($recurrence, $day, $date)) {
                continue;
            }
            $free = array_values(array_filter($recurrence->quarters(), static fn (int $start): bool => !$day->holds($start)));
            $day->change(array_fill_keys($free, $recurrence->content()), array_fill_keys($free, $recurrence));
        }
    }

    /**
     * Les quarts d'heure qu'annuler ou rétablir relient sans les écrire : la fois revient à sa
     * récurrence, et la journée ne la montre pas. Mise à 0h00, une journée n'en porte aucune —
     * le 0h00 les a retirées —, et sa récurrence la retient jusqu'au retour d'un objectif. À
     * venir et non travaillée, elle n'en reçoit aucune qui ne l'ait déjà traitée — née d'un bloc
     * de ce jour-là — ou qui n'y ait été posée par un envoi : sa série la prévoira si elle
     * redevient travaillée. Une récurrence qui y a encore des quarts d'heure y est : ce qu'on lui
     * relie s'écrit.
     *
     * @param array<int, Recurrence> $links
     *
     * @return array<int, Recurrence>
     */
    private function returned(Day $day, \DateTimeImmutable $date, array $links): array
    {
        $off = $day->isDeclaredOff();

        return array_filter(
            $links,
            fn (Recurrence $recurrence): bool => [] === $day->quartersOf($recurrence)
                && ($off || (!$this->settings->isWorkingDay($date) && $this->forecast->awaits($recurrence, $day, $date))),
        );
    }

    /**
     * Les fois que ce geste a rendues à leur série : retenues sur une journée à 0h00, que le
     * retour à un objectif leur rendra ; sinon, plus détachées du tout.
     *
     * @param array<int, Recurrence> $returned
     */
    private function returnToSeries(Day $day, \DateTimeImmutable $date, array $returned): void
    {
        $once = [];
        foreach ($returned as $recurrence) {
            $once[spl_object_id($recurrence)] = $recurrence;
        }
        foreach ($once as $recurrence) {
            if ($day->isDeclaredOff()) {
                $this->recurrences->holdReturned($recurrence, $date);
            } else {
                $this->recurrences->unskip($recurrence, $date);
            }
        }
    }

    /**
     * Rétablir un geste dont l'annulation a rendu une fois à sa série sans l'écrire : la fois est
     * de nouveau détachée, comme le geste d'origine l'avait laissée. Si le geste refait mène sa
     * série ailleurs — une coupe rétablie —, elle ne tombe plus ce jour-là : rien n'y est à
     * sauter. Seulement sur une journée qui ne reçoit pas de récurrence — mise à 0h00, ou non
     * travaillée — : ailleurs, aucune fois n'a pu être rendue ainsi. Une récurrence que la journée
     * porte encore, ou menée ailleurs par un autre geste, a changé depuis : rien ne s'écrit.
     *
     * @param list<Uuid>                $detaches
     * @param array<string, Recurrence> $read     celles que le geste a déjà lues, et peut-être changées
     * @param list<UntilRewind>         $rewinds
     *
     * @throws StaleDay
     */
    private function detachAgain(Day $day, \DateTimeImmutable $date, array $detaches, array $read, array $rewinds): void
    {
        if ([] !== $detaches && !$day->isDeclaredOff() && $this->settings->isWorkingDay($date)) {
            throw new StaleDay();
        }
        $rewound = array_map(static fn (UntilRewind $rewind): string => $rewind->recurrence->toRfc4122(), $rewinds);
        foreach ($detaches as $id) {
            $recurrence = $read[$id->toRfc4122()] ?? $this->lockedRecurrence($id);
            if (null === $recurrence || [] !== $day->quartersOf($recurrence)) {
                throw new StaleDay();
            }
            if ($recurrence->fallsOn($date)) {
                $this->recurrences->detachAgain($recurrence, $date);
            } elseif (\in_array($id->toRfc4122(), $rewound, true)) {
                $this->recurrences->unskip($recurrence, $date);
            } else {
                throw new StaleDay();
            }
        }
    }

    /**
     * Applique le geste, puis tient le compte des fois détachées : un quart d'heure qu'il
     * prend à une récurrence sans le lui laisser détache sa fois entière ce jour-là — ses
     * autres quarts d'heure, posés ou prévus, s'écrivent sans son lien —, et rien ne l'y
     * repose ni ne l'y prévoit plus. Une fois rendue par annuler redevient la sienne.
     *
     * Un jour à venir, un quart d'heure rendu à une récurrence qui l'y prévoit encore n'écrit
     * rien : la fois redevient prévue, sans rien prendre à celle qui s'y montrait entre-temps,
     * si elle passe avant elle dans la prévision.
     * Ce qu'annuler réécrit ($restores) ne détache pas non plus une fois prévue : elle lui
     * cède, comme à une saisie d'avant elle, puisque c'est en l'effaçant que le geste annulé
     * l'avait montrée.
     *
     * @param array<int, ?SlotContent> $changes
     * @param array<int, Recurrence>   $links
     * @param array<int, Recurrence>   $planned  les fois prévues ce jour-là avant le geste, par quart d'heure
     * @param bool                     $restores le geste rend une journée d'avant (annuler)
     */
    private function changeOccurrences(Day $day, \DateTimeImmutable $date, array $changes, array $links, array $planned, bool $restores = false): void
    {
        $saved = $day->linkedQuarters();
        $detached = [];
        foreach ($changes as $start => $content) {
            $link = $links[$start] ?? null;
            $before = $saved[$start] ?? $planned[$start] ?? null;
            if (null === $before || $link === $before) {
                continue;
            }
            // Une fois seulement prévue cède quand annuler y réécrit un contenu, ou quand le geste
            // relie ce quart d'heure à une récurrence qui l'y prévoit et passe avant elle, dans
            // l'ordre où la prévision les place (RecurrenceForecast) : sinon c'est elle qui s'y
            // montrerait de nouveau, et rétablir ne referait rien.
            $yields = !isset($saved[$start]) && ($restores && null !== $content
                || null !== $link && $this->forecast->plans($link, $day, $date) && $link->id->toRfc4122() < $before->id->toRfc4122());
            if (!$yields) {
                $detached[spl_object_id($before)] = $before;
            }
        }
        foreach ($saved + $planned as $start => $recurrence) {
            if (isset($detached[spl_object_id($recurrence)]) && !\array_key_exists($start, $changes)) {
                $changes[$start] = $recurrence->content();
            }
        }
        $written = $links;
        foreach ($links as $start => $recurrence) {
            if ($this->forecast->plans($recurrence, $day, $date)) {
                $changes[$start] = null;
                unset($written[$start]);
            }
        }

        foreach ([...$day->change($changes, $written), ...array_values($detached)] as $recurrence) {
            if ([] === $day->quartersOf($recurrence)) {
                $this->recurrences->skip($recurrence, $date);
            }
        }
        $relinked = [];
        foreach ($links as $recurrence) {
            $relinked[spl_object_id($recurrence)] = $recurrence;
        }
        foreach ($relinked as $recurrence) {
            $this->recurrences->unskip($recurrence, $date);
        }
    }

    /**
     * Lue sous le verrou, jamais telle qu'elle a pu être chargée plus tôt dans la requête :
     * un autre onglet a pu changer sa fin entre-temps, depuis une autre journée.
     */
    private function lockedRecurrence(Uuid $id): ?Recurrence
    {
        $recurrence = $this->recurrences->byId($id);
        if (null !== $recurrence) {
            $this->entityManager->refresh($recurrence);
        }

        return $recurrence;
    }

    /**
     * Sa fin change. Les jours venus jusqu'à aujourd'hui sont désormais traités : une fin
     * repoussée ne pose rien après coup sur un jour déjà venu.
     */
    private function endOn(Recurrence $recurrence, ?\DateTimeImmutable $until): void
    {
        $recurrence->endOn($until);
        $recurrence->posedUntil($this->calendar->today());
    }

    /**
     * Les jours se choisissent parmi les jours travaillés des réglages. Un jour décoché depuis
     * reste à la récurrence remplacée qui l'avait déjà : sa fenêtre la change encore, et le
     * poseur ne pose rien un jour non travaillé. Un jour non travaillé nouveau se refuse.
     *
     * @throws RecurrenceRefused
     */
    private function checkSpec(\DateTimeImmutable $date, RecurrenceSpec $spec, ?SeenRecurrence $replaces): void
    {
        // Sa définition ne change jamais : lue hors du verrou, elle vaut encore dessous.
        $kept = null === $replaces ? [] : ($this->recurrences->byId($replaces->id)?->rhythm()->weekdays ?? []);
        $working = $this->settings->workingDays();
        foreach ($spec->rhythm->weekdays as $weekday) {
            if (!\in_array($weekday, $working, true) && !\in_array($weekday, $kept, true)) {
                throw RecurrenceRefused::notWorking($weekday);
            }
        }
        if (!$spec->rhythm->permittedBy($date)) {
            throw RecurrenceRefused::notPermitted();
        }
        if (null !== $spec->until && $spec->until < $date) {
            throw RecurrenceRefused::endsBefore($date, $this->calendar->today());
        }
    }

    /**
     * Jamais deux récurrences sur un créneau : celle qu'on crée, ou qu'on prolonge, se refuse
     * si une autre y revient un même jour (RecurrenceClash). Jugé sous le verrou, sur toutes
     * les récurrences telles que ce geste les laisse : deux onglets qui en créent une chacun
     * au même instant passent l'un après l'autre, et le second voit la première.
     *
     * @param list<RecurrenceSkip> $carried les fois sautées qu'elle reprend d'une autre, pas encore écrites
     *
     * @throws RecurrenceRefused
     */
    private function assertFree(Recurrence $candidate, array $carried = []): void
    {
        // Après aujourd'hui : un jour déjà venu ne reçoit plus rien d'aucune, ni un jour à venir
        // déjà envoyé. Une fois détachée ou effacée ne prend plus son créneau ; retenue par un
        // 0h00, elle le garde.
        $today = $this->calendar->today();
        $skipped = $this->recurrences->skippedAfter($today);
        foreach ($carried as $skip) {
            $day = $skip->date->format('Y-m-d');
            if (!$skip->held && $day > $today->format('Y-m-d')) {
                $skipped[$candidate->id->toRfc4122()][] = $day;
            }
        }
        $clash = RecurrenceClash::earliest($candidate, $this->recurrences->findAll(), $today, $skipped, $this->sends->closedAfter($today));
        if (null !== $clash) {
            throw RecurrenceRefused::taken($clash[0]);
        }
    }

    /**
     * Sa fin changée en place : seule une fin repoussée peut la mener sur un créneau pris. Une
     * fin avancée ne se refuse pas, même si deux récurrences d'avant cette règle se croisaient.
     *
     * @throws RecurrenceRefused
     */
    private function assertFreeLonger(Recurrence $recurrence, ?\DateTimeImmutable $before): void
    {
        if (self::isLonger($recurrence->until, $before)) {
            $this->assertFree($recurrence);
        }
    }

    /**
     * Une fois sautée « cette fois seulement » a libéré son créneau, qu'une autre a pu prendre
     * depuis (assertFree). Annuler qui la relie ne l'y ramène pas : jamais deux récurrences sur
     * un créneau. Le geste se refuse comme sur des créneaux changés ailleurs, sans rien écrire.
     * Après aujourd'hui seulement : un jour déjà venu ne reçoit plus rien d'aucune. Deux
     * récurrences nées avant ce refus, qui se croisaient déjà, restent telles quelles
     * (RecurrenceClash::takenWhileSkipped).
     *
     * @param array<int, Recurrence> $links
     *
     * @throws StaleDay
     */
    private function assertRelinkFree(\DateTimeImmutable $date, array $links): void
    {
        $today = $this->calendar->today();
        if ($date <= $today || [] === $links) {
            return;
        }
        $skipped = $this->recurrences->skippedAfter($today);
        $day = $date->format('Y-m-d');
        $checked = [];
        foreach ($links as $recurrence) {
            $id = $recurrence->id->toRfc4122();
            if (isset($checked[$id])) {
                continue;
            }
            $checked[$id] = true;
            if (\in_array($day, $skipped[$id] ?? [], true)
                && null !== RecurrenceClash::takenWhileSkipped($recurrence, $this->recurrences->findAll(), $date, $today, $skipped, $this->sends->closedAfter($today))) {
                throw new StaleDay();
            }
        }
    }

    /** Une fin qui va plus loin que l'autre : sans fin, ou plus tard. */
    private static function isLonger(?\DateTimeImmutable $until, ?\DateTimeImmutable $than): bool
    {
        return null !== $than && (null === $until || $until > $than);
    }

    /**
     * Le seul contenu que la fenêtre écrit, ou null si elle en écrit plusieurs, ou efface.
     *
     * @param array<int, ?SlotContent> $changes
     */
    private static function oneContent(array $changes): ?SlotContent
    {
        $first = reset($changes);
        if (null === $first || false === $first) {
            return null;
        }
        foreach ($changes as $content) {
            if (null === $content || !$content->equals($first)) {
                return null;
            }
        }

        return $first;
    }

    /**
     * Des quarts d'heure qui se suivent, sans trou.
     *
     * @param list<int> $starts
     */
    private static function oneRange(array $starts): bool
    {
        sort($starts);

        return [] !== $starts && end($starts) - $starts[0] === (\count($starts) - 1) * Quarter::MINUTES;
    }

    /**
     * @param \Closure(Day, array<int, Recurrence>): void $gesture reçoit la journée, et ses fois prévues avant le geste
     *
     * @throws StaleDay
     */
    private function write(\DateTimeImmutable $date, int $version, bool $creates, \Closure $gesture): ?Day
    {
        return $this->transaction->run($this->days, function () use ($date, $version, $creates, $gesture): ?Day {
            // Sous le verrou, deux écritures simultanées passent l'une après l'autre, et
            // la seconde voit la version de la première.
            $day = $this->days->findWithSlots($date);
            if (null !== $day) {
                // Chargée plus tôt dans la requête, elle n'a pas forcément sa dernière version.
                $this->entityManager->refresh($day);
            }
            // Les récurrences aussi : un créneau pris se juge sur leurs fins du moment.
            $this->recurrences->refreshAll();
            // Ce que l'onglet a vu : la journée, ses fois prévues et ses liens qui n'y vont plus,
            // que la version dit aussi.
            $planned = $this->forecast->on($day, $date);
            if (DayVersion::of($day, $planned) !== $version) {
                throw new StaleDay();
            }

            $born = null === $day;
            $closed = false;
            // Celles qui y ont un bloc avant le geste : effacée par lui, une fois garde son créneau
            // sur le jour qu'il rouvre, et annuler la rend (SendClosure).
            $before = null === $day ? [] : $day->grid()->recurrences();
            if (null !== $day) {
                // Vide de tickets, elle oublie l'envoi qui n'a plus rien à dire avant de se remplir :
                // le ticket saisi ne la refermerait pas aux récurrences qu'elle montrait.
                $this->closure->forget($day);
                $closed = $this->sends->closesToRecurrences($day);
            }
            if (null === $day) {
                // Lu sous le verrou : un objectif habituel changé dans un autre onglet
                // vaut pour la journée qui naît ici.
                $day = new Day($date, $this->settings->habitualObjective());
            } else {
                $this->days->advance($date);
                // La version vient d'avancer dans la base, pas dans l'objet déjà chargé.
                $this->entityManager->refresh($day);
                // Vide et sans objectif choisi, elle reprend l'habituel du moment, comme
                // une journée qui naît.
                if ($day->followsHabitual()) {
                    $day->objective = $this->settings->habitualObjective();
                }
            }

            $gesture($day, $planned);

            if ($born) {
                // Rien n'y est saisi : effacer sur un jour jamais saisi, ou y retirer une fois
                // prévue entière, ne le crée pas.
                if (!$creates && $day->isEmpty()) {
                    return null;
                }
                $this->entityManager->persist($day);
            }
            // Vidée de ses tickets, une journée que ses envois laissent sans heures dans Jira
            // redevient une journée comme une autre (SendClosure).
            $this->closure->reopen($day, $closed, false, $before);

            return $day;
        });
    }
}
