// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { SlotChange } from '../../../assets/grid/changes';
import { TICKET_NOT_FOUND } from '../../../assets/jira/lookupMessages';
import { type Bench, DATE, mountGrid, unmountAll } from './gridBench';

/**
 * Les gestes de la grille qui se croisent, joués sur le crochet des gestes : un « Annuler »,
 * un effacement, une fenêtre, un menu ou une touche qui arrivent pendant qu'une fenêtre
 * s'enregistre, que Jira cherche un ticket ou qu'un collage est en route. Le serveur et
 * Jira y répondent quand le test le décide (gridBench.tsx).
 */

const HOUR: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'SHOP-482', comment: 'Mapping' };
const REPRO: SlotChange = { start: '11:15', end: '11:45', kind: 'work', ticket: 'SHOP-519', comment: 'Reproduction' };
const DAILY: SlotChange = { start: '10:00', end: '10:15', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };

afterEach(() => {
    unmountAll();
});

/** Les écritures que le serveur a reçues depuis le départ du test. */
function writes(bench: Bench): number {
    return bench.slow.server.writes.length;
}

/** Les flèches, autant de fois qu'il faut. */
function arrows(bench: Bench, key: 'ArrowUp' | 'ArrowDown', times: number, shiftKey = false): void {
    for (let count = 0; count < times; count += 1) {
        bench.press(key, { shiftKey });
    }
}

/** Modifier le ticket sur le bloc de 14:00, un autre ticket tapé, enregistré : Jira cherche encore. */
function savingWhileJiraSearches(bench: Bench, ticket = 'ESSAI-1'): void {
    bench.press('ArrowDown');
    expect(bench.editing.selection.quarters).toEqual([885]);
    bench.press('Enter');
    expect(bench.editing.window?.target.kind).toBe('edit');
    bench.type(ticket);
    bench.jira.hold();
    bench.enter();
    expect(bench.editing.window?.sending).toBe(true);
}

describe('le bouton « Annuler » du message', () => {
    it('après Effacer dans Modifier le ticket, rend le bloc sans rouvrir la fenêtre', async () => {
        const bench = mountGrid({ blocks: [REPRO], top: 690 });
        bench.press('ArrowDown');
        bench.press('Enter');
        expect(bench.editing.window?.target.kind).toBe('edit');
        bench.button('delete');
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([]);

        const before = writes(bench);
        bench.forgetWindows();
        bench.undoMessage();
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([['11:15', '11:45', 'work', 'SHOP-519', 'Reproduction']]);
        expect(writes(bench) - before).toBe(1);
        expect(bench.windows).toEqual(['-']);
    });

    it('fait comme Ctrl+Z après Effacer', async () => {
        const bench = mountGrid({ blocks: [REPRO], top: 690 });
        bench.press('ArrowDown');
        bench.press('Enter');
        bench.button('delete');
        await bench.settle();
        bench.undo();
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([['11:15', '11:45', 'work', 'SHOP-519', 'Reproduction']]);
    });

    it('après Pause dans Nouveau ticket, rend ce que la pause a remplacé', async () => {
        const bench = mountGrid({ blocks: [REPRO], top: 675 });
        bench.press('ArrowDown');
        expect(bench.editing.selection.quarters).toEqual([675]);
        bench.press('O');
        expect(bench.editing.window?.target.kind).toBe('new');
        bench.type('OPS-3');
        bench.button('pause');
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([
            ['11:15', '11:30', 'pause', null, null],
            ['11:30', '11:45', 'work', 'SHOP-519', 'Reproduction'],
        ]);

        const before = writes(bench);
        bench.forgetWindows();
        bench.undoMessage();
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([['11:15', '11:45', 'work', 'SHOP-519', 'Reproduction']]);
        expect(writes(bench) - before).toBe(1);
        expect(bench.windows).toEqual(['-']);
    });

    it('après Nouveau ticket qui remplace, rend le bloc remplacé sans rouvrir la fenêtre', async () => {
        const bench = mountGrid({ blocks: [REPRO], top: 675 });
        bench.press('ArrowDown');
        bench.press('O');
        bench.type('OPS-3');
        bench.enter();
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([
            ['11:15', '11:30', 'work', 'OPS-3', null],
            ['11:30', '11:45', 'work', 'SHOP-519', 'Reproduction'],
        ]);

        const before = writes(bench);
        bench.forgetWindows();
        bench.undoMessage();
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([['11:15', '11:45', 'work', 'SHOP-519', 'Reproduction']]);
        expect(writes(bench) - before).toBe(1);
        expect(bench.windows).toEqual(['-']);
    });

    it('après un favori déposé sur le bloc de la fenêtre ouverte, défait le dépôt et garde la fenêtre enregistrée', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        bench.press('ArrowDown');
        bench.press('Enter');
        bench.type('ESSAI-1');
        bench.dropFavorite('OPS-3', 840);
        await bench.settle();
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.ranges()).toEqual([
            ['14:00', '14:15', 'work', 'OPS-3', null],
            ['14:15', '15:00', 'work', 'ESSAI-1', 'Mapping'],
        ]);

        const before = writes(bench);
        bench.forgetWindows();
        bench.undoMessage();
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
        expect(writes(bench) - before).toBe(1);
        expect(bench.windows).toEqual(['-']);
    });
});

describe('le message d’un geste qu’un autre a suivi', () => {
    const REPRO_15: SlotChange = { start: '15:00', end: '15:15', kind: 'work', ticket: 'SHOP-519', comment: 'Repro' };

    /** 10:00 copié, puis Ctrl+V sur 14:00 retenu par le serveur, et Suppr sur 15:00 derrière lui. */
    async function pasteThenClear(bench: Bench): Promise<void> {
        bench.click(600);
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.click(840);
        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        bench.click(900);
        bench.press('Delete');
        await bench.settle();
    }

    it('ne se dit pas : son « Annuler » défairait l’autre geste', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR, REPRO_15], top: 600 });
        await pasteThenClear(bench);
        await bench.answer(bench.slow, false);
        expect(bench.slow.ranges()).toContainEqual(['14:00', '14:15', 'work', 'OPS-12', 'Daily']);
        expect(bench.editing.message).toBeNull();

        await bench.answer(bench.slow);
        expect(bench.editing.message?.action).toBeDefined();
        bench.undoMessage();
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:00', '14:15', 'work', 'OPS-12', 'Daily'],
            ['14:15', '15:00', 'work', 'SHOP-482', 'Mapping'],
            ['15:00', '15:15', 'work', 'SHOP-519', 'Repro'],
        ]);
    });

    it('Ctrl+Z parti derrière lui : aucun message, et Ctrl+Z défait le collage', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR], top: 600 });
        bench.click(600);
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.click(840);
        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        bench.undo();
        await bench.answer(bench.slow, false);
        expect(bench.editing.message).toBeNull();
        await bench.answer(bench.slow);
        expect(bench.editing.message).toBeNull();
        expect(bench.slow.ranges()).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
    });

    it('un refus se dit quand même, et le geste abandonné derrière lui ne l’efface pas', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR, REPRO_15], top: 600 });
        bench.click(600);
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.click(840);
        bench.slow.hold();
        bench.slow.lose();
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        bench.click(900);
        bench.press('Delete');
        await bench.answer(bench.slow);
        expect(bench.editing.message?.content).toBe("L'enregistrement n'a pas abouti. Réessayez.");
        expect(bench.slow.ranges()).toContainEqual(['15:00', '15:15', 'work', 'SHOP-519', 'Repro']);
        expect(bench.shown()).toEqual(bench.slow.ranges());
    });
});

describe('une fenêtre demandée derrière un geste refusé', () => {
    it('Entrée pendant un collage qui n’atteint pas le serveur : rien ne s’ouvre, et le refus reste dit', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR], top: 600 });
        bench.click(600);
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.click(900);
        bench.slow.hold();
        bench.slow.lose();
        bench.press('v', { ctrlKey: true });
        bench.press('Enter');
        await bench.answer(bench.slow);
        expect(bench.editing.window).toBeNull();
        expect(bench.editing.message?.content).toBe("L'enregistrement n'a pas abouti. Réessayez.");
    });

    for (const key of ['Enter', 'F2'] as const) {
        it(`${key === 'Enter' ? 'Entrée' : 'F2'} pendant un Suppr refusé, la journée changée ailleurs : rien ne s’ouvre, et le refus reste dit`, async () => {
            const bench = mountGrid({ blocks: [HOUR], top: 885 });
            bench.press('ArrowDown');
            // Un autre onglet écrit la journée : l'écran ne le sait pas encore.
            bench.slow.server.changeSlots(DATE, bench.slow.server.read(DATE).version, [
                { start: '09:00', end: '09:15', kind: 'work', ticket: 'OPS-3', comment: null },
            ]);
            bench.slow.hold();
            bench.press('Delete');
            bench.press(key);
            await bench.answer(bench.slow);
            expect(bench.editing.window).toBeNull();
            expect(bench.editing.message?.content).toBe("La journée a changé entre-temps. Rien n'a été modifié.");
            expect(bench.shown()).toEqual(bench.slow.ranges());
        });
    }
});

describe('un appui sur la grille pendant qu’une fenêtre attend pour s’ouvrir', () => {
    it('y renonce, et les lettres tapées ensuite ouvrent Nouveau ticket là où il a sélectionné', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        bench.select([840, 885]);
        bench.press('Enter');
        bench.click(900);
        for (const letter of 'OPS-1') {
            bench.press(letter);
        }

        await bench.answer(bench.jira);
        expect(bench.editing.window?.target.kind).toBe('new');
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-1', comment: '' });
        expect(bench.editing.selection.quarters).toEqual([900]);
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
    });

    it('le second clic d’un double-clic sur « Nouveau ticket… », tombé sur la grille, n’y renonce pas', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR], top: 600 });
        bench.click(600);
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.click(960);
        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        bench.rightClick(960);
        expect(bench.menus).toHaveLength(1);
        bench.choose('newTicket');
        bench.strayClick(960);
        await bench.answer(bench.slow);
        expect(bench.editing.window?.target.kind).toBe('new');
        expect(bench.editing.selection.quarters).toEqual([960]);
        expect(bench.editing.windowNote).toBe('Remplace OPS-12 sur ces 15 minutes.');
    });

    it('y renonce pendant un collage : rien ne s’ouvre, et la sélection reste où il l’a mise', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR], top: 600 });
        bench.click(600);
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.click(840);
        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        bench.press('Enter');
        bench.click(960);
        await bench.answer(bench.slow);
        expect(bench.editing.window).toBeNull();
        expect(bench.editing.selection.quarters).toEqual([960]);
    });
});

describe('un geste fait pendant que la fenêtre attend Jira', () => {
    it('Suppr : la fenêtre s’enregistre d’abord, l’effacement ensuite, et « Annuler » ne défait que lui', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        arrows(bench, 'ArrowUp', 3);
        expect(bench.editing.selection.quarters).toEqual([840]);
        bench.press('Delete');
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);

        await bench.answer(bench.jira);
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.ranges()).toEqual([['14:15', '15:00', 'work', 'ESSAI-1', 'Mapping']]);

        bench.forgetWindows();
        bench.undoMessage();
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
        expect(bench.windows).toEqual(['-']);
    });

    for (const refusal of ['stale', 'failed'] as const) {
        it(`${refusal === 'stale' ? 'la journée changée ailleurs' : 'le serveur muet'} : la fenêtre refusée reste ouverte, rien n’est coincé, et le geste qui suivait n’a pas lieu`, async () => {
            const bench = mountGrid({ blocks: [HOUR], top: 885 });
            savingWhileJiraSearches(bench);
            arrows(bench, 'ArrowUp', 3);
            bench.press('Delete');
            if (refusal === 'stale') {
                // Un autre onglet écrit la journée pendant que Jira cherche.
                bench.slow.server.changeSlots(DATE, bench.slow.server.read(DATE).version, [
                    { start: '09:00', end: '09:15', kind: 'work', ticket: 'OPS-3', comment: null },
                ]);
            } else {
                bench.slow.lose();
            }
            await bench.answer(bench.jira);

            const shown = bench.editing.window;
            expect(shown?.sending).toBe(false);
            expect(shown?.draft).toEqual({ ticket: 'ESSAI-1', comment: 'Mapping' });
            expect(shown?.errors.general).toBe(
                refusal === 'stale'
                    ? 'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.'
                    : "L'enregistrement n'a pas abouti. Réessayez.",
            );
            expect(bench.snapshot().busy).toBe(false);
            const other = refusal === 'stale' ? [['09:00', '09:15', 'work', 'OPS-3', null]] : [];
            expect(bench.slow.ranges()).toEqual([...other, ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);
            expect(bench.shown()).toEqual(bench.slow.ranges());

            // La sélection est revenue au bloc visé : Suppr de nouveau sur 14:00 enregistre la
            // fenêtre, puis efface ; « Annuler » ne défait que l'effacement.
            expect(bench.editing.selection.quarters).toEqual([840, 855, 870, 885]);
            arrows(bench, 'ArrowUp', 3);
            expect(bench.editing.selection.quarters).toEqual([840]);
            bench.press('Delete');
            await bench.settle();
            expect(bench.editing.window).toBeNull();
            expect(bench.slow.ranges()).toEqual([...other, ['14:15', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
            bench.undoMessage();
            await bench.settle();
            expect(bench.slow.ranges()).toEqual([...other, ['14:00', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
        });
    }
});

describe('une fenêtre demandée pendant qu’un collage s’enregistre', () => {
    it('Entrée : elle s’ouvre sur ce qui a été collé', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR], top: 600 });
        bench.press('ArrowDown');
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        arrows(bench, 'ArrowDown', 16);
        expect(bench.editing.selection.quarters).toEqual([840]);
        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        bench.press('Enter');
        await bench.settle();
        expect(bench.editing.window).toBeNull();

        await bench.answer(bench.slow);
        expect(bench.editing.window?.target.kind).toBe('edit');
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-12', comment: 'Daily' });
        expect(bench.slow.ranges()[1]).toEqual(['14:00', '14:15', 'work', 'OPS-12', 'Daily']);
    });

    it('Entrée puis des lettres : les lettres sont retenues, et la fenêtre montre le bloc collé', async () => {
        const bench = mountGrid({
            blocks: [{ start: '10:00', end: '11:00', kind: 'work', ticket: 'OPS-12', comment: 'Daily' }, HOUR],
            top: 600,
        });
        bench.press('ArrowDown');
        arrows(bench, 'ArrowDown', 3, true);
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.press('Escape');
        arrows(bench, 'ArrowDown', 13);
        expect(bench.editing.selection.quarters).toEqual([840]);
        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        bench.press('Enter');
        expect(bench.press('S')).toBe(true);
        expect(bench.press('H')).toBe(true);

        await bench.answer(bench.slow);
        const shown = bench.editing.window;
        expect(shown?.target.kind).toBe('edit');
        expect(shown?.draft).toEqual({ ticket: 'OPS-12', comment: 'Daily' });
        expect(bench.slow.ranges()).toEqual([
            ['10:00', '11:00', 'work', 'OPS-12', 'Daily'],
            ['14:00', '15:00', 'work', 'OPS-12', 'Daily'],
        ]);
    });

    it('Ctrl+Z pendant qu’Entrée attend : il est retenu, et la fenêtre s’ouvre sur ce qui a été collé', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR], top: 600 });
        bench.press('ArrowDown');
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        arrows(bench, 'ArrowDown', 16);
        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        bench.press('Enter');
        bench.undo();

        await bench.answer(bench.slow);
        expect(bench.editing.window?.target.kind).toBe('edit');
        expect(bench.editing.window?.draft).toEqual({ ticket: 'OPS-12', comment: 'Daily' });
        expect(bench.slow.ranges()).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:00', '14:15', 'work', 'OPS-12', 'Daily'],
            ['14:15', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
    });

    it('pendant l’attente, F5 et Tab gardent leur effet, les flèches sont retenues', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        bench.press('ArrowDown');
        bench.slow.hold();
        bench.press('Delete');
        bench.press('Enter');
        expect(bench.press('F5')).toBe(false);
        expect(bench.press('Tab')).toBe(false);
        expect(bench.press('ArrowDown')).toBe(true);
        expect(bench.editing.selection.quarters).toEqual([885]);
        await bench.drain();
    });
});

describe('Entrée sur la plage de la fenêtre qui s’enregistre', () => {
    it('ouvre la fenêtre sur ce qu’elle vient d’écrire, une fois enregistrée', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        arrows(bench, 'ArrowUp', 3);
        arrows(bench, 'ArrowDown', 3, true);
        expect(bench.editing.selection.quarters).toEqual([840, 855, 870, 885]);
        bench.press('Enter');

        await bench.answer(bench.jira);
        const shown = bench.editing.window;
        expect(shown?.target.kind).toBe('edit');
        expect(shown?.sending).toBe(false);
        expect(shown?.draft).toEqual({ ticket: 'ESSAI-1', comment: 'Mapping' });
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
    });

    it('refusée, elle reste ouverte avec son refus, et rien d’autre ne s’ouvre', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench, 'SHOP-999');
        const key = bench.editing.window?.key;
        bench.press('Enter');

        await bench.answer(bench.jira);
        expect(bench.editing.window?.key).toBe(key);
        expect(bench.editing.window?.errors.ticket).toBe(TICKET_NOT_FOUND);
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);
    });
});

describe('Entrée sur un autre bloc pendant que la fenêtre attend Jira', () => {
    it('puis Ctrl+V : le collage est retenu, et la fenêtre s’ouvre sur le bloc tel qu’il est', async () => {
        const bench = mountGrid({
            blocks: [DAILY, HOUR, { start: '16:00', end: '17:00', kind: 'work', ticket: 'SHOP-519', comment: 'Repro' }],
            top: 600,
        });
        bench.press('ArrowDown');
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        arrows(bench, 'ArrowDown', 24);
        expect(bench.editing.selection.quarters).toEqual([960]);
        bench.press('Enter');
        bench.type('ESSAI-1');
        bench.jira.hold();
        bench.enter();
        arrows(bench, 'ArrowUp', 8);
        expect(bench.editing.selection.quarters).toEqual([840]);
        bench.press('Enter');
        bench.press('v', { ctrlKey: true });

        await bench.answer(bench.jira);
        expect(bench.editing.window?.target.kind).toBe('edit');
        expect(bench.editing.window?.draft).toEqual({ ticket: 'SHOP-482', comment: 'Mapping' });
        const saved = [
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
            ['16:00', '17:00', 'work', 'ESSAI-1', 'Repro'],
        ];
        expect(bench.slow.ranges()).toEqual(saved);

        // Enregistrée telle quelle, elle n'écrit rien.
        const before = writes(bench);
        bench.enter();
        await bench.settle();
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.ranges()).toEqual(saved);
        expect(writes(bench)).toBe(before);
        expect(bench.editing.message).toBeNull();
    });
});

describe('un raccourci fait pendant qu’un geste est en route', () => {
    it('Suppr juste après Ctrl+V efface ce qui a été collé', async () => {
        const bench = mountGrid({ blocks: [DAILY], top: 600 });
        bench.press('ArrowDown');
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.click(840);
        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        bench.press('Delete');
        await bench.answer(bench.slow);
        expect(bench.slow.ranges()).toEqual([['10:00', '10:15', 'work', 'OPS-12', 'Daily']]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
    });

    it('Ctrl+X juste après « Convertir en pause » coupe la pause', async () => {
        const bench = mountGrid({ top: 600 });
        bench.click(840);
        bench.slow.hold();
        bench.choose('convertToPause');
        await bench.settle();
        bench.press('x', { ctrlKey: true });
        await bench.answer(bench.slow);
        expect(bench.slow.ranges()).toEqual([]);
        bench.click(900);
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([['15:00', '15:15', 'pause', null, null]]);
    });

    it('Ctrl+C juste après Suppr sur la même plage ne copie pas le vide, et le collage suivant n’efface rien', async () => {
        const bench = mountGrid({ blocks: [DAILY, HOUR], top: 600 });
        bench.click(600);
        bench.press('c', { ctrlKey: true });
        await bench.settle();
        bench.select([840, 855]);
        bench.slow.hold();
        bench.press('Delete');
        await bench.settle();
        bench.press('c', { ctrlKey: true });
        await bench.answer(bench.slow);
        bench.click(900);
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        expect(bench.slow.ranges()).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:30', '15:00', 'work', 'SHOP-482', 'Mapping'],
            ['15:00', '15:15', 'work', 'OPS-12', 'Daily'],
        ]);
    });

    it('sur des créneaux qui restent vides, il ne fait rien et n’écrit rien', async () => {
        const bench = mountGrid({ blocks: [DAILY], top: 600 });
        bench.click(600);
        bench.slow.hold();
        bench.press('Delete');
        await bench.settle();
        bench.press('Delete');
        bench.press('x', { ctrlKey: true });
        await bench.answer(bench.slow);
        expect(bench.slow.ranges()).toEqual([]);
        expect(writes(bench)).toBe(2);
    });
});

describe('la sélection faite pendant qu’un geste est en route', () => {
    it('le favori déposé, une fois posé, ne la reprend pas', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        bench.dropFavorite('OPS-3', 840);
        bench.select([480, 495]);
        await bench.answer(bench.jira);
        expect(bench.slow.ranges()).toEqual([
            ['14:00', '14:15', 'work', 'OPS-3', null],
            ['14:15', '15:00', 'work', 'ESSAI-1', 'Mapping'],
        ]);
        expect(bench.editing.selection.quarters).toEqual([480, 495]);
    });

    it('sans autre sélection, le favori posé devient la sélection', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        bench.dropFavorite('OPS-3', 840);
        await bench.answer(bench.jira);
        expect(bench.editing.selection.quarters).toEqual([840]);
    });

    it('Ctrl+V : sa réponse ne la reprend pas, et sans autre sélection, ce qui est collé la devient', async () => {
        const bench = mountGrid({
            blocks: [{ start: '10:00', end: '10:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' }],
            top: 600,
        });
        bench.select([600, 615]);
        bench.press('c', { ctrlKey: true });
        await bench.settle();

        bench.slow.hold();
        bench.click(840);
        bench.press('v', { ctrlKey: true });
        await bench.settle();
        bench.click(960);
        await bench.answer(bench.slow);
        expect(bench.slow.ranges()[1]).toEqual(['14:00', '14:30', 'work', 'OPS-12', 'Daily']);
        expect(bench.editing.selection.quarters).toEqual([960]);

        bench.slow.hold();
        bench.press('v', { ctrlKey: true });
        await bench.answer(bench.slow);
        expect(bench.editing.selection.quarters).toEqual([960, 975]);
    });
});

describe('le menu ouvert au clavier', () => {
    // Il se pose au bas du créneau visé : ce sur quoi il agit se lit dans la sélection.
    it('vise le créneau où s’arrête la sélection, sans la changer', async () => {
        const bench = mountGrid({ top: 480 });
        for (const quarter of [480, 600, 1185]) {
            bench.click(quarter);
            bench.press('F10', { shiftKey: true });
            expect(bench.editing.selection.quarters).toEqual([quarter]);
        }
        bench.select([480, 495, 510]);
        bench.press('ContextMenu');
        expect(bench.editing.selection.quarters).toEqual([480, 495, 510]);
        expect(bench.menus).toHaveLength(4);

        // Après Échap, il s'ouvre sur le créneau atteint, qui redevient la sélection.
        bench.press('Escape');
        expect(bench.editing.selection.quarters).toEqual([]);
        bench.press('F10', { shiftKey: true });
        expect(bench.editing.selection.quarters).toEqual([510]);
        expect(bench.menus).toHaveLength(5);
        await bench.settle();
    });

    it('attend la fenêtre qui s’enregistre, puis s’ouvre sur ce même créneau', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        arrows(bench, 'ArrowDown', 5);
        expect(bench.editing.selection.quarters).toEqual([960]);
        bench.press('F10', { shiftKey: true });
        expect(bench.menus).toEqual([]);
        await bench.answer(bench.jira);
        expect(bench.menus).toHaveLength(1);
        expect(bench.editing.selection.quarters).toEqual([960]);
    });
});

describe('le clic droit pendant que la fenêtre s’enregistre', () => {
    it('le menu attend la fenêtre, puis s’ouvre là où il a été demandé', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        bench.rightClick(960);
        expect(bench.menus).toEqual([]);
        await bench.answer(bench.jira);
        expect(bench.editing.window).toBeNull();
        expect(bench.menus).toEqual([960]);
        expect(bench.editing.selection.quarters).toEqual([960]);
    });

    it('un clic ailleurs pendant l’attente renonce au menu', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        bench.rightClick(960);
        bench.click(1020);
        expect(bench.editing.selection.quarters).toEqual([1020]);
        await bench.answer(bench.jira);
        expect(bench.menus).toEqual([]);
        expect(bench.editing.selection.quarters).toEqual([1020]);
    });

    it('un double-clic ailleurs pendant l’attente : seule sa fenêtre s’ouvre', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        bench.rightClick(960);
        bench.doubleClick(1020);
        await bench.answer(bench.jira);
        expect(bench.menus).toEqual([]);
        expect(bench.editing.window?.target.kind).toBe('new');
        expect(bench.editing.selection.quarters).toEqual([1020]);
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
    });

    it('deux clics droits pendant l’attente : un seul menu, au dernier', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        bench.rightClick(960);
        bench.rightClick(1020);
        await bench.answer(bench.jira);
        expect(bench.menus).toEqual([1020]);
        expect(bench.editing.selection.quarters).toEqual([1020]);
    });

    it('Maj+F10 puis Échap pendant l’attente : la touche renonce au menu, et la fenêtre en envoi garde Échap', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        arrows(bench, 'ArrowDown', 5);
        expect(bench.editing.selection.quarters).toEqual([960]);
        bench.press('F10', { shiftKey: true });
        expect(bench.menus).toEqual([]);
        bench.press('Escape');
        expect(bench.editing.window?.sending).toBe(true);
        expect(bench.editing.selection.quarters).toEqual([960]);
        await bench.answer(bench.jira);
        expect(bench.menus).toEqual([]);
        expect(bench.editing.window).toBeNull();
        expect(bench.editing.selection.quarters).toEqual([960]);
    });

    it('un ticket introuvable : pas de menu, et le clic droit suivant n’en ouvre pas non plus', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench, 'SHOP-999');
        bench.rightClick(960);
        await bench.answer(bench.jira);
        expect(bench.menus).toEqual([]);
        expect(bench.editing.window?.errors.ticket).toBe(TICKET_NOT_FOUND);
        expect(bench.editing.selection.quarters).toEqual([840, 855, 870, 885]);

        bench.rightClick(960);
        await bench.drain();
        expect(bench.menus).toEqual([]);
        expect(bench.editing.window?.draft.ticket).toBe('SHOP-999');
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);
    });
});

describe('le chemin d’enregistrement du champ Ticket', () => {
    it('Entrée de nouveau pendant que Jira cherche : un seul enregistrement, une fois le ticket trouvé', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        const before = writes(bench);
        savingWhileJiraSearches(bench);
        bench.enter();
        bench.enter();
        expect(writes(bench)).toBe(before);

        await bench.answer(bench.jira);
        expect(writes(bench)).toBe(before + 1);
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
    });

    it('un clic à côté pendant que Jira cherche un ticket introuvable : rien ne s’écrit, ni au geste suivant', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        const before = writes(bench);
        bench.press('ArrowDown');
        bench.press('Enter');
        bench.type('SHOP-999');
        bench.jira.hold();
        bench.click(600);
        expect(bench.editing.window?.sending).toBe(true);

        await bench.answer(bench.jira);
        expect(bench.editing.window?.sending).toBe(false);
        expect(bench.editing.window?.errors.ticket).toBe(TICKET_NOT_FOUND);
        // La sélection revient à ce que la fenêtre vise : le clic à côté n'a rien sélectionné.
        expect(bench.editing.selection.quarters).toEqual([840, 855, 870, 885]);

        // Suppr quitte la fenêtre : elle s'enregistre d'abord, refusée, et rien n'est effacé.
        bench.press('Delete');
        await bench.settle();
        expect(bench.editing.window?.draft.ticket).toBe('SHOP-999');
        expect(bench.editing.window?.errors).toEqual({
            ticket: TICKET_NOT_FOUND,
            comment: null,
            weekdays: null,
            until: null,
            rhythm: null,
            general: null,
            focus: true,
        });
        expect(writes(bench)).toBe(before);
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);
    });

    it('« Convertir en pause » sur un ticket tapé introuvable : la pause n’a pas de ticket à vérifier, et s’écrit', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        bench.press('ArrowDown');
        bench.press('Enter');
        bench.type('SHOP-999');
        await bench.drain();
        expect(bench.editing.window?.sending).toBe(false);

        bench.button('pause');
        await bench.settle();
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'pause', null, null]]);
    });
});

describe('la journée relue au retour sur la page', () => {
    const STALE = 'La journée a changé entre-temps. Vérifiez, puis enregistrez de nouveau.';
    const OTHER: SlotChange = { start: '14:00', end: '15:00', kind: 'work', ticket: 'OPS-3', comment: null };

    /** Modifier le ticket sur le bloc de 14:00, un autre ticket et un autre commentaire tapés. */
    function editing(bench: Bench): void {
        bench.press('ArrowDown');
        bench.press('Enter');
        expect(bench.editing.window?.target.kind).toBe('edit');
        bench.type('ESSAI-1', 'Revue');
    }

    it('sous Modifier le ticket, un bloc récrit ailleurs : la fenêtre reste, garde ce qu’on a tapé, et dit ce qu’elle remplacera', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        editing(bench);
        bench.elsewhere(OTHER);
        bench.comeBack();
        await bench.settle();

        expect(bench.shown()).toEqual([['14:00', '15:00', 'work', 'OPS-3', null]]);
        const shown = bench.editing.window;
        expect(shown?.target).toEqual({ kind: 'new', quarters: [840, 855, 870, 885] });
        expect(shown?.draft).toEqual({ ticket: 'ESSAI-1', comment: 'Revue' });
        expect(shown?.errors).toEqual({
            ticket: null,
            comment: null,
            weekdays: null,
            until: null,
            rhythm: null,
            general: STALE,
            focus: false,
        });
        expect(bench.editing.windowNote).toBe('Remplace OPS-3 sur ces 60 minutes.');
        expect(bench.editing.selection.quarters).toEqual([840, 855, 870, 885]);

        // Enregistrée, elle remplace ce que l'autre onglet a posé, et « Annuler » le rend.
        bench.enter();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'ESSAI-1', 'Revue']]);
        bench.undoMessage();
        await bench.drain();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'OPS-3', null]]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
    });

    it('sous Modifier le ticket, un bloc supprimé ailleurs : Nouveau ticket prend sa place, et Échap n’écrit rien', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        editing(bench);
        bench.elsewhere({ start: '14:00', end: '15:00', kind: 'empty', ticket: null, comment: null });
        bench.comeBack();
        await bench.settle();

        expect(bench.shown()).toEqual([]);
        expect(bench.editing.window?.target).toEqual({ kind: 'new', quarters: [840, 855, 870, 885] });
        expect(bench.editing.window?.draft).toEqual({ ticket: 'ESSAI-1', comment: 'Revue' });
        expect(bench.editing.window?.errors.general).toBe(STALE);
        const before = writes(bench);
        bench.escape();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(writes(bench)).toBe(before);
        expect(bench.slow.ranges()).toEqual([]);
    });

    it('changée ailleurs hors de ses créneaux : la fenêtre ne bouge pas, ne dit rien, et s’enregistre', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        editing(bench);
        const target = bench.editing.window?.target;
        bench.elsewhere(DAILY);
        bench.comeBack();
        await bench.settle();

        expect(bench.shown()).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
        expect(bench.editing.window?.target).toBe(target);
        expect(bench.editing.window?.errors.general).toBeNull();
        bench.enter();
        await bench.drain();
        expect(bench.slow.ranges()).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:00', '15:00', 'work', 'ESSAI-1', 'Revue'],
        ]);
    });

    it('sous Nouveau ticket, des créneaux vides remplis ailleurs : elle dit ce qu’elle y remplacera', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 600 });
        bench.press('ArrowDown');
        expect(bench.editing.selection.quarters).toEqual([600]);
        bench.press('Enter');
        bench.type('ESSAI-2');
        expect(bench.editing.windowNote).toBeNull();
        bench.elsewhere(DAILY);
        bench.comeBack();
        await bench.settle();

        expect(bench.editing.window?.target).toEqual({ kind: 'new', quarters: [600] });
        expect(bench.editing.window?.draft.ticket).toBe('ESSAI-2');
        expect(bench.editing.window?.errors.general).toBe(STALE);
        expect(bench.editing.windowNote).toBe('Remplace OPS-12 sur ces 15 minutes.');
    });

    it('pendant que la fenêtre attend Jira, son bloc récrit ailleurs : elle est refusée, et rien n’est écrasé', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench);
        bench.elsewhere(OTHER);
        bench.comeBack();
        await bench.settle();
        expect(bench.shown()).toEqual([['14:00', '15:00', 'work', 'OPS-3', null]]);
        expect(bench.editing.window?.sending).toBe(true);

        const before = writes(bench);
        await bench.answer(bench.jira);
        const shown = bench.editing.window;
        expect(shown?.sending).toBe(false);
        expect(shown?.target).toEqual({ kind: 'new', quarters: [840, 855, 870, 885] });
        expect(shown?.draft).toEqual({ ticket: 'ESSAI-1', comment: 'Mapping' });
        expect(shown?.errors.general).toBe(STALE);
        expect(writes(bench)).toBe(before);
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'OPS-3', null]]);
        expect(bench.snapshot().busy).toBe(false);

        // Enregistrée de nouveau, elle écrit ce qu'on a tapé.
        bench.enter();
        await bench.drain();
        expect(bench.editing.window).toBeNull();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'ESSAI-1', 'Mapping']]);
    });

    it('pendant que Jira cherche un ticket introuvable, son bloc récrit ailleurs : la fenêtre refusée suit son bloc, et le dit', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench, 'SHOP-999');
        bench.elsewhere(OTHER);
        bench.comeBack();
        await bench.settle();

        const before = writes(bench);
        await bench.answer(bench.jira);
        const shown = bench.editing.window;
        expect(shown?.sending).toBe(false);
        expect(shown?.target).toEqual({ kind: 'new', quarters: [840, 855, 870, 885] });
        expect(shown?.draft).toEqual({ ticket: 'SHOP-999', comment: 'Mapping' });
        expect(shown?.errors).toEqual({
            ticket: TICKET_NOT_FOUND,
            comment: null,
            weekdays: null,
            until: null,
            rhythm: null,
            general: STALE,
            focus: true,
        });
        expect(bench.editing.windowNote).toBe('Remplace OPS-3 sur ces 60 minutes.');
        expect(writes(bench)).toBe(before);
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'OPS-3', null]]);
    });

    it('pendant que Jira cherche un ticket introuvable, rien de changé sous la fenêtre : elle ne dit que le refus', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        savingWhileJiraSearches(bench, 'SHOP-999');
        const target = bench.editing.window?.target;
        bench.elsewhere(DAILY);
        bench.comeBack();
        await bench.settle();
        await bench.answer(bench.jira);

        expect(bench.editing.window?.target).toBe(target);
        expect(bench.editing.window?.errors).toEqual({
            ticket: TICKET_NOT_FOUND,
            comment: null,
            weekdays: null,
            until: null,
            rhythm: null,
            general: null,
            focus: true,
        });
    });

    it('un effacement fait pendant la relecture d’une journée changée ailleurs est refusé, et le dit', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        bench.elsewhere(DAILY);
        bench.slow.hold();
        bench.comeBack();
        await bench.settle();
        bench.click(840);
        bench.press('Delete');
        await bench.answer(bench.slow);

        expect(bench.editing.message?.content).toBe("La journée a changé entre-temps. Rien n'a été modifié.");
        expect(bench.slow.ranges()).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:00', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
        expect(bench.shown()).toEqual(bench.slow.ranges());

        // Refait sur la journée relue, il efface.
        bench.press('Delete');
        await bench.drain();
        expect(bench.slow.ranges()).toEqual([
            ['10:00', '10:15', 'work', 'OPS-12', 'Daily'],
            ['14:15', '15:00', 'work', 'SHOP-482', 'Mapping'],
        ]);
    });

    it('un effacement encore en route part d’abord, la relecture le montre, et « Annuler » le défait', async () => {
        const bench = mountGrid({ blocks: [HOUR], top: 885 });
        bench.slow.hold();
        bench.click(840);
        bench.press('Delete');
        bench.comeBack();
        await bench.answer(bench.slow);

        expect(bench.slow.ranges()).toEqual([['14:15', '15:00', 'work', 'SHOP-482', 'Mapping']]);
        expect(bench.shown()).toEqual(bench.slow.ranges());
        expect(bench.snapshot()).toMatchObject({ canUndo: true, busy: false });
        bench.undoMessage();
        await bench.drain();
        expect(bench.slow.ranges()).toEqual([['14:00', '15:00', 'work', 'SHOP-482', 'Mapping']]);
    });
});
