import { describe, expect, it } from 'vitest';

import {
    objectiveRefusal,
    PART_REFUSAL,
    partNote,
    rangeLabel,
    refusalMessage,
    replaceNote,
    selectionSummary,
    undoMessage,
    windowRefusal,
    windowSubtitle,
} from '../../../assets/day/messages';
import { fill } from '../../../assets/grid/changes';
import { type Grid, PAUSE, work } from '../../../assets/grid/grid';
import { stepBetween } from '../../../assets/grid/history';
import { lossIn } from '../../../assets/grid/loss';
import { extendTo, selectQuarter } from '../../../assets/grid/selection';
import { gridOf, minutes } from '../grid/support';

const GRID = gridOf([
    ['11:15', '11:45', 'work', 'SHOP-519', 'Reproduction'],
    ['11:45', '12:00', 'work', 'SHOP-519', 'Correctif'],
    ['12:00', '12:30', 'work', 'SHOP-482', 'Tests'],
    ['12:30', '13:30', 'pause', null, null],
]);

/** Le geste qui donne à ces quarts d'heure ce contenu, tel que la session le rend. */
function step(from: string, to: string, content: Parameters<typeof fill>[1], grid: Grid = GRID) {
    const changes = fill(extendTo(selectQuarter(minutes(from)), minutes(to)).quarters, content);

    return stepBetween(grid, grid.with(changes), changes.keys());
}

describe('le message d’annulation', () => {
    it('nomme le ticket quand le geste n’en touche qu’un, commentaires compris', () => {
        expect(undoMessage('delete', step('11:15', '11:45', null))).toEqual({
            ticket: 'SHOP-519',
            text: 'supprimé',
            undo: true,
        });
        expect(undoMessage('cut', step('11:30', '11:30', null))).toMatchObject({ ticket: 'SHOP-519', text: 'coupé' });
        expect(undoMessage('pause', step('12:00', '12:15', PAUSE))).toMatchObject({
            ticket: 'SHOP-482',
            text: 'converti en pause',
        });
    });

    it('nomme la pause', () => {
        expect(undoMessage('clear', step('12:30', '13:15', null))).toEqual({
            ticket: null,
            text: 'Pause effacée',
            undo: true,
        });
    });

    it('compte les créneaux quand le geste touche plusieurs tickets', () => {
        expect(undoMessage('clear', step('11:15', '13:15', null))).toEqual({
            ticket: null,
            text: '9 créneaux effacés',
            undo: true,
        });
        expect(undoMessage('paste', step('11:45', '12:45', work('OPS-12')))).toMatchObject({
            text: '5 créneaux remplacés',
        });
    });

    it('ne dit rien quand rien n’a disparu : coller sur des créneaux vides ajoute', () => {
        expect(undoMessage('paste', step('14:00', '14:30', work('OPS-12')))).toBeNull();
        expect(undoMessage('pause', step('14:00', '14:30', PAUSE))).toBeNull();
        expect(undoMessage('clear', null)).toBeNull();
    });

    it('compte comme remplacé ce qui est collé par-dessus, pas ce qui garde son contenu', () => {
        expect(undoMessage('paste', step('11:30', '11:45', work('SHOP-519', 'Correctif')))).toEqual({
            ticket: 'SHOP-519',
            text: 'remplacé',
            undo: true,
        });
    });
});

describe('le remplacement d’une sélection par Nouveau ticket', () => {
    it('nomme ce qui est remplacé, et ses heures quand c’est une partie de bloc qui se suit', () => {
        expect(undoMessage('replace', step('11:30', '11:45', work('OPS-12', 'Point client')))).toEqual({
            ticket: 'SHOP-519',
            text: 'remplacé de 11:30 à 12:00',
            undo: true,
        });
        expect(undoMessage('replace', step('12:30', '12:45', work('OPS-12')))).toMatchObject({
            ticket: null,
            text: 'Pause remplacée de 12:30 à 13:00',
        });
        expect(undoMessage('replace', step('11:45', '12:15', work('OPS-12')))).toMatchObject({
            text: '3 créneaux remplacés de 11:45 à 12:30',
        });
    });

    it('ne donne pas d’heures quand ce qui disparaît ne se suit pas, et se tait sur des créneaux vides', () => {
        const scattered = fill([minutes('11:15'), minutes('12:00')], work('OPS-12'));
        expect(undoMessage('replace', stepBetween(GRID, GRID.with(scattered), scattered.keys()))).toMatchObject({
            text: '2 créneaux remplacés',
        });
        expect(undoMessage('replace', step('14:00', '14:30', work('OPS-12')))).toBeNull();
    });

    it('annonce sous les champs ce qui sera remplacé', () => {
        const at = (...times: string[]) => times.map((time) => [minutes(time), GRID.at(minutes(time))] as const);
        const loss = (...times: string[]) =>
            lossIn(at(...times).flatMap(([quarter, cell]) => (cell === null ? [] : [[quarter, cell] as const])));

        expect(replaceNote(loss('11:15', '11:30'), 2)).toBe('Remplace SHOP-519 sur ces 30 minutes.');
        expect(replaceNote(loss('11:45', '12:00', '12:15'), 3)).toBe('Remplace 2 tickets sur ces 45 minutes.');
        expect(replaceNote(loss('12:30', '12:45'), 2)).toBe('Remplace la pause sur ces 30 minutes.');
        expect(replaceNote(loss('12:15', '12:30', '12:45'), 3)).toBe(
            'Remplace SHOP-482 et la pause sur ces 45 minutes.',
        );
        expect(replaceNote(loss('11:15', '11:30', '11:45', '12:00', '12:15', '12:30'), 6)).toBe(
            'Remplace 2 tickets et la pause sur ces 90 minutes.',
        );
        // En partie vide : seul ce qui disparaît compte.
        expect(replaceNote(loss('13:15', '13:30', '13:45'), 3)).toBe('Remplace la pause sur 15 minutes.');
    });

    it('dit les heures d’une fenêtre, ou la taille d’une sélection en plusieurs morceaux', () => {
        expect(windowSubtitle('Mardi 6 octobre', [minutes('10:00'), minutes('10:15')])).toBe(
            'Mardi 6 octobre de 10:00 à 10:30',
        );
        expect(windowSubtitle('Mardi 6 octobre', [minutes('10:00'), minutes('11:00'), minutes('11:15')])).toBe(
            'Mardi 6 octobre, 3 créneaux, 0h45',
        );
    });
});

describe('une partie de bloc changée par Modifier la sélection', () => {
    it('nomme le ticket modifié, et ses heures quand la sélection se suit', () => {
        expect(undoMessage('modify', step('11:15', '11:30', work('SHOP-519', 'Point client')))).toEqual({
            ticket: 'SHOP-519',
            text: 'modifié de 11:15 à 11:45',
            undo: true,
        });
        const scattered = fill([minutes('11:15'), minutes('12:00')], work('SHOP-519', 'Point client'));
        expect(undoMessage('modify', stepBetween(GRID, GRID.with(scattered), scattered.keys()))).toMatchObject({
            text: '2 créneaux modifiés',
        });
    });

    it('annonce sous les champs que le reste du bloc ne bouge pas', () => {
        expect(partNote('SHOP-482', 3)).toBe('Modifie SHOP-482 sur ces 45 minutes seulement.');
        expect(partNote('OPS-12', 6)).toBe('Modifie OPS-12 sur ces 90 minutes seulement.');
    });

    it('dit pourquoi F2 n’ouvre rien, sans proposer d’annuler', () => {
        expect(PART_REFUSAL).toEqual({
            ticket: null,
            text: "Rien ne s'ouvre, la sélection ne porte pas un seul ticket avec un seul commentaire.",
            undo: false,
        });
    });
});

describe('ce que l’écran dit d’un geste refusé', () => {
    it('dit pourquoi rien n’a changé, sans proposer d’annuler', () => {
        expect(refusalMessage({ kind: 'overflow' })).toEqual({
            ticket: null,
            text: "Rien n'est collé, le groupe dépasserait 20:00.",
            undo: false,
        });
        expect(refusalMessage({ kind: 'stale' })?.text).toBe("La journée a changé entre-temps. Rien n'a été modifié.");
        expect(refusalMessage({ kind: 'conflict' }, 'redo')?.text).toContain("Rien n'est rétabli.");
        expect(refusalMessage({ kind: 'invalid', violations: [{ field: 'x', message: 'Refusé.' }] })?.text).toBe(
            'Refusé.',
        );
    });

    it('se tait quand le geste est passé, ou n’avait rien à faire', () => {
        for (const kind of ['unchanged', 'nothing', 'abandoned'] as const) {
            expect(refusalMessage({ kind })).toBeNull();
        }
        expect(refusalMessage({ kind: 'saved', step: null })).toBeNull();
    });

    it('garde la fenêtre ouverte avec ce qui s’est passé', () => {
        expect(windowRefusal({ kind: 'stale' })).toBe(
            'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.',
        );
        expect(windowRefusal({ kind: 'failed' })).toBe("L'enregistrement n'a pas abouti. Réessayez.");
        expect(windowRefusal({ kind: 'invalid', violations: [] })).toBeNull();
    });
});

describe('les textes de la sélection et des fenêtres', () => {
    it('écrit la taille de la sélection comme l’en-tête du menu', () => {
        expect(selectionSummary(extendTo(selectQuarter(minutes('13:30')), minutes('15:00')))).toBe('7 créneaux, 1h45');
        expect(selectionSummary(selectQuarter(minutes('13:30')))).toBe('1 créneau, 0h15');
    });

    it('écrit une plage et les refus de l’objectif', () => {
        expect(rangeLabel(minutes('15:15'), minutes('15:30'))).toBe('de 15:15 à 15:30');
        expect(objectiveRefusal({ kind: 'quarter', minutes: 430 })).toBe("L'objectif se règle au quart d'heure.");
    });
});
