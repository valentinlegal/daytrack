import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { duration, signedDuration } from '../../../assets/day/format';

describe('duration', () => {
    it.each([
        [0, '0h00'],
        [15, '0h15'],
        [105, '1h45'],
        [450, '7h30'],
        [780, '13h00'],
    ])('%i minutes → %s', (minutes, text) => {
        expect(duration(minutes)).toBe(text);
    });

    it('se relit en minutes', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 1440 }), (minutes) => {
                const [hours = '', rest = ''] = duration(minutes).split('h');

                expect(rest).toMatch(/^\d{2}$/);
                expect(Number(hours) * 60 + Number(rest)).toBe(minutes);
            }),
        );
    });

    it('refuse une durée négative ou fractionnaire', () => {
        expect(() => duration(-15)).toThrow(RangeError);
        expect(() => duration(7.5)).toThrow(RangeError);
    });
});

describe('signedDuration', () => {
    it('signe le solde, avec le moins typographique', () => {
        expect(signedDuration(45)).toBe('+0h45');
        expect(signedDuration(-45)).toBe('−0h45');
        expect(signedDuration(-450)).toBe('−7h30');
        expect(signedDuration(0)).toBe('+0h00');
    });
});
