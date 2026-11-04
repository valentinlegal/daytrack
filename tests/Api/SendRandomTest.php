<?php

namespace App\Tests\Api;

use App\Day\Quarter;
use App\Dev\Jira\Catalog;
use App\Jira\JiraWorklog;
use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use App\Tests\Support\RandomSuite;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Des suites de gestes et d'envois tirées au hasard : poser, superposer, effacer,
 * changer un commentaire, convertir en pause, puis envoyer — parfois pendant que Jira
 * est en panne. Après chaque envoi abouti, Jira a exactement les saisies de la journée,
 * calculées ici à part, une par ticket et par commentaire : ni double, ni reste, ni
 * heure de collègue touchée. Et une saisie qui survit d'un envoi à l'autre garde son
 * identifiant dans Jira : renvoyer ne laisse pas de traces.
 *
 * Chaque passage tire une graine neuve ; RANDOM_SEED en rejoue une.
 */
final class SendRandomTest extends WebTestCase
{
    use DayApi;
    use JiraApi;
    use RandomSuite;

    private const int SEQUENCES = 15;

    private const int STEPS = 25;

    /** De 09:00 à 12:00 : assez serré pour que les gestes se recouvrent. */
    private const int FIRST = 540;
    private const int QUARTERS = 12;

    private const array CONTENTS = [
        ['work', 'SHOP-482', null],
        ['work', 'SHOP-482', 'Tests'],
        ['work', 'OPS-12', null],
        ['work', 'OPS-7', 'Revue'],
        // Jira refuse ses heures : l'envoi est partiel tant qu'il est dans la journée.
        ['work', 'FERME-1', null],
        // Jira tombe en panne sur une écriture sur deux : l'envoi se complète au suivant.
        ['work', 'MOITIE-1', null],
        ['work', 'MUET-1', null],
        ['work', 'SOURD-1', null],
        ['pause', null, null],
        ['empty', null, null],
    ];

    public function testDesGestesEtDesEnvoisMelesLaissentDansJiraExactementLaJournee(): void
    {
        $random = $this->randomizer();
        $this->linkJira();

        for ($sequence = 0; $sequence < self::SEQUENCES; ++$sequence) {
            $date = \sprintf('2026-09-%02d', $sequence + 1);
            $day = $this->day($date);
            /** @var array<string, string> $ids l'identifiant Jira de chaque saisie au dernier envoi abouti */
            $ids = [];

            for ($step = 0; $step < self::STEPS; ++$step) {
                if (0 === $random->getInt(0, 3)) {
                    $down = 0 === $random->getInt(0, 4);
                    if ($down) {
                        $this->simulate('panne', ['panne' => true]);
                    }

                    [$status, $sent] = $this->send('POST', '/api/days/'.$date.'/send', ['version' => self::intAt($day, 'version')]);
                    if ($down) {
                        $this->simulate('panne', ['panne' => false]);
                    }

                    if (409 === $status) {
                        self::assertSame('nothing', $sent['error'] ?? null);
                        $day = self::arrayAt($sent, 'day');
                        $this->assertSentMeansInJira($day, $date, $ids);
                        continue;
                    }

                    self::assertSame(200, $status, (string) json_encode($sent));
                    $day = $sent;

                    // Jira muet n'écrit rien : après un essai qui a pu écrire, il n'est pas vide pour autant.
                    if ($down) {
                        self::assertContains(self::at($day, 'send', 'state'), ['failed', 'unverified']);
                    }
                    // Seuls les tickets faits pour échouer manquent ; une journée qui n'en a jamais
                    // eu dans Jira arrive en entier.
                    foreach (self::arrayAt($day, 'send', 'outcomes') as $ticket => $failure) {
                        if (null !== $failure && !$down) {
                            self::assertContains($ticket, ['FERME-1', 'MOITIE-1', 'MUET-1', 'SOURD-1'], (string) json_encode(self::at($day, 'send')));
                        }
                    }
                    $this->assertSentMeansInJira($day, $date, $ids);
                    if (!$down) {
                        $this->assertInJiraIsWhatJiraHolds($day, $date);
                    }

                    continue;
                }

                $start = $random->getInt(0, self::QUARTERS - 1);
                $end = $random->getInt($start + 1, self::QUARTERS);
                [$kind, $ticket, $comment] = self::CONTENTS[$random->getInt(0, \count(self::CONTENTS) - 1)];
                $change = ['start' => Quarter::format(self::FIRST + 15 * $start), 'end' => Quarter::format(self::FIRST + 15 * $end), 'kind' => $kind];
                if ('work' === $kind) {
                    $change += ['ticket' => $ticket, 'comment' => $comment];
                }

                [$status, $written] = $this->patchSlots(self::intAt($day, 'version'), [$change], $date);
                self::assertSame(200, $status, (string) json_encode($written));
                $day = $written;
                $this->assertSentMeansInJira($day, $date, $ids);
            }
        }

        $colleague = array_filter(self::listAt($this->jiraState(), 'worklogs'), static fn (array $worklog): bool => Catalog::COLLEAGUE_ID === $worklog['authorId']);
        self::assertNotEmpty($colleague);
        self::assertSame([], array_filter(self::listAt($this->jiraState(), 'journal'), static fn (array $entry): bool => isset($entry['alerte'])), 'Aucune heure de collègue n\'a été touchée.');
    }

    /**
     * Ce que l'écran dit de Jira est ce que Jira a, à la minute près.
     *
     * @param array<mixed> $day
     */
    private function assertInJiraIsWhatJiraHolds(array $day, string $date): void
    {
        foreach (self::arrayAt($day, 'send', 'inJira') as $ticket => $minutes) {
            $seconds = 0;
            foreach (self::listAt($this->jiraState(), 'worklogs') as $worklog) {
                if (Catalog::ACCOUNT_ID === $worklog['authorId'] && $ticket === $worklog['issueKey'] && str_starts_with(self::stringAt($worklog, 'started'), $date)) {
                    $seconds += self::intAt($worklog, 'timeSpentSeconds');
                }
            }
            self::assertSame($minutes, (int) round($seconds / 60), 'Ce que Jira garde de '.$ticket);
        }
    }

    /**
     * Une journée qui se dit envoyée est, à la seconde près, ce que Jira a : à chaque pas,
     * après un geste comme après un envoi. Une saisie qui survit d'un envoi complet au
     * suivant garde son identifiant, à moins qu'un essai entre les deux l'ait retirée.
     *
     * @param array<mixed>          $day
     * @param array<string, string> $ids l'identifiant Jira de chaque saisie au dernier envoi complet
     */
    private function assertSentMeansInJira(array $day, string $date, array &$ids): void
    {
        $state = self::at($day, 'send', 'state');
        if (\in_array($state, ['partial', 'unverified', 'failed'], true)) {
            $ids = [];
        }
        if ('sent' !== $state) {
            return;
        }

        $expected = self::worklogsOf($day, $date);
        $actual = $this->myWorklogs($date);
        self::assertSame(array_keys($expected), array_keys($actual), 'Une journée dite envoyée a exactement ses saisies dans Jira.');
        foreach ($expected as $key => $worklog) {
            self::assertSame($worklog, $actual[$key]['worklog'], $key);
            if (isset($ids[$key])) {
                self::assertSame($ids[$key], $actual[$key]['id'], 'La saisie '.$key.' a gardé son identifiant.');
            }
        }
        $ids = array_map(static fn (array $found): string => $found['id'], $actual);
    }

    /**
     * Les saisies qu'une journée rendue doit avoir dans Jira, calculées sans le code
     * de l'envoi : par ticket et commentaire, le temps total et le premier quart d'heure.
     *
     * @param array<mixed> $day
     *
     * @return array<string, string>
     */
    private static function worklogsOf(array $day, string $date): array
    {
        /** @var array<string, array{int, int}> $groups */
        $groups = [];
        foreach (self::listAt($day, 'blocks') as $block) {
            if ('work' !== $block['kind']) {
                continue;
            }
            $comment = self::at($block, 'comment');
            $key = self::stringAt($block, 'ticket').' « '.(\is_string($comment) ? $comment : '').' »';
            $start = Quarter::parse(self::stringAt($block, 'start')) ?? 0;
            $minutes = (Quarter::parse(self::stringAt($block, 'end')) ?? 0) - $start;
            $groups[$key] = [min($groups[$key][0] ?? $start, $start), ($groups[$key][1] ?? 0) + 60 * $minutes];
        }
        ksort($groups);

        return array_map(
            static fn (array $group): string => new \DateTimeImmutable($date, new \DateTimeZone('Europe/Paris'))->setTime(intdiv($group[0], 60), $group[0] % 60)->format('Y-m-d\TH:i:s.vO').' '.$group[1],
            $groups,
        );
    }

    /**
     * @return array<string, array{id: string, worklog: string}>
     */
    private function myWorklogs(string $date): array
    {
        $found = [];
        foreach (self::listAt($this->jiraState(), 'worklogs') as $worklog) {
            if (Catalog::ACCOUNT_ID !== $worklog['authorId'] || !str_starts_with(self::stringAt($worklog, 'started'), $date)) {
                continue;
            }
            $key = self::stringAt($worklog, 'issueKey').' « '.(JiraWorklog::textOf($worklog['comment']) ?? '').' »';
            self::assertArrayNotHasKey($key, $found, 'Un double dans Jira : '.$key);
            $found[$key] = ['id' => self::stringAt($worklog, 'id'), 'worklog' => self::stringAt($worklog, 'started').' '.self::intAt($worklog, 'timeSpentSeconds')];
        }
        ksort($found);

        return $found;
    }
}
