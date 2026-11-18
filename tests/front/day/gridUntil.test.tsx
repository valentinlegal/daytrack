// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SlotChange } from '../../../assets/grid/changes';
import type { FakeDayServer } from '../grid/fakeDayServer';
import { weeklyRule } from '../grid/support';
import { type Bench, DATE, mountScreen, unmountAll } from './gridBench';

/**
 * « Jusqu'au » d'une récurrence coupée plus loin par « Cette fois et les suivantes », sur la vraie
 * fenêtre : elle montre sa dernière fois, jamais la veille de la coupe, que personne n'a saisie.
 * Laissée telle quelle, la fenêtre garde la fin enregistrée ; la suite coupée, une autre
 * récurrence, ne bouge pas. Collée ailleurs, la coupe montre aussi sa dernière fois.
 */

/** Le Daily, de 09:00 à 09:30, né la veille, chaque jour ouvré. */
const DAILY: SlotChange = { start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' };
const NINE = 540;
const WEDNESDAY = '2026-10-07';
/** Le lundi de la semaine suivante, où un autre onglet coupe le Daily : sa fin devient le dimanche. */
const NEXT_MONDAY = '2026-10-12';
const SUNDAY = '2026-10-11';
const FRIDAY = '2026-10-09';

afterEach(() => {
    unmountAll();
});

/** Un autre onglet change le commentaire du Daily le lundi suivant, avec les suivantes : rend la nouvelle. */
function cutNextMonday(server: FakeDayServer, daily: string): string {
    const record = server.recurrence(daily);
    const result = server.saveRecurrence(
        NEXT_MONDAY,
        server.read(NEXT_MONDAY).version,
        [{ ...DAILY, comment: 'Rétro' }],
        weeklyRule([1, 2, 3, 4, 5]),
        { id: daily, weekdays: record?.weekdays ?? [], until: record?.until ?? null },
    );
    if (result.status !== 'saved') {
        throw new Error(`Le Daily ne s'est pas coupé : ${JSON.stringify(result)}.`);
    }

    return result.untils.at(-1)?.recurrence ?? '';
}

function untilField(): HTMLInputElement {
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="date"]');
    if (field === null) {
        throw new Error("La fenêtre n'a pas de « Jusqu'au ».");
    }

    return field;
}

async function openDaily(bench: Bench, quarter = NINE): Promise<void> {
    bench.doubleClick(quarter);
    await bench.drain();
}

describe('« Jusqu’au » d’une récurrence coupée plus loin', () => {
    it('montre sa dernière fois, le vendredi, pas le dimanche de la coupe', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: NINE });
        const daily = bench.slow.server.allRecurrences()[0]?.id ?? '';
        cutNextMonday(bench.slow.server, daily);
        expect(await bench.switchDay(DATE)).toBe(true);
        expect(bench.slow.server.recurrence(daily)?.until).toBe(SUNDAY);

        await openDaily(bench);
        expect(untilField().value).toBe(FRIDAY);
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('vendredi 9 octobre');
        expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('dimanche 11 octobre');
    });

    it('laissée telle quelle, un autre commentaire avec les suivantes garde la fin enregistrée ; la suite coupée ne bouge pas', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: NINE });
        const { server } = bench.slow;
        const daily = server.allRecurrences()[0]?.id ?? '';
        const retro = cutNextMonday(server, daily);
        expect(await bench.switchDay(DATE)).toBe(true);

        await openDaily(bench);
        bench.type('OPS-12', 'Point');
        bench.enter();
        await bench.drain();
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();

        const point = server.allRecurrences().at(-1);
        expect(point).toMatchObject({ firstDay: DATE, until: SUNDAY, content: { comment: 'Point' } });
        // L'autre série, née le lundi, est indépendante : elle garde son commentaire et sa fin.
        expect(server.recurrence(retro)).toMatchObject({
            firstDay: NEXT_MONDAY,
            until: null,
            content: { comment: 'Rétro' },
        });
        expect(
            server
                .read(NEXT_MONDAY)
                .grid.blocks()
                .map((block) => (block.content.kind === 'work' ? block.content.comment : null)),
        ).toEqual(['Rétro']);

        // Sa fenêtre montre de nouveau sa dernière fois.
        await openDaily(bench);
        expect(untilField().value).toBe(FRIDAY);
    });

    it('coupée avec les suivantes puis collée le mercredi : la fenêtre du collage montre sa dernière fois', async () => {
        const bench = mountScreen({ recurrences: [DAILY], top: NINE });
        const daily = bench.slow.server.allRecurrences()[0]?.id ?? '';
        cutNextMonday(bench.slow.server, daily);
        expect(await bench.switchDay(DATE)).toBe(true);

        bench.select([NINE, NINE + 15]);
        bench.press('x', { ctrlKey: true });
        await bench.drain();
        bench.chooseScope('following');
        bench.enter();
        await bench.drain();
        expect(await bench.switchDay(WEDNESDAY)).toBe(true);
        bench.click(600);
        bench.press('v', { ctrlKey: true });
        await bench.drain();

        const pasted = bench.slow.server.allRecurrences().at(-1);
        expect(pasted).toMatchObject({ firstDay: WEDNESDAY, start: '10:00', until: SUNDAY });
        await openDaily(bench, 600);
        expect(untilField().value).toBe(FRIDAY);
        act(() => {
            bench.escape();
        });
    });
});
