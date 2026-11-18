<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use App\Tests\Support\RecurrenceApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * « Cette fois seulement » ou « Cette fois et les suivantes », sur un bloc qui revient, par
 * l'API comme les envoie la page : cette fois seulement est un geste ordinaire de la grille,
 * qui détache la fois ; les suivantes passent par la fenêtre, qui coupe la récurrence, l'arrête
 * ou l'efface à partir de ce jour. Annuler et rétablir chacun, aujourd'hui, sur un jour à venir
 * où la fois n'est que prévue, le premier jour de la récurrence, et depuis un onglet en retard
 * ou un appelant hostile.
 *
 * L'heure est figée au mardi 6 octobre 2026, 15:20 à Paris : le Daily y naît, chaque jour
 * de la semaine.
 */
final class RecurrenceScopeTest extends WebTestCase
{
    use DayApi;
    use RecurrenceApi;

    private const string WEDNESDAY = '2026-10-07';

    private const string THURSDAY = '2026-10-08';

    private const string FRIDAY = '2026-10-09';

    private const string DAILY = '09:15-09:30 OPS-12 « Daily » ↻daily';

    public function testModifierCetteFoisSeulementNeChangeQueCetteFois(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];

        // Aujourd'hui : un autre commentaire, cette fois seulement.
        $once = $this->write(1, [self::retro()]);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro »'], self::arrows($once));
        self::assertSame([555 => null], $this->links());
        self::assertSame([$id.' '.self::TODAY], $this->skips());
        self::assertNull($this->recurrenceRow($id)['until'], 'La récurrence ne change pas.');
        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names), 'Les fois suivantes la gardent.');

        $undone = $this->undo(self::intAt($once, 'version'), [self::linked(self::daily(), $id)]);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([555 => $id], $this->links());
        self::assertSame([], $this->skips());

        // Un jour à venir : la fois prévue se pose, détachée, avec l'autre commentaire.
        $once = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::retro()], self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro »'], self::arrows($once));
        self::assertSame([555 => null], $this->links(self::THURSDAY));
        self::assertSame([$id.' '.self::THURSDAY], $this->skips());
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), $names), 'Le lendemain la garde.');
        self::assertSame([self::DAILY], self::arrows($this->day('2026-10-15'), $names), 'La semaine suivante aussi.');

        $undone = $this->undo(self::intAt($once, 'version'), [self::linked(self::daily(), $id)], date: self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([], $this->links(self::THURSDAY), 'Rendue à la prévision, elle n\'est plus écrite.');
        self::assertSame([], $this->skips());

        $redone = $this->write(self::intAt($undone, 'version'), [self::retro()], self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro »'], self::arrows($redone));
        self::assertSame([$id.' '.self::THURSDAY], $this->skips());
    }

    public function testModifierAvecLesSuivantesSurUnJourAVenirCoupeLaRecurrence(): void
    {
        [$id] = $this->repeat(0, self::daily());

        $cut = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::retro()], self::weekly(), $id, self::THURSDAY);

        $new = self::stringAt($cut, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'rétro'];
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => self::WEDNESDAY],
            ['recurrence' => $new, 'before' => self::WEDNESDAY, 'after' => null],
        ], $cut['untils']);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($cut, $names));
        self::assertSame([$new], array_keys(self::arrayAt($cut, 'recurrences')));
        self::assertSame([555 => $new], $this->links(self::THURSDAY), 'Écrite, le jour où la nouvelle naît.');
        self::assertSame([$id.' '.self::THURSDAY], $this->skips(), 'La coupe garde son saut.');
        self::assertSame(['firstDay' => self::THURSDAY, 'until' => null, 'posedThrough' => self::THURSDAY], $this->recurrenceRow($new));
        // L'ancienne garde les jours d'avant ; les suivants viennent de la nouvelle.
        self::assertSame([self::DAILY], self::arrows($this->day(), $names));
        self::assertSame([self::DAILY], self::arrows($this->day(self::WEDNESDAY), $names));
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($this->day(self::FRIDAY), $names));
        self::assertSame([self::TODAY, self::THURSDAY], $this->dates());

        // Annuler : les fins d'avant, et la fois du jeudi rendue à la prévision de l'ancienne.
        $undone = $this->undo(self::intAt($cut, 'version'), [self::linked(self::daily(), $id)], $cut, self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([$id], array_keys(self::arrayAt($undone, 'recurrences')));
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame(self::WEDNESDAY, $this->recurrenceRow($new)['until'], 'La nouvelle est retirée.');
        self::assertNotContains($id.' '.self::THURSDAY, $this->skips());
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), $names));

        // Rétablir refait la coupe.
        $redone = $this->redo(self::intAt($undone, 'version'), [self::linked(self::retro(), $new)], $cut, self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($redone, $names));
        self::assertSame([555 => $new], $this->links(self::THURSDAY));
        self::assertSame([$id.' '.self::THURSDAY], $this->skips());
        self::assertSame(self::WEDNESDAY, $this->recurrenceRow($id)['until']);
        self::assertNull($this->recurrenceRow($new)['until']);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($this->day(self::FRIDAY), $names));
    }

    public function testModifierAvecLesSuivantesAuMemeRythmeGardeLesFoisEffacees(): void
    {
        [$id] = $this->repeat(0, self::daily());
        // Sa fois du vendredi effacée, cette fois seulement.
        $this->write(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('09:15', '09:30')], self::FRIDAY);
        self::assertSame([$id.' '.self::FRIDAY], $this->skips());

        // Le jeudi, un autre commentaire avec les suivantes, au même rythme : la nouvelle reprend
        // la suite de l'ancienne, sa fois effacée comprise.
        $cut = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::retro()], self::weekly(), $id, self::THURSDAY);

        $new = self::stringAt($cut, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'rétro'];
        self::assertSame([], self::arrows($this->day(self::FRIDAY), $names), 'La fois effacée ne revient pas.');
        self::assertSame([self::FRIDAY], self::arrayAt($cut, 'recurrences', $new, 'skipped'));
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($this->day('2026-10-12'), $names));

        // Annuler : la journée d'avant, la fois du vendredi effacée de l'ancienne.
        $undone = $this->undo(self::intAt($cut, 'version'), [self::linked(self::daily(), $id)], $cut, self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([self::FRIDAY], self::arrayAt($undone, 'recurrences', $id, 'skipped'));
        self::assertSame([], self::arrows($this->day(self::FRIDAY), $names));
        self::assertSame([self::DAILY], self::arrows($this->day('2026-10-12'), $names));

        // Rétablir refait la coupe, sa fois toujours effacée.
        $redone = $this->redo(self::intAt($undone, 'version'), [self::linked(self::retro(), $new)], $cut, self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($redone, $names));
        self::assertSame([], self::arrows($this->day(self::FRIDAY), $names));
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($this->day('2026-10-12'), $names));
    }

    public function testModifierAvecLesSuivantesUnAutreRythmeNeGardePasLesFoisEffacees(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $this->write(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('09:15', '09:30')], self::FRIDAY);

        // Le jeudi, le jeudi et le vendredi seulement : une autre récurrence, que rien n'a effacé.
        $cut = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::daily()], self::weekly([4, 5]), $id, self::THURSDAY);

        $new = self::stringAt($cut, 'untils', 1, 'recurrence');
        self::assertSame([], self::arrayAt($cut, 'recurrences', $new, 'skipped'));
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), [$new => 'daily']));
    }

    public function testModifierAvecLesSuivantesAuMemeRythmeGardeLaFoisQuUn0h00Retient(): void
    {
        [$id] = $this->repeat(0, self::daily());
        // Le vendredi mis à 0h00 d'avance retient la fois du Daily.
        [$status] = $this->putObjective(self::intAt($this->day(self::FRIDAY), 'version'), 0, self::FRIDAY);
        self::assertSame(200, $status);

        $cut = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::retro()], self::weekly(), $id, self::THURSDAY);

        $new = self::stringAt($cut, 'untils', 1, 'recurrence');
        self::assertSame([], self::arrayAt($cut, 'recurrences', $new, 'skipped'), 'Retenue, elle garde son créneau.');
        // Le vendredi venu, toujours à 0h00, rien ne s'y pose ; revenu à son objectif, il reçoit
        // la fois de la nouvelle, comme il aurait reçu celle de l'ancienne.
        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'));
        [$status, $back] = $this->putObjective(self::intAt($this->day(self::FRIDAY), 'version'), 450, self::FRIDAY);
        self::assertSame(200, $status, json_encode($back, \JSON_THROW_ON_ERROR));
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($back, [$new => 'rétro']));
    }

    public function testModifierAvecLesSuivantesLePremierJourLaChangeEnPlace(): void
    {
        [$id] = $this->repeat(0, self::daily());

        $cut = $this->saveRecurrence(1, [self::retro()], self::weekly(), $id);

        $new = self::stringAt($cut, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'rétro'];
        self::assertSame([
            ['recurrence' => $id, 'before' => null, 'after' => '2026-10-05'],
            ['recurrence' => $new, 'before' => '2026-10-05', 'after' => null],
        ], $cut['untils'], 'L\'ancienne est retirée : pour l\'utilisateur, la récurrence change en place.');
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($cut, $names));
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($this->day(self::THURSDAY), $names));

        $undone = $this->undo(self::intAt($cut, 'version'), [self::linked(self::daily(), $id)], $cut);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([555 => $id], $this->links());
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame('2026-10-05', $this->recurrenceRow($new)['until']);
        self::assertNotContains($id.' '.self::TODAY, $this->skips());
        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names));

        $redone = $this->redo(self::intAt($undone, 'version'), [self::linked(self::retro(), $new)], $cut);
        self::assertSame(['09:15-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($redone, $names));
        self::assertSame('2026-10-05', $this->recurrenceRow($id)['until']);
    }

    public function testArreterCetteFoisSeulementGardeLeBlocEtLaRecurrence(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];

        // La case décochée, cette fois seulement : le même contenu, sans lien.
        $once = $this->write(1, [self::daily()]);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($once), 'Le bloc reste, sans flèche.');
        self::assertSame([555 => null], $this->links());
        self::assertSame([$id.' '.self::TODAY], $this->skips());
        self::assertSame([], self::arrayAt($once, 'recurrences'));
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([self::DAILY], self::arrows($this->day(self::WEDNESDAY), $names), 'Elle continue ensuite.');

        $undone = $this->undo(self::intAt($once, 'version'), [self::linked(self::daily(), $id)]);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([], $this->skips());

        // Sur un jour à venir, la fois prévue s'écrit sans lien.
        $once = $this->write(self::intAt($this->day(self::THURSDAY), 'version'), [self::daily()], self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($once));
        self::assertSame([555 => null], $this->links(self::THURSDAY));
        self::assertSame([$id.' '.self::THURSDAY], $this->skips());
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), $names));

        $undone = $this->undo(self::intAt($once, 'version'), [self::linked(self::daily(), $id)], date: self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([], $this->rows(self::THURSDAY), 'De nouveau prévue, sans rien d\'écrit.');
        self::assertSame([], $this->skips());

        // Le jour venu, elle s'y pose comme ailleurs.
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names));
        self::assertSame([555 => $id], $this->links(self::THURSDAY));
    }

    public function testArreterAvecLesSuivantesNeLaissePasDeSautEtAnnulerRendTout(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];

        // Depuis un jour à venir : le bloc s'écrit sans lien, la récurrence finit la veille.
        $stopped = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::daily()], null, $id, self::THURSDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($stopped));
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => self::WEDNESDAY]], $stopped['untils']);
        self::assertSame([555 => null], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips(), 'Elle ne va plus jusqu\'à ce jour : rien n\'y est à sauter.');
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'));

        $undone = $this->undo(self::intAt($stopped, 'version'), [self::linked(self::daily(), $id)], $stopped, self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([], $this->rows(self::THURSDAY), 'De nouveau prévue, sans rien d\'écrit.');
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([], $this->skips());
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), $names));

        // Le premier jour : retirée, et rendue.
        $stopped = $this->saveRecurrence(1, [self::daily()], null, $id);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($stopped));
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => '2026-10-05']], $stopped['untils']);
        self::assertSame([], $this->skips());
        self::assertSame([], self::listAt($this->day(self::THURSDAY), 'blocks'));

        $undone = $this->undo(self::intAt($stopped, 'version'), [self::linked(self::daily(), $id)], $stopped);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([555 => $id], $this->links());
        self::assertSame([], $this->skips());
        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names));
    }

    public function testEffacerCetteFoisSeulementLaDetacheEtAnnulerLaRend(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];

        $erased = $this->write(1, [self::clear('09:15', '09:30')]);
        self::assertSame([], self::listAt($erased, 'blocks'));
        self::assertSame([$id.' '.self::TODAY], $this->skips());
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names), 'Les suivantes la gardent.');

        $undone = $this->undo(self::intAt($erased, 'version'), [self::linked(self::daily(), $id)]);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([555 => $id], $this->links());
        self::assertSame([], $this->skips());
        $this->write(self::intAt($undone, 'version'), [self::clear('09:15', '09:30')]);
        self::assertSame([$id.' '.self::TODAY], $this->skips(), 'Rétablir la détache de nouveau.');

        // Un jour à venir : rien ne s'écrit, pas même la journée.
        $thursday = $this->day(self::THURSDAY);
        $erased = $this->write(self::intAt($thursday, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame([], self::listAt($erased, 'blocks'));
        self::assertSame([self::TODAY], $this->dates());
        self::assertSame([$id.' '.self::TODAY, $id.' '.self::THURSDAY], $this->skips());

        $undone = $this->undo(self::intAt($erased, 'version'), [self::linked(self::daily(), $id)], date: self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame($thursday['version'], $undone['version'], 'Le jeudi d\'avant, exactement.');
        self::assertSame([self::TODAY], $this->dates());
        self::assertSame([$id.' '.self::TODAY], $this->skips());

        $redone = $this->write(self::intAt($undone, 'version'), [self::clear('09:15', '09:30')], self::THURSDAY);
        self::assertSame([], self::listAt($redone, 'blocks'));
        self::assertSame([self::TODAY], $this->dates());
    }

    public function testEffacerAvecLesSuivantesAujourdhuiArreteLaRecurrenceEtEffaceLeBloc(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $thursday = $this->day(self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($thursday, $names));

        $erased = $this->saveRecurrence(self::intAt($thursday, 'version'), [self::clear('09:15', '09:30')], null, $id, self::THURSDAY);

        self::assertSame([], self::listAt($erased, 'blocks'));
        self::assertSame([], self::arrayAt($erased, 'recurrences'));
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => self::WEDNESDAY]], $erased['untils']);
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips(), 'Elle ne va plus jusqu\'à ce jour : rien n\'y est à sauter.');
        self::assertSame(0, self::at($erased, 'figures', 'worked'));
        // Les jours d'avant ne changent jamais.
        self::assertSame([555 => $id], $this->links(self::TODAY));
        self::assertSame([555 => $id], $this->links(self::WEDNESDAY));
        self::assertSame([self::DAILY], self::arrows($this->day(self::WEDNESDAY), $names));

        $undone = $this->undo(self::intAt($erased, 'version'), [self::linked(self::daily(), $id)], $erased, self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([555 => $id], $this->links(self::THURSDAY));
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([], $this->skips());
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), $names));

        $redone = $this->redo(self::intAt($undone, 'version'), [self::clear('09:15', '09:30')], $erased, self::THURSDAY);
        self::assertSame([], self::listAt($redone, 'blocks'));
        self::assertSame(self::WEDNESDAY, $this->recurrenceRow($id)['until']);
        self::assertSame([555 => $id], $this->links(self::WEDNESDAY));
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'));

        self::mockTime('2026-10-12 08:00:00 Europe/Paris');
        self::assertSame([], self::listAt($this->day('2026-10-12'), 'blocks'));
        self::assertSame([self::TODAY, self::WEDNESDAY, self::THURSDAY], $this->dates());
    }

    public function testEffacerAvecLesSuivantesUneFoisPrevueNeCreePasLaJournee(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];
        $thursday = $this->day(self::THURSDAY);

        $erased = $this->saveRecurrence(self::intAt($thursday, 'version'), [self::clear('09:15', '09:30')], null, $id, self::THURSDAY);

        self::assertSame([], self::listAt($erased, 'blocks'));
        self::assertSame(0, $erased['version'], 'Rien n\'y est saisi : la journée n\'existe toujours pas.');
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => self::WEDNESDAY]], $erased['untils']);
        self::assertSame([self::TODAY], $this->dates());
        self::assertSame([], $this->skips());
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'));
        // Les jours d'avant ne changent jamais.
        self::assertSame([self::DAILY], self::arrows($this->day(self::WEDNESDAY), $names));
        self::assertSame([555 => $id], $this->links());

        // Annuler la rend prévue, sans rien y saisir.
        $undone = $this->undo(0, [self::linked(self::daily(), $id)], $erased, self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([], $this->rows(self::THURSDAY));
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([], $this->skips());
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), $names));

        $redone = $this->redo(self::intAt($undone, 'version'), [self::clear('09:15', '09:30')], $erased, self::THURSDAY);
        self::assertSame([], self::listAt($redone, 'blocks'));
        self::assertSame([], $this->rows(self::THURSDAY));
        self::assertSame(self::WEDNESDAY, $this->recurrenceRow($id)['until']);
        self::assertSame([self::DAILY], self::arrows($this->day(self::WEDNESDAY), $names));
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'));
    }

    public function testEffacerAvecLesSuivantesLePremierJourLaRetire(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];

        $erased = $this->saveRecurrence(1, [self::clear('09:15', '09:30')], null, $id);

        self::assertSame([], self::listAt($erased, 'blocks'));
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => '2026-10-05']], $erased['untils']);
        self::assertSame([], $this->links());
        self::assertSame([], $this->skips());
        self::assertSame(1, $this->recurrenceRows(), 'Retirée, pas supprimée : annuler la rend.');
        self::assertSame([], self::listAt($this->day(self::THURSDAY), 'blocks'));

        $undone = $this->undo(self::intAt($erased, 'version'), [self::linked(self::daily(), $id)], $erased);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([555 => $id], $this->links());
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names));

        $redone = $this->redo(self::intAt($undone, 'version'), [self::clear('09:15', '09:30')], $erased);
        self::assertSame([], self::listAt($redone, 'blocks'));
        self::assertSame('2026-10-05', $this->recurrenceRow($id)['until']);
        self::assertSame([], self::listAt($this->day(self::THURSDAY), 'blocks'));
        self::assertSame([self::TODAY], $this->dates());
    }

    public function testEffacerAvecLesSuivantesEmporteLesAutresMorceauxDeLaFois(): void
    {
        // Saisi avant elle : la fois prévue du jeudi se montre en deux morceaux autour.
        $this->write(0, [self::work('09:30', '09:45', 'SHOP-482')], self::THURSDAY);
        [$id] = $this->repeat(0, self::work('09:00', '10:00', 'OPS-12', 'Daily'));
        $thursday = $this->day(self::THURSDAY);
        self::assertSame(['09:00-09:30 OPS-12 « Daily » ↻daily', '09:30-09:45 SHOP-482', '09:45-10:00 OPS-12 « Daily » ↻daily'], self::arrows($thursday, [$id => 'daily']));

        // Comme la page : toute la fois, ses deux morceaux.
        $erased = $this->saveRecurrence(self::intAt($thursday, 'version'), [self::clear('09:00', '09:30'), self::clear('09:45', '10:00')], null, $id, self::THURSDAY);
        self::assertSame(['09:30-09:45 SHOP-482'], self::arrows($erased));
        self::assertSame([570 => null], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips());

        $undone = $this->undo(self::intAt($erased, 'version'), [self::linked(self::work('09:00', '09:30', 'OPS-12', 'Daily'), $id), self::linked(self::work('09:45', '10:00', 'OPS-12', 'Daily'), $id)], $erased, self::THURSDAY);
        self::assertSame(self::arrows($thursday), self::arrows($undone));
        self::assertSame([570 => null], $this->links(self::THURSDAY));

        // Un appelant qui ne nomme qu'un morceau : l'autre suit la fois, écrit sans lien.
        $erased = $this->saveRecurrence(self::intAt($undone, 'version'), [self::clear('09:00', '09:30')], null, $id, self::THURSDAY);
        self::assertSame(['09:30-09:45 SHOP-482', '09:45-10:00 OPS-12 « Daily »'], self::arrows($erased));
        self::assertSame([570 => null, 585 => null], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips());
    }

    public function testLesBornesDeLaGrilleSEffacentAvecLesSuivantes(): void
    {
        [$morning] = $this->repeat(0, self::work('07:00', '07:15', 'OPS-12', 'Matin'));
        [$evening] = $this->repeat(1, self::work('19:45', '20:00', 'OPS-7', 'Soir'));
        $names = [$morning => 'matin', $evening => 'soir'];
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $thursday = $this->day(self::THURSDAY);
        self::assertSame(['07:00-07:15 OPS-12 « Matin » ↻matin', '19:45-20:00 OPS-7 « Soir » ↻soir'], self::arrows($thursday, $names));
        $version = self::intAt($thursday, 'version');

        // Un quart d'heure de trop, d'un côté ou de l'autre : refusé, rien ne bouge.
        foreach ([[self::clear('06:45', '07:15'), $morning, 'changes[0].start'], [self::clear('19:45', '20:15'), $evening, 'changes[0].end']] as [$change, $id, $field]) {
            [$status, $body] = $this->putRecurrence($version, [$change], null, $id, self::THURSDAY);
            self::assertSame(422, $status, $field);
            self::assertContains($field, array_column(self::listAt($body, 'violations'), 'field'));
        }
        self::assertSame($version, $this->day(self::THURSDAY)['version']);
        self::assertSame([null, null], [$this->recurrenceRow($morning)['until'], $this->recurrenceRow($evening)['until']]);

        $day = $this->saveRecurrence($version, [self::clear('07:00', '07:15')], null, $morning, self::THURSDAY);
        $day = $this->saveRecurrence(self::intAt($day, 'version'), [self::clear('19:45', '20:00')], null, $evening, self::THURSDAY);

        self::assertSame([], self::listAt($day, 'blocks'));
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertSame([self::WEDNESDAY, self::WEDNESDAY], [$this->recurrenceRow($morning)['until'], $this->recurrenceRow($evening)['until']]);
        self::assertSame([], $this->skips());
        self::assertSame([420 => $morning, 1185 => $evening], $this->links(self::WEDNESDAY), 'Les jours d\'avant ne changent jamais.');
    }

    public function testEffacerAvecLesSuivantesLeJourDeSaFin(): void
    {
        [$id] = $this->repeat(0, self::daily(), until: self::THURSDAY);
        $names = [$id => 'daily'];

        // Le jeudi à venir, sa dernière fois, prévue.
        $erased = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:15', '09:30')], null, $id, self::THURSDAY);
        self::assertSame([['recurrence' => $id, 'before' => self::THURSDAY, 'after' => self::WEDNESDAY]], $erased['untils']);
        self::assertSame([], self::listAt($erased, 'blocks'));
        self::assertSame([self::TODAY], $this->dates());
        $undone = $this->undo(0, [self::linked(self::daily(), $id)], $erased, self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame(self::THURSDAY, $this->recurrenceRow($id)['until']);

        // Le jeudi venu, posée.
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $thursday = $this->day(self::THURSDAY);
        self::assertSame([555 => $id], $this->links(self::THURSDAY));
        $erased = $this->saveRecurrence(self::intAt($thursday, 'version'), [self::clear('09:15', '09:30')], null, $id, self::THURSDAY);
        self::assertSame([['recurrence' => $id, 'before' => self::THURSDAY, 'after' => self::WEDNESDAY]], $erased['untils']);
        self::assertSame([], $this->links(self::THURSDAY));
        self::assertSame([], $this->skips());

        $undone = $this->undo(self::intAt($erased, 'version'), [self::linked(self::daily(), $id)], $erased, self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame(self::THURSDAY, $this->recurrenceRow($id)['until']);
        self::assertSame([555 => $id], $this->links(self::THURSDAY));
    }

    public function testDepuisUnJourPasseEffacerAvecLesSuivantesNEffaceQueCetteFois(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];
        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        $tuesday = $this->day(self::TODAY);

        // La page ne le demande jamais d'un jour passé : un appelant hostile.
        $erased = $this->saveRecurrence(self::intAt($tuesday, 'version'), [self::clear('09:15', '09:30')], null, $id);

        self::assertSame([], self::listAt($erased, 'blocks'), 'Cette fois, effacée.');
        self::assertSame([$id.' '.self::TODAY], $this->skips(), 'Détachée, cette fois seulement.');
        self::assertSame([['recurrence' => $id, 'before' => null, 'after' => self::THURSDAY]], $erased['untils'], 'Arrêtée après aujourd\'hui.');
        // Aucune autre fois passée, ni celle d'aujourd'hui, ne change.
        self::assertSame([555 => $id], $this->links(self::WEDNESDAY));
        self::assertSame([555 => $id], $this->links(self::THURSDAY));
        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names));
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'));

        $undone = $this->undo(self::intAt($erased, 'version'), [self::linked(self::daily(), $id)], $erased);
        self::assertSame([self::DAILY], self::arrows($undone, $names));
        self::assertSame([], $this->skips());
        self::assertNull($this->recurrenceRow($id)['until']);
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), $names));
    }

    public function testUnOngletEnRetardNEffacePasAvecLesSuivantes(): void
    {
        [$id, $today] = $this->repeat(0, self::daily());
        // L'onglet 1 est ouvert sur le vendredi, fenêtre du Daily comprise : sans fin.
        $friday = $this->day(self::FRIDAY);
        self::assertSame([self::DAILY], self::arrows($friday, [$id => 'daily']));
        $seen = $this->seen($id);
        $erase = ['version' => self::intAt($friday, 'version'), 'changes' => [self::clear('09:15', '09:30')], 'recurrence' => null, 'replaces' => $seen];

        // L'onglet 2 lui donne une fin, en place, depuis aujourd'hui : le vendredi ne change pas de version.
        $this->saveRecurrence(self::intAt($today, 'version'), [self::daily()], self::weekly(until: '2026-10-30'), $id);
        self::assertSame($friday['version'], $this->day(self::FRIDAY)['version']);
        [$status, $body] = $this->send('PUT', '/api/days/'.self::FRIDAY.'/recurrence', $erase);
        self::assertSame(409, $status, 'La fenêtre a vu une autre fin.');
        self::assertSame('stale', $body['error']);
        self::assertSame('2026-10-30', $this->recurrenceRow($id)['until']);
        self::assertSame([self::TODAY], $this->dates());
        self::assertSame([], $this->skips());

        // L'onglet 1 relit le vendredi ; l'onglet 2 efface avec les suivantes depuis le jeudi.
        $friday = $this->day(self::FRIDAY);
        $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:15', '09:30')], null, $id, self::THURSDAY);

        // Le geste suivant de l'onglet 1, quel qu'il soit, est refusé : la journée a changé entre-temps.
        $version = self::intAt($friday, 'version');
        foreach ([
            $this->patchSlots($version, [self::work('14:00', '14:15', 'OPS-7')], self::FRIDAY),
            $this->patchSlots($version, [self::retro()], self::FRIDAY),
            $this->patchSlots($version, [self::clear('09:15', '09:30')], self::FRIDAY),
            $this->send('PUT', '/api/days/'.self::FRIDAY.'/recurrence', ['replaces' => $this->seen($id)] + $erase + ['version' => $version]),
            $this->send('PUT', '/api/days/'.self::FRIDAY.'/recurrence', ['changes' => [self::daily()], 'replaces' => $this->seen($id)] + $erase + ['version' => $version]),
        ] as [$status, $body]) {
            self::assertSame(409, $status, json_encode($body, \JSON_THROW_ON_ERROR));
            self::assertSame('stale', $body['error']);
            self::assertSame([], self::listAt(self::arrayAt($body, 'day'), 'blocks'), 'La journée relue ne la prévoit plus.');
        }
        self::assertSame(self::WEDNESDAY, $this->recurrenceRow($id)['until']);
        self::assertSame([self::TODAY], $this->dates());
        self::assertSame([], $this->skips());
    }

    public function testLeJourVenuApresUneCoupeChaqueJourRecoitLaSienne(): void
    {
        // Saisis avant elle, le mercredi et le vendredi : rien ne se pose par-dessus.
        $this->write(0, [self::work('09:15', '09:30', 'SHOP-482')], self::WEDNESDAY);
        $this->write(0, [self::work('09:15', '09:30', 'SHOP-482')], self::FRIDAY);
        [$id] = $this->repeat(0, self::work('09:00', '09:30', 'OPS-12', 'Daily'));
        $cut = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::work('09:00', '09:30', 'OPS-12', 'Rétro')], self::weekly(), $id, self::THURSDAY);
        $new = self::stringAt($cut, 'untils', 1, 'recurrence');
        $names = [$id => 'daily', $new => 'rétro'];
        self::assertSame(['09:00-09:15 OPS-12 « Rétro » ↻rétro', '09:15-09:30 SHOP-482'], self::arrows($this->day(self::FRIDAY), $names));
        $thursday = self::intAt($this->day(self::THURSDAY), 'version');

        self::mockTime('2026-10-07 08:00:00 Europe/Paris');
        self::assertSame(['09:00-09:15 OPS-12 « Daily » ↻daily', '09:15-09:30 SHOP-482'], self::arrows($this->day(self::WEDNESDAY), $names));
        self::assertSame([540 => $id, 555 => null], $this->links(self::WEDNESDAY));
        self::assertSame([540 => $new, 555 => $new], $this->links(self::THURSDAY));

        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame(['09:00-09:30 OPS-12 « Rétro » ↻rétro'], self::arrows($this->day(self::THURSDAY), $names));
        self::assertSame([540 => $new, 555 => $new], $this->links(self::THURSDAY), 'Ni l\'ancienne ni une seconde fois de la nouvelle.');
        self::assertSame($thursday, $this->day(self::THURSDAY)['version'], 'Rien n\'y a été posé.');

        self::mockTime('2026-10-09 08:00:00 Europe/Paris');
        self::assertSame(['09:00-09:15 OPS-12 « Rétro » ↻rétro', '09:15-09:30 SHOP-482'], self::arrows($this->day(self::FRIDAY), $names));
        self::assertSame([540 => $new, 555 => null], $this->links(self::FRIDAY));
        self::assertSame([540 => $id, 555 => null], $this->links(self::WEDNESDAY));
        self::assertSame([$id.' '.self::THURSDAY], $this->skips());
    }

    public function testLeJourVenuApresUnEffacementAvecLesSuivantesNeRecoitRien(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:15', '09:30')], null, $id, self::THURSDAY);

        self::mockTime('2026-10-07 08:00:00 Europe/Paris');
        self::assertSame([self::DAILY], self::arrows($this->day(self::WEDNESDAY), [$id => 'daily']));
        self::assertSame([555 => $id], $this->links(self::WEDNESDAY));

        self::mockTime('2026-10-08 08:00:00 Europe/Paris');
        self::assertSame([], self::listAt($this->day(self::THURSDAY), 'blocks'));

        self::mockTime('2026-10-15 08:00:00 Europe/Paris');
        self::assertSame([], self::listAt($this->day('2026-10-15'), 'blocks'));
        self::assertSame([self::TODAY, self::WEDNESDAY], $this->dates());
        self::assertSame([], $this->skips());
    }

    public function testRepousserLaFinApresUnEffacementAvecLesSuivantesRendLaFoisPrevue(): void
    {
        [$id, $today] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];
        $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:15', '09:30')], null, $id, self::THURSDAY);
        self::assertSame([], self::listAt($this->day(self::THURSDAY), 'blocks'));

        // Depuis la fois prévue du mercredi, « Jusqu'au » vidé : la même récurrence, en place.
        $wednesday = $this->saveRecurrence(self::intAt($this->day(self::WEDNESDAY), 'version'), [self::daily()], self::weekly(), $id, self::WEDNESDAY);
        self::assertSame([['recurrence' => $id, 'before' => self::WEDNESDAY, 'after' => null]], $wednesday['untils']);
        self::assertSame([self::DAILY], self::arrows($wednesday, $names));

        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names), 'La fois du jeudi revient, prévue, comme une série d\'agenda prolongée.');
        self::assertSame([self::TODAY], $this->dates(), 'Rien n\'est écrit pour la prévoir.');

        // De même depuis aujourd'hui, sa fois écrite, après un effacement depuis le vendredi.
        $this->saveRecurrence(self::intAt($this->day(self::FRIDAY), 'version'), [self::clear('09:15', '09:30')], null, $id, self::FRIDAY);
        self::assertSame([], self::listAt($this->day(self::FRIDAY), 'blocks'));
        $this->saveRecurrence(self::intAt($today, 'version'), [self::daily()], self::weekly(until: '2026-10-30'), $id);
        self::assertSame([self::DAILY], self::arrows($this->day(self::FRIDAY), $names));
        self::assertSame([], $this->skips());
    }

    public function testRetablirUnEffacementAvecLesSuivantesNeLaissePasDeSaut(): void
    {
        [$id] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];
        $erased = $this->saveRecurrence(self::intAt($this->day(self::THURSDAY), 'version'), [self::clear('09:15', '09:30')], null, $id, self::THURSDAY);
        $back = $this->undo(self::intAt($erased, 'version'), [self::linked(self::daily(), $id)], $erased, self::THURSDAY);
        self::assertSame([self::DAILY], self::arrows($back, $names));
        $redone = $this->redo(self::intAt($back, 'version'), [self::clear('09:15', '09:30')], $erased, self::THURSDAY);
        self::assertSame([], self::listAt($redone, 'blocks'));
        self::assertSame([], $this->skips(), 'Rétablir ne laisse pas plus que le geste d\'origine.');

        // Repoussée depuis le mercredi, elle revient le jeudi, prévue.
        $this->saveRecurrence(self::intAt($this->day(self::WEDNESDAY), 'version'), [self::daily()], self::weekly(), $id, self::WEDNESDAY);
        self::assertSame([self::DAILY], self::arrows($this->day(self::THURSDAY), $names));
    }

    public function testLaFoisDUneRecurrenceRetireeSeFondAvecSaVoisine(): void
    {
        [$id, $created] = $this->repeat(0, self::daily());
        $names = [$id => 'daily'];
        self::mockTime('2026-10-07 08:00:00 Europe/Paris');
        $wednesday = $this->write(self::intAt($this->day(self::WEDNESDAY), 'version'), [self::work('09:30', '09:45', 'OPS-12', 'Daily')], self::WEDNESDAY);
        self::assertSame([self::DAILY, '09:30-09:45 OPS-12 « Daily »'], self::arrows($wednesday, $names), 'Posée par elle, et saisie à la main : deux blocs.');

        // Depuis le mardi, sa création annulée : elle est retirée.
        $tuesday = $this->undo(self::intAt($this->day(self::TODAY), 'version'), [self::clear('09:15', '09:30')], $created);
        self::assertSame([], self::listAt($tuesday, 'blocks'));

        $wednesday = $this->day(self::WEDNESDAY);
        self::assertSame(['09:15-09:45 OPS-12 « Daily »'], self::arrows($wednesday), 'Plus une fois : une saisie ordinaire, fondue avec sa voisine.');
        self::assertSame([], self::arrayAt($wednesday, 'recurrences'));
        self::assertSame(30, self::at($wednesday, 'figures', 'worked'));
        self::assertSame([555 => $id, 570 => null], $this->links(self::WEDNESDAY), 'Le lien reste en base.');
        self::assertSame([], self::listAt($this->day(self::THURSDAY), 'blocks'));

        // Rétablir la création lui rend sa flèche, avec sa fin.
        $tuesday = $this->redo(self::intAt($tuesday, 'version'), [self::linked(self::daily(), $id)], $created);
        self::assertSame([self::DAILY, '09:30-09:45 OPS-12 « Daily »'], self::arrows($this->day(self::WEDNESDAY), $names));
        $this->undo(self::intAt($tuesday, 'version'), [self::clear('09:15', '09:30')], $created);
        self::assertSame(['09:15-09:45 OPS-12 « Daily »'], self::arrows($this->day(self::WEDNESDAY)));

        // Un geste sur ce bloc, comme la page l'envoie : il passe, et la grille reste la base.
        $paused = $this->write(self::intAt($wednesday, 'version'), [self::pause('09:15', '09:45')], self::WEDNESDAY);
        self::assertSame(['09:15-09:45 pause'], self::arrows($paused));
        self::assertSame([555 => null, 570 => null], $this->links(self::WEDNESDAY));
        self::assertSame(0, self::at($paused, 'figures', 'worked'));
        $undone = $this->undo(self::intAt($paused, 'version'), [self::work('09:15', '09:45', 'OPS-12', 'Daily')], date: self::WEDNESDAY);
        self::assertSame(['09:15-09:45 OPS-12 « Daily »'], self::arrows($undone));
        self::assertSame([555 => null, 570 => null], $this->links(self::WEDNESDAY));
        $erased = $this->write(self::intAt($undone, 'version'), [self::clear('09:30', '09:45')], self::WEDNESDAY);
        self::assertSame(['09:15-09:30 OPS-12 « Daily »'], self::arrows($erased));
        self::assertCount(1, $this->rows(self::WEDNESDAY));
    }

    /**
     * @return array<string, ?string>
     */
    private static function daily(): array
    {
        return self::work('09:15', '09:30', 'OPS-12', 'Daily');
    }

    /**
     * @return array<string, ?string>
     */
    private static function retro(): array
    {
        return self::work('09:15', '09:30', 'OPS-12', 'Rétro');
    }

    /**
     * Annuler, comme la page : chaque créneau d'avant, relié à la récurrence qui l'avait posé,
     * les fins que le geste annulé avait changées rendues, et le drapeau qui dit qu'une journée
     * d'avant revient.
     *
     * @param list<array<string, ?string>> $changes
     * @param array<mixed>                 $saved   la réponse de l'enregistrement annulé, avec ses fins
     *
     * @return array<mixed>
     */
    private function undo(int $version, array $changes, array $saved = [], string $date = self::TODAY): array
    {
        [$status, $day] = $this->send('PATCH', '/api/days/'.$date.'/slots', ['version' => $version, 'changes' => $changes, 'recurrences' => [] === $saved ? [] : self::rewinds($saved, true), 'restores' => true]);
        self::assertSame(200, $status, json_encode($day, \JSON_THROW_ON_ERROR));

        return $day;
    }

    /**
     * Rétablir, comme la page : chaque créneau d'après, et les fins d'après.
     *
     * @param list<array<string, ?string>> $changes
     * @param array<mixed>                 $saved
     *
     * @return array<mixed>
     */
    private function redo(int $version, array $changes, array $saved, string $date = self::TODAY): array
    {
        return $this->writeWith($version, $changes, self::rewinds($saved, false), $date);
    }

    /**
     * Les fins qu'annuler ($undo) ou rétablir rendent, d'après celles que l'enregistrement a rendues.
     *
     * @param array<mixed> $saved
     *
     * @return list<array<string, ?string>>
     */
    private static function rewinds(array $saved, bool $undo): array
    {
        $rewinds = [];
        foreach (self::listAt($saved, 'untils') as $until) {
            $before = self::at($until, 'before');
            $after = self::at($until, 'after');
            self::assertTrue(null === $before || \is_string($before));
            self::assertTrue(null === $after || \is_string($after));
            $rewinds[] = ['recurrence' => self::stringAt($until, 'recurrence'), 'from' => $undo ? $after : $before, 'to' => $undo ? $before : $after];
        }

        return $rewinds;
    }

    /**
     * Les jours qui ont une ligne dans la base.
     *
     * @return list<mixed>
     */
    private function dates(): array
    {
        return $this->connection()->fetchFirstColumn('SELECT date FROM day ORDER BY date');
    }
}
