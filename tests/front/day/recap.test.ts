import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { recap } from '../../../assets/grid/recap';
import { gridArbitrary, gridOf } from '../grid/support';

describe('recap', () => {
    it('un ticket par carte, du plus long au plus court, ses commentaires dans l’ordre de la journée', () => {
        const grid = gridOf([
            ['09:15', '09:30', 'work', 'OPS-12', 'Daily'],
            ['09:30', '11:15', 'work', 'SHOP-482', 'Mapping des colonnes'],
            ['11:15', '11:45', 'work', 'SHOP-519', 'Reproduction'],
            ['11:45', '12:30', 'work', 'SHOP-482', 'Tests'],
            ['12:30', '13:30', 'pause', null, null],
            ['13:30', '14:00', 'work', 'OPS-12', 'Poker planning'],
            ['14:00', '15:15', 'work', 'SHOP-501', null],
        ]);

        expect(recap(grid)).toEqual([
            {
                ticket: 'SHOP-482',
                minutes: 150,
                comments: [
                    { text: 'Mapping des colonnes', minutes: 105 },
                    { text: 'Tests', minutes: 45 },
                ],
            },
            { ticket: 'SHOP-501', minutes: 75, comments: [] },
            {
                ticket: 'OPS-12',
                minutes: 45,
                comments: [
                    { text: 'Daily', minutes: 15 },
                    { text: 'Poker planning', minutes: 30 },
                ],
            },
            { ticket: 'SHOP-519', minutes: 30, comments: [{ text: 'Reproduction', minutes: 30 }] },
        ]);
    });

    it('réunit un même commentaire posé à deux moments', () => {
        const grid = gridOf([
            ['09:00', '09:30', 'work', 'SHOP-482', 'Revue'],
            ['10:00', '10:15', 'work', 'SHOP-482', null],
            ['11:00', '11:45', 'work', 'SHOP-482', 'Revue'],
        ]);

        expect(recap(grid)).toEqual([{ ticket: 'SHOP-482', minutes: 90, comments: [{ text: 'Revue', minutes: 75 }] }]);
    });

    it('à durée égale, le ticket saisi le plus tôt passe devant', () => {
        const grid = gridOf([
            ['14:00', '14:30', 'work', 'OPS-7', null],
            ['09:00', '09:30', 'work', 'SHOP-519', null],
        ]);

        expect(recap(grid).map(({ ticket }) => ticket)).toEqual(['SHOP-519', 'OPS-7']);
    });

    it('compte tout le travaillé, et rien que lui : ni pause, ni double', () => {
        fc.assert(
            fc.property(gridArbitrary, (grid) => {
                const tickets = recap(grid);

                expect(tickets.reduce((total, { minutes }) => total + minutes, 0)).toBe(grid.workedMinutes());
                expect(new Set(tickets.map(({ ticket }) => ticket)).size).toBe(tickets.length);
                for (const [index, { minutes, comments }] of tickets.entries()) {
                    expect(minutes).toBeLessThanOrEqual(tickets[index - 1]?.minutes ?? Infinity);
                    expect(comments.reduce((total, comment) => total + comment.minutes, 0)).toBeLessThanOrEqual(
                        minutes,
                    );
                }
            }),
        );
    });
});
