import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    aimsAtEmptyRange,
    deleteEntry,
    draftOf,
    type EntryTarget,
    hasTicketShape,
    type PartTarget,
    partTarget,
    pauseEntry,
    quartersOf,
    replacedBy,
    retarget,
    saveDisabled,
    saveEntry,
    selectionTarget,
    targetAt,
    targetOfSelection,
    typedComment,
    typedTicket,
} from '../../../assets/grid/entry';
import { PAUSE, sameCell, work } from '../../../assets/grid/grid';
import * as Quarter from '../../../assets/grid/quarter';
import {
    deselect,
    EMPTY_SELECTION,
    extendTo,
    selectQuarter,
    selectQuarters,
    toggleQuarter,
} from '../../../assets/grid/selection';
import { gridArbitrary, gridOf, minutes, quarterArbitrary } from './support';

const at = (...times: string[]): number[] => times.map(minutes);

const GRID = gridOf([
    ['09:30', '11:15', 'work', 'SHOP-482', 'Mapping des colonnes'],
    ['12:30', '13:30', 'pause', null, null],
]);

const SHOP_482 = { start: minutes('09:30'), end: minutes('11:15'), content: work('SHOP-482', 'Mapping des colonnes') };
const LUNCH = { start: minutes('12:30'), end: minutes('13:30'), content: PAUSE };

describe('ce que la fenêtre de ticket modifie', () => {
    it('ouvre au double-clic le bloc entier, ou le seul quart d’heure vide', () => {
        expect(targetAt(GRID, minutes('10:15'))).toEqual({ kind: 'edit', block: SHOP_482 });
        expect(targetAt(GRID, minutes('12:45'))).toEqual({ kind: 'edit', block: LUNCH });
        expect(targetAt(GRID, minutes('15:15'))).toEqual({ kind: 'new', quarters: at('15:15') });
    });

    it('ouvre à Entrée toute une plage vide, sinon le quart d’heure où la sélection s’arrête', () => {
        const range = extendTo(selectQuarter(minutes('14:00')), minutes('14:30'));
        expect(targetOfSelection(GRID, range)).toEqual({ kind: 'new', quarters: at('14:00', '14:15', '14:30') });

        const overBlock = extendTo(selectQuarter(minutes('11:15')), minutes('10:45'));
        expect(targetOfSelection(GRID, overBlock)).toEqual({ kind: 'edit', block: SHOP_482 });

        const scattered = toggleQuarter(selectQuarter(minutes('14:00')), minutes('15:00'));
        expect(targetOfSelection(GRID, scattered)).toEqual({ kind: 'new', quarters: at('15:00') });

        expect(targetOfSelection(GRID, EMPTY_SELECTION)).toBeNull();
        // Le curseur resté sur un bloc après Échap ne s'ouvre pas : rien ne le montre.
        expect(targetOfSelection(GRID, deselect(selectQuarter(minutes('10:00'))))).toBeNull();
        expect(targetOfSelection(GRID, toggleQuarter(selectQuarter(minutes('10:00')), minutes('10:00')))).toBeNull();
    });

    it('ouvre « Nouveau ticket… » et une lettre tapée sur la sélection exacte, saisie ou non', () => {
        const inBlock = extendTo(selectQuarter(minutes('10:00')), minutes('10:15'));
        expect(selectionTarget(inBlock)).toEqual({ kind: 'new', quarters: at('10:00', '10:15') });

        const scattered = toggleQuarter(selectQuarter(minutes('09:30')), minutes('12:45'));
        expect(selectionTarget(scattered)).toEqual({ kind: 'new', quarters: at('09:30', '12:45') });

        expect(selectionTarget(EMPTY_SELECTION)).toBeNull();
    });

    it('dit ce que Nouveau ticket remplacera, sans rien pour des créneaux vides ni pour Modifier le ticket', () => {
        expect(replacedBy(GRID, { kind: 'new', quarters: at('10:00', '10:15') })).toEqual({
            quarters: 2,
            contents: [work('SHOP-482', 'Mapping des colonnes')],
            span: { start: minutes('10:00'), end: minutes('10:30') },
        });
        // En partie vide : seul ce qui disparaît compte.
        expect(replacedBy(GRID, { kind: 'new', quarters: at('11:00', '11:15', '11:30') })).toMatchObject({
            quarters: 1,
            span: { start: minutes('11:00'), end: minutes('11:15') },
        });
        expect(replacedBy(GRID, { kind: 'new', quarters: at('11:00', '12:30') })).toEqual({
            quarters: 2,
            contents: [work('SHOP-482', 'Mapping des colonnes'), PAUSE],
            span: null,
        });

        expect(replacedBy(GRID, { kind: 'new', quarters: at('15:15', '15:30') })).toBeNull();
        expect(replacedBy(GRID, { kind: 'edit', block: SHOP_482 })).toBeNull();
    });

    it('suit son bloc une fois la journée relue, et ne l’écrase jamais en silence', () => {
        const edit: EntryTarget = { kind: 'edit', block: SHOP_482 };
        // Rien n'a bougé : la même fenêtre.
        expect(retarget(GRID, edit)).toBe(edit);

        // Raccourci ailleurs : le bloc tel qu'il est désormais.
        const shorter = gridOf([
            ['09:30', '10:30', 'work', 'SHOP-482', 'Mapping des colonnes'],
            ['10:30', '11:15', 'work', 'OPS-1', 'Autre onglet'],
        ]);
        expect(retarget(shorter, edit)).toEqual({
            kind: 'edit',
            block: {
                start: minutes('09:30'),
                end: minutes('10:30'),
                content: work('SHOP-482', 'Mapping des colonnes'),
            },
        });

        // Changé ou disparu : Nouveau ticket sur les mêmes quarts d'heure, qui dira ce qu'il remplace.
        const changed = gridOf([['09:30', '11:15', 'work', 'OPS-1', null]]);
        const fresh = retarget(changed, edit);
        expect(fresh).toEqual({ kind: 'new', quarters: quartersOf(edit) });
        expect(replacedBy(changed, fresh)).toMatchObject({ quarters: 7, contents: [work('OPS-1')] });
        expect(retarget(gridOf([]), edit)).toEqual({ kind: 'new', quarters: quartersOf(edit) });

        const fresh15 = { kind: 'new' as const, quarters: at('15:15') };
        expect(retarget(changed, fresh15)).toBe(fresh15);
    });

    it('dessine le créneau visé sur une plage vide, et la sélection sinon', () => {
        expect(aimsAtEmptyRange(GRID, { kind: 'new', quarters: at('15:15', '15:30') })).toBe(true);
        expect(aimsAtEmptyRange(GRID, { kind: 'new', quarters: at('10:00') })).toBe(false);
        expect(aimsAtEmptyRange(GRID, { kind: 'new', quarters: at('15:15', '15:45') })).toBe(false);
        expect(aimsAtEmptyRange(GRID, { kind: 'edit', block: SHOP_482 })).toBe(false);
    });

    it('montre le ticket et le commentaire du bloc, et rien pour une pause ou un créneau vide', () => {
        expect(draftOf({ kind: 'edit', block: SHOP_482 })).toEqual({
            ticket: 'SHOP-482',
            comment: 'Mapping des colonnes',
        });
        expect(draftOf({ kind: 'edit', block: LUNCH })).toEqual({ ticket: '', comment: '' });
        expect(draftOf({ kind: 'new', quarters: at('15:15') })).toEqual({ ticket: '', comment: '' });
    });
});

describe('ce que la fenêtre de ticket enregistre', () => {
    const fresh: EntryTarget = { kind: 'new', quarters: at('15:15', '15:30') };
    const block: EntryTarget = { kind: 'edit', block: SHOP_482 };
    const pause: EntryTarget = { kind: 'edit', block: LUNCH };

    it('pose le ticket sur chaque quart d’heure visé, tel que le serveur l’écrira', () => {
        expect(saveEntry(fresh, { ticket: ' shop-501 ', comment: '  Relance  ' })).toEqual({
            kind: 'write',
            changes: new Map([
                [minutes('15:15'), work('SHOP-501', 'Relance')],
                [minutes('15:30'), work('SHOP-501', 'Relance')],
            ]),
            gesture: 'replace',
        });
    });

    it('remplace la sélection exacte en un seul geste : le reste du bloc garde son ticket', () => {
        const middle = selectionTarget(extendTo(selectQuarter(minutes('10:00')), minutes('10:15')));
        expect(middle).not.toBeNull();
        if (middle === null) {
            return;
        }
        const action = saveEntry(middle, { ticket: 'ops-12', comment: 'Point client' });
        expect(action).toEqual({
            kind: 'write',
            changes: new Map([
                [minutes('10:00'), work('OPS-12', 'Point client')],
                [minutes('10:15'), work('OPS-12', 'Point client')],
            ]),
            gesture: 'replace',
        });
        const after = action.kind === 'write' ? GRID.with(action.changes) : GRID;
        expect(after.blocks()).toEqual([
            { start: minutes('09:30'), end: minutes('10:00'), content: work('SHOP-482', 'Mapping des colonnes') },
            { start: minutes('10:00'), end: minutes('10:30'), content: work('OPS-12', 'Point client') },
            { start: minutes('10:30'), end: minutes('11:15'), content: work('SHOP-482', 'Mapping des colonnes') },
            LUNCH,
        ]);

        // Rien de tapé : rien n'est remplacé.
        expect(saveEntry(middle, { ticket: '', comment: '' })).toEqual({ kind: 'close' });
        expect(pauseEntry(middle)).toMatchObject({ kind: 'write', gesture: 'pause' });
    });

    it('modifie le bloc entier, et change une pause en travail dès qu’un ticket y est tapé', () => {
        const edited = saveEntry(block, { ticket: 'SHOP-482', comment: 'Tests' });
        expect(edited.kind === 'write' && [...edited.changes.keys()]).toEqual(quartersOf(block));

        const worked = saveEntry(pause, { ticket: 'OPS-12', comment: '' });
        expect(worked.kind === 'write' && [...worked.changes.values()][0]).toEqual(work('OPS-12'));
    });

    it('ferme sans rien écrire quand rien n’est tapé, mais supprime un bloc qu’on vide', () => {
        expect(saveEntry(fresh, { ticket: '  ', comment: '' })).toEqual({ kind: 'close' });
        expect(saveEntry(pause, { ticket: '', comment: ' ' })).toEqual({ kind: 'close' });
        expect(saveEntry(block, { ticket: '', comment: '' })).toEqual(deleteEntry(block));
        expect(deleteEntry(block)).toMatchObject({ kind: 'write', gesture: 'delete' });
    });

    it('supprime un bloc qu’on vide même s’il garde un commentaire', () => {
        expect(saveEntry(block, { ticket: '  ', comment: 'Tests' })).toEqual(deleteEntry(block));
        expect(saveEntry(pause, { ticket: '', comment: 'Tests' })).toMatchObject({
            kind: 'write',
            gesture: null,
        });
    });

    it('envoie un commentaire sans ticket : le serveur dit ce qui manque', () => {
        expect(saveEntry(fresh, { ticket: '', comment: 'Revue' })).toMatchObject({
            kind: 'write',
            changes: new Map([
                [minutes('15:15'), work('', 'Revue')],
                [minutes('15:30'), work('', 'Revue')],
            ]),
        });
    });

    it('grise « Enregistrer » sur une pause tant qu’aucun ticket n’y est tapé', () => {
        expect(saveDisabled(pause, { ticket: '', comment: '' })).toBe(true);
        expect(saveDisabled(pause, { ticket: '   ', comment: 'Revue' })).toBe(true);
        expect(saveDisabled(pause, { ticket: 'ops-12', comment: '' })).toBe(false);
        // Un ticket ou un bloc vidé s'enregistre toujours : il se ferme, ou se supprime.
        expect(saveDisabled(fresh, { ticket: '', comment: '' })).toBe(false);
        expect(saveDisabled(block, { ticket: '', comment: '' })).toBe(false);
    });

    it('convertit en pause, ou supprime, tout ce que la fenêtre vise', () => {
        expect(pauseEntry(fresh)).toEqual({
            kind: 'write',
            changes: new Map([
                [minutes('15:15'), PAUSE],
                [minutes('15:30'), PAUSE],
            ]),
            gesture: 'pause',
        });
        // Modifier le ticket : le bloc entier change, ce qui se voit dans la grille.
        expect(pauseEntry(block)).toMatchObject({ kind: 'write', gesture: null });
        expect(saveEntry(block, { ticket: 'SHOP-482', comment: 'Tests' })).toMatchObject({ gesture: null });
        const removed = deleteEntry(block);
        expect(removed.kind === 'write' && [...removed.changes.values()].every((cell) => cell === null)).toBe(true);
    });
});

describe('ce qu’on tape dans la fenêtre de ticket', () => {
    it('écrit le ticket en majuscules, sans espace', () => {
        expect(typedTicket('shop-482')).toBe('SHOP-482');
        expect(typedTicket(' shop - 48 2 ')).toBe('SHOP-482');
        expect(typedTicket('ops\t12')).toBe('OPS12');
        expect(typedTicket('')).toBe('');
    });

    it('tire l’identifiant d’une adresse de ticket collée', () => {
        expect(typedTicket('https://exemple.atlassian.net/browse/SHOP-482')).toBe('SHOP-482');
        expect(typedTicket('https://exemple.atlassian.net/browse/shop-482?focusedCommentId=10')).toBe('SHOP-482');
        expect(
            typedTicket('https://exemple.atlassian.net/jira/software/projects/SHOP/boards/1?selectedIssue=SHOP-519'),
        ).toBe('SHOP-519');
        // Une adresse sans ticket reste ce qu'elle est : sa forme sera refusée.
        expect(typedTicket('https://exemple.atlassian.net/browse/')).toBe('HTTPS://EXEMPLE.ATLASSIAN.NET/BROWSE/');
    });

    it('garde le commentaire sur une ligne : un retour à la ligne devient une espace', () => {
        expect(typedComment('Revue\nde code')).toBe('Revue de code');
        expect(typedComment('Revue\r\nde code')).toBe('Revue de code');
        expect(typedComment('Revue\u2028de\tcode')).toBe('Revue de code');
        expect(typedComment('Revue de code')).toBe('Revue de code');
    });

    it('juge la forme d’un identifiant comme le serveur, sans rien dire d’un champ vide', () => {
        for (const ticket of ['SHOP-482', 'shop-482', ' OPS-12 ', 'PLATFORM-12345', 'A1_B-7', '', '   ']) {
            expect(hasTicketShape(ticket), ticket).toBe(true);
        }
        for (const ticket of [
            'SHOP',
            'SHOP-',
            'SHOP-0',
            '-482',
            '4SHOP-1',
            'S-1',
            'SHOP 482',
            'SHOP_482',
            'pas un ticket',
        ]) {
            expect(hasTicketShape(ticket), ticket).toBe(false);
        }
    });
});

describe('Modifier la sélection', () => {
    const select = (from: string, to: string) => extendTo(selectQuarter(minutes(from)), minutes(to));
    const MAPPING = work('SHOP-482', 'Mapping des colonnes');
    const opened = (target: PartTarget | null): PartTarget => {
        if (target === null) {
            throw new Error('La sélection porte un seul ticket et un seul commentaire.');
        }

        return target;
    };
    // Une demi-heure au milieu de SHOP-482, de 09:30 à 11:15.
    const middle = opened(partTarget(GRID, select('10:00', '10:15')));
    // Le bloc entier.
    const whole = opened(partTarget(GRID, select('09:30', '11:00')));

    it('s’ouvre remplie du ticket et du commentaire que porte toute la sélection', () => {
        expect(middle).toEqual({ kind: 'part', quarters: at('10:00', '10:15'), content: MAPPING, beyond: true });
        expect(draftOf(middle)).toEqual({ ticket: 'SHOP-482', comment: 'Mapping des colonnes' });
        expect(aimsAtEmptyRange(GRID, middle)).toBe(false);
        // Rien n'y est remplacé : la fenêtre dit autre chose.
        expect(replacedBy(GRID, middle)).toBeNull();

        const bare = partTarget(gridOf([['09:00', '10:00', 'work', 'OPS-12', null]]), select('09:15', '09:30'));
        expect(draftOf(opened(bare))).toEqual({ ticket: 'OPS-12', comment: '' });
    });

    it('ne s’ouvre que sur un seul ticket et un seul commentaire, en plusieurs morceaux compris', () => {
        const twoComments = gridOf([
            ['09:00', '10:00', 'work', 'SHOP-482', 'Mapping'],
            ['10:00', '11:00', 'work', 'SHOP-482', 'Relecture'],
            ['11:00', '11:30', 'work', 'OPS-12', 'Mapping'],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
        expect(partTarget(twoComments, select('09:45', '10:00'))).toBeNull();
        expect(partTarget(twoComments, select('10:45', '11:00'))).toBeNull();
        // Deux blocs séparés du même ticket et du même commentaire.
        const apart = toggleQuarter(select('09:15', '09:30'), minutes('14:30'));
        expect(partTarget(twoComments, apart)).toEqual({
            kind: 'part',
            quarters: at('09:15', '09:30', '14:30'),
            content: work('SHOP-482', 'Mapping'),
            beyond: true,
        });

        expect(partTarget(GRID, select('11:00', '11:15'))).toBeNull();
        expect(partTarget(GRID, select('12:30', '12:45'))).toBeNull();
        expect(partTarget(GRID, select('15:00', '15:15'))).toBeNull();
        expect(partTarget(GRID, EMPTY_SELECTION)).toBeNull();
    });

    it('sait si un de ses blocs la dépasse, trou dans la sélection compris', () => {
        expect(whole.beyond).toBe(false);
        expect(opened(partTarget(GRID, select('09:30', '10:45'))).beyond).toBe(true);
        expect(opened(partTarget(GRID, toggleQuarter(select('09:30', '11:00'), minutes('10:15')))).beyond).toBe(true);

        const twoBlocks = gridOf([
            ['09:00', '09:30', 'work', 'SHOP-482', 'Mapping'],
            ['14:00', '14:30', 'work', 'SHOP-482', 'Mapping'],
        ]);
        const both = toggleQuarter(toggleQuarter(select('09:00', '09:15'), minutes('14:00')), minutes('14:15'));
        expect(opened(partTarget(twoBlocks, both)).beyond).toBe(false);
    });

    it('ne change que les créneaux sélectionnés, et dit qu’elle a modifié une partie du bloc', () => {
        const action = saveEntry(middle, { ticket: 'SHOP-482', comment: 'Point client' });
        expect(action).toEqual({
            kind: 'write',
            changes: new Map([
                [minutes('10:00'), work('SHOP-482', 'Point client')],
                [minutes('10:15'), work('SHOP-482', 'Point client')],
            ]),
            gesture: 'modify',
        });
        const after = action.kind === 'write' ? GRID.with(action.changes) : GRID;
        expect(after.blocks()).toEqual([
            { start: minutes('09:30'), end: minutes('10:00'), content: MAPPING },
            { start: minutes('10:00'), end: minutes('10:30'), content: work('SHOP-482', 'Point client') },
            { start: minutes('10:30'), end: minutes('11:15'), content: MAPPING },
            LUNCH,
        ]);

        // Un autre ticket remplace la sélection, comme Nouveau ticket.
        expect(saveEntry(middle, { ticket: 'ops-12', comment: 'Mapping des colonnes' })).toMatchObject({
            kind: 'write',
            gesture: 'replace',
        });
        expect(pauseEntry(middle)).toMatchObject({ kind: 'write', gesture: 'pause' });
    });

    it('n’enregistre rien quand rien n’a changé, écrit autrement compris', () => {
        expect(saveEntry(middle, draftOf(middle))).toEqual({ kind: 'close' });
        expect(saveEntry(middle, { ticket: ' shop-482 ', comment: ' Mapping  des colonnes ' })).toEqual({
            kind: 'close',
        });
        const bare = opened(partTarget(gridOf([['09:00', '10:00', 'work', 'OPS-12', null]]), select('09:15', '09:30')));
        expect(saveEntry(bare, { ticket: 'OPS-12', comment: '  ' })).toEqual({ kind: 'close' });
    });

    it('fait sur des blocs entiers ce que ferait Modifier le ticket : la grille le montre', () => {
        expect(saveEntry(whole, { ticket: 'SHOP-482', comment: 'Point client' })).toMatchObject({
            kind: 'write',
            gesture: null,
        });
        expect(saveEntry(whole, { ticket: 'OPS-12', comment: '' })).toMatchObject({ kind: 'write', gesture: null });
        // La tasse et la corbeille se disent, comme depuis le menu.
        expect(pauseEntry(whole)).toMatchObject({ kind: 'write', gesture: 'pause' });
        expect(deleteEntry(whole)).toMatchObject({ kind: 'write', gesture: 'clear' });
    });

    it('efface la sélection seule quand on vide le ticket, comme une cellule qu’on vide', () => {
        expect(saveEntry(middle, { ticket: ' ', comment: 'Mapping des colonnes' })).toEqual(deleteEntry(middle));
        expect(saveDisabled(middle, { ticket: '', comment: '' })).toBe(false);
        const removed = deleteEntry(middle);
        expect(removed).toMatchObject({ kind: 'write', gesture: 'clear' });
        expect(removed.kind === 'write' && [...removed.changes.entries()]).toEqual([
            [minutes('10:00'), null],
            [minutes('10:15'), null],
        ]);
    });

    it('suit la sélection une fois la journée relue, et ne l’écrase jamais en silence', () => {
        expect(retarget(GRID, middle)).toBe(middle);

        // Le bloc raccourci ailleurs à la sélection : elle porte désormais le bloc entier.
        const shorter = gridOf([['10:00', '10:30', 'work', 'SHOP-482', 'Mapping des colonnes']]);
        expect(retarget(shorter, middle)).toEqual({ ...middle, beyond: false });

        // Un de ses quarts d'heure a changé : Nouveau ticket, qui dira ce qu'il remplace.
        const changed = gridOf([
            ['09:30', '10:15', 'work', 'SHOP-482', 'Autre onglet'],
            ['10:15', '11:15', 'work', 'SHOP-482', 'Mapping des colonnes'],
        ]);
        const fresh = retarget(changed, middle);
        expect(fresh).toEqual({ kind: 'new', quarters: at('10:00', '10:15') });
        expect(replacedBy(changed, fresh)).toMatchObject({ quarters: 2 });
        expect(retarget(gridOf([]), middle)).toEqual({ kind: 'new', quarters: at('10:00', '10:15') });
    });

    it('ne touche jamais un quart d’heure hors de la sélection, quelle que soit la journée', () => {
        fc.assert(
            fc.property(
                gridArbitrary,
                fc.array(quarterArbitrary, { minLength: 1, maxLength: 8 }),
                fc.constantFrom('', 'Tests', 'Autre chose'),
                fc.boolean(),
                (grid, quarters, comment, emptied) => {
                    const selection = selectQuarters(quarters);
                    const cells = selection.quarters.map((quarter) => grid.at(quarter));
                    const first = cells[0] ?? null;
                    const target = partTarget(grid, selection);
                    expect(target !== null).toBe(
                        first?.kind === 'work' && cells.every((cell) => sameCell(cell, first)),
                    );
                    if (target === null) {
                        return;
                    }
                    expect(saveEntry(target, draftOf(target))).toEqual({ kind: 'close' });

                    const ticket = emptied ? '' : draftOf(target).ticket;
                    const action = saveEntry(target, { ticket, comment });
                    const expected = emptied ? null : work(target.content.ticket, comment === '' ? null : comment);
                    if (action.kind === 'close') {
                        // Rien de changé.
                        expect(sameCell(expected, target.content)).toBe(true);

                        return;
                    }
                    const after = grid.with(action.changes);
                    for (const quarter of Quarter.all()) {
                        const selected = selection.quarters.includes(quarter);
                        expect(after.at(quarter)).toEqual(selected ? expected : grid.at(quarter));
                    }
                },
            ),
        );
    });
});
