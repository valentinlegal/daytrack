<?php

namespace App\Tests\Sending;

use App\Jira\JiraWorklog;
use App\Jira\WorklogWrite;
use App\Sending\Worklog;
use App\Sending\WorklogPlan;
use PHPUnit\Framework\TestCase;

/**
 * Ce qu'un renvoi écrit dans Jira : rien de plus que ce qui a changé, et une saisie
 * déjà dans Jira se corrige sur place.
 */
final class WorklogPlanTest extends TestCase
{
    public function testCeQuiEstDejaJusteNeSEcritPas(): void
    {
        $plan = WorklogPlan::between([self::wanted('09:30', 900, 'Revue')], [self::jira('1', '09:30', 900, 'Revue')]);

        self::assertTrue($plan->isEmpty());
    }

    public function testUnTempsChangeSeCorrigeSansRienDAutre(): void
    {
        $plan = WorklogPlan::between([self::wanted('09:30', 1800, 'Revue')], [self::jira('1', '09:30', 900, 'Revue')]);

        self::assertSame(['corriger 1 : 1800 s'], self::describe($plan));
    }

    public function testUnCommentaireChangeSeCorrigeAuLieuDUnRetraitSuiviDUnAjout(): void
    {
        $plan = WorklogPlan::between([self::wanted('09:30', 900, 'Tests')], [self::jira('1', '09:30', 900, 'Revue')]);

        self::assertSame(['corriger 1 : « Tests »'], self::describe($plan));
    }

    public function testUnCommentaireRetireSEffaceDansJira(): void
    {
        $plan = WorklogPlan::between([self::wanted('09:30', 900, null)], [self::jira('1', '09:30', 900, 'Revue')]);

        self::assertSame(['corriger 1 : sans commentaire'], self::describe($plan));
    }

    public function testUneHeureDeplaceeSeCorrige(): void
    {
        $plan = WorklogPlan::between([self::wanted('10:00', 900, null)], [self::jira('1', '09:30', 900, null)]);

        self::assertSame(['corriger 1 : à 10:00'], self::describe($plan));
    }

    public function testCeQuiManqueSAjouteEtCeQuiEstEnTropSeRetireEnPremier(): void
    {
        $plan = WorklogPlan::between(
            [self::wanted('09:30', 900, 'Revue'), self::wanted('11:00', 1800, 'Tests')],
            [self::jira('1', '09:30', 900, 'Revue'), self::jira('2', '14:00', 900, 'Revue'), self::jira('3', '15:00', 900, 'Revue')],
        );

        // « Tests » prend la place de la première saisie restante plutôt que d'en créer une.
        self::assertSame(['retirer 3', 'corriger 2 : à 11:00, 1800 s, « Tests »'], self::describe($plan));
    }

    public function testLesSaisiesSApparientDAbordParCommentaire(): void
    {
        $plan = WorklogPlan::between(
            [self::wanted('09:30', 1800, 'Tests'), self::wanted('10:00', 900, 'Revue')],
            [self::jira('1', '09:30', 900, 'Revue'), self::jira('2', '10:00', 900, 'Tests')],
        );

        self::assertSame(['corriger 2 : à 09:30, 1800 s', 'corriger 1 : à 10:00'], self::describe($plan));
    }

    public function testUnDoubleLaisseParUnAjoutResteSansReponseSeRetire(): void
    {
        $plan = WorklogPlan::between([self::wanted('09:30', 900, null)], [self::jira('7', '09:30', 900, null), self::jira('8', '09:30', 900, null)]);

        self::assertSame(['retirer 8'], self::describe($plan));
    }

    public function testUneJourneeQuiNAPlusRienRetireTout(): void
    {
        self::assertSame(['retirer 1', 'retirer 2'], self::describe(WorklogPlan::between([], [self::jira('1', '09:30', 900, null), self::jira('2', '10:00', 900, null)])));
    }

    public function testRenvoyerDixFoisNeLaissePasDixTraces(): void
    {
        // 15 minutes, puis 30, puis 15, puis un autre commentaire : une seule saisie,
        // ajoutée une fois puis corrigée trois fois.
        $jira = [];
        $writes = [];
        foreach ([[900, 'Revue'], [1800, 'Revue'], [900, 'Revue'], [900, 'Tests']] as [$seconds, $comment]) {
            $plan = WorklogPlan::between([self::wanted('09:30', $seconds, $comment)], $jira);
            foreach ($plan->writes as $write) {
                $writes[] = $write->isAdd() ? 'ajouter' : ($write->delete ? 'retirer' : 'corriger');
            }
            $jira = [self::jira('1', '09:30', $seconds, $comment)];
        }

        self::assertSame(['ajouter', 'corriger', 'corriger', 'corriger'], $writes);
    }

    private static function wanted(string $time, int $seconds, ?string $comment): Worklog
    {
        return new Worklog('SHOP-482', $comment, new \DateTimeImmutable('2026-10-06T'.$time.':00+02:00'), $seconds);
    }

    private static function jira(string $id, string $time, int $seconds, ?string $comment): JiraWorklog
    {
        return new JiraWorklog($id, 'SHOP-482', new \DateTimeImmutable('2026-10-06T'.$time.':00.000+0200'), $seconds, $comment);
    }

    /**
     * @return list<string>
     */
    private static function describe(WorklogPlan $plan): array
    {
        return array_map(static function (WorklogWrite $write): string {
            if ($write->isAdd()) {
                return 'ajouter : '.$write->seconds.' s';
            }
            if ($write->delete) {
                return 'retirer '.$write->id;
            }

            return 'corriger '.$write->id.' : '.implode(', ', array_filter([
                null === $write->started ? null : 'à '.$write->started->setTimezone(new \DateTimeZone('Europe/Paris'))->format('H:i'),
                null === $write->seconds ? null : $write->seconds.' s',
                match ($write->comment) {
                    null => null,
                    '' => 'sans commentaire',
                    default => '« '.$write->comment.' »',
                },
            ]));
        }, $plan->writes);
    }
}
