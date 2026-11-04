import { describe, expect, it } from 'vitest';

import { httpCalendarApi, readMonth } from '../../../assets/day/calendarApi';

const WEEK = [1, 2, 3, 4, 5];

describe('readMonth', () => {
    it('lit les marques jour par jour, les jours mis à 0h00, et les jours travaillés', () => {
        expect(
            readMonth({
                marks: { '2026-10-02': 'incomplete', '2026-10-06': 'unsent' },
                daysOff: ['2026-10-09'],
                workingDays: WEEK,
            }),
        ).toEqual({
            marks: new Map([
                ['2026-10-02', 'incomplete'],
                ['2026-10-06', 'unsent'],
            ]),
            daysOff: new Set(['2026-10-09']),
            workingDays: WEEK,
        });
        expect(readMonth({ marks: {}, daysOff: [], workingDays: [] })).toEqual({
            marks: new Map(),
            daysOff: new Set(),
            workingDays: [],
        });
    });

    it('refuse une réponse de travers plutôt que de marquer un jour à tort', () => {
        for (const broken of [
            null,
            {},
            { marks: [], workingDays: WEEK },
            { marks: null, workingDays: WEEK },
            { marks: { '2026-10-02': 'envoyé' }, workingDays: WEEK },
            { marks: { '2026-10-02': 1 }, workingDays: WEEK },
            { marks: { '2026-02-30': 'unsent' }, workingDays: WEEK },
            { marks: { demain: 'unsent' }, workingDays: WEEK },
            { marks: {}, daysOff: [] },
            { marks: {}, daysOff: [], workingDays: [8] },
            { marks: {}, workingDays: WEEK },
            { marks: {}, daysOff: {}, workingDays: WEEK },
            { marks: {}, daysOff: ['9 octobre'], workingDays: WEEK },
            { marks: {}, daysOff: ['2026-02-30'], workingDays: WEEK },
            { marks: {}, daysOff: [20261009], workingDays: WEEK },
        ]) {
            expect(() => readMonth(broken)).toThrow();
        }
    });
});

describe('httpCalendarApi', () => {
    it('demande la plage affichée, et lève sur une réponse inattendue', async () => {
        const asked: string[] = [];
        const api = httpCalendarApi((input) => {
            asked.push(input instanceof Request ? input.url : String(input));

            return Promise.resolve(
                asked.length === 1
                    ? new Response(
                          JSON.stringify({ marks: { '2026-10-02': 'incomplete' }, daysOff: [], workingDays: WEEK }),
                          { status: 200 },
                      )
                    : new Response('', { status: 404 }),
            );
        });

        expect(await api.marks('2026-09-28', '2026-11-01')).toEqual({
            marks: new Map([['2026-10-02', 'incomplete']]),
            daysOff: new Set(),
            workingDays: WEEK,
        });
        expect(asked).toEqual(['/api/calendar/2026-09-28/2026-11-01']);
        await expect(api.marks('2026-09-28', '2026-12-01')).rejects.toThrow();
    });
});
