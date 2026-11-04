import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_OBJECTIVE, readObjective, stepObjective } from '../../../assets/grid/objective';
import { duration } from '../../../assets/day/format';

describe('l’objectif tapé', () => {
    it.each([
        ['7h30', 450],
        ['7h', 420],
        ['7 h 30', 450],
        ['7:30', 450],
        ['7,5', 450],
        ['7.25', 435],
        ['8', 480],
        ['0', 0],
        ['0h00', 0],
        ['13h00', 780],
        [' 6H00 ', 360],
    ])('lit « %s » comme %i minutes', (text, minutes) => {
        expect(readObjective(text)).toEqual({ kind: 'ok', minutes });
    });

    it.each(['', 'sept heures', '7h75', '-1', '7:3', '1:2:3', '7h30m'])(
        'refuse « %s », qui n’est pas une durée',
        (text) => {
            expect(readObjective(text)).toEqual({ kind: 'format' });
        },
    );

    it.each([
        ['7h10', 430],
        ['7,1', 426],
        ['7.333', 439.98],
    ])('refuse « %s », hors du quart d’heure, en gardant sa durée', (text, minutes) => {
        const reading = readObjective(text);

        expect(reading.kind).toBe('quarter');
        expect(reading.kind === 'format' ? null : reading.minutes).toBeCloseTo(minutes);
    });

    it.each([
        ['13h15', 795],
        ['14', 840],
        ['99h', 5940],
    ])('refuse « %s », au-delà de 13h00, en gardant sa durée', (text, minutes) => {
        expect(readObjective(text)).toEqual({ kind: 'range', minutes });
    });

    it('relit tel quel tout objectif qu’il affiche', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: MAX_OBJECTIVE / 15 }), (quarters) => {
                expect(readObjective(duration(quarters * 15))).toEqual({ kind: 'ok', minutes: quarters * 15 });
            }),
        );
    });

    it('avance d’un quart d’heure à − et +, sans passer sous 0h00 ni au-delà de 13h00', () => {
        expect(stepObjective(450, 1)).toBe(465);
        expect(stepObjective(450, -1)).toBe(435);
        expect(stepObjective(0, -1)).toBe(0);
        expect(stepObjective(MAX_OBJECTIVE, 1)).toBe(MAX_OBJECTIVE);
    });

    it('part d’une durée refusée vers le quart d’heure le plus proche dans le sens demandé', () => {
        expect(stepObjective(490, 1), '8h10 et +').toBe(495);
        expect(stepObjective(490, -1), '8h10 et −').toBe(480);
        expect(stepObjective(795, 1), '13h15 et +').toBe(MAX_OBJECTIVE);
        expect(stepObjective(795, -1), '13h15 et −').toBe(MAX_OBJECTIVE);
    });
});
