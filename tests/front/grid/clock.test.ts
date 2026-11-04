import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { minuteOn, momentAt } from '../../../assets/grid/clock';

const PARIS = 'Europe/Paris';

describe('momentAt', () => {
    it('passe au lendemain à minuit à Paris, quand il est encore la veille en heure universelle', () => {
        expect(momentAt(new Date('2026-10-24T22:30:00Z'), PARIS)).toEqual({ date: '2026-10-25', minute: 30 });
    });

    it('écrit minuit 00:00, jamais 24:00', () => {
        expect(momentAt(new Date('2026-10-24T22:00:00Z'), PARIS)).toEqual({ date: '2026-10-25', minute: 0 });
        expect(momentAt(new Date('2026-10-24T21:59:00Z'), PARIS)).toEqual({ date: '2026-10-24', minute: 1439 });
    });

    it('vit deux fois 02:30 la nuit du passage à l’heure d’hiver, le 25 octobre', () => {
        expect(momentAt(new Date('2026-10-25T00:30:00Z'), PARIS)).toEqual({ date: '2026-10-25', minute: 150 });
        expect(momentAt(new Date('2026-10-25T01:30:00Z'), PARIS)).toEqual({ date: '2026-10-25', minute: 150 });
        expect(momentAt(new Date('2026-10-25T02:00:00Z'), PARIS)).toEqual({ date: '2026-10-25', minute: 180 });
    });

    it('saute de 02:00 à 03:00 la nuit du passage à l’heure d’été, le 29 mars', () => {
        expect(momentAt(new Date('2026-03-29T00:59:00Z'), PARIS)).toEqual({ date: '2026-03-29', minute: 119 });
        expect(momentAt(new Date('2026-03-29T01:00:00Z'), PARIS)).toEqual({ date: '2026-03-29', minute: 180 });
    });

    it('lit le fuseau réglé pour DayTrack, pas celui du poste', () => {
        // Les tests tournent à Paris (vitest.config.ts) : ces fuseaux en sont loin.
        expect(momentAt(new Date('2026-10-25T03:30:00Z'), 'America/New_York')).toEqual({
            date: '2026-10-24',
            minute: 1410,
        });
        expect(momentAt(new Date('2026-10-24T10:30:00Z'), 'Pacific/Kiritimati')).toEqual({
            date: '2026-10-25',
            minute: 30,
        });
    });

    it('rend en heure universelle le jour de l’heure universelle', () => {
        fc.assert(
            fc.property(
                fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31'), noInvalidDate: true }),
                (instant) => {
                    const moment = momentAt(instant, 'UTC');

                    expect(moment.date).toBe(instant.toISOString().slice(0, 10));
                    expect(moment.minute).toBe(instant.getUTCHours() * 60 + instant.getUTCMinutes());
                },
            ),
        );
    });

    it('refuse un fuseau qui n’existe pas', () => {
        expect(() => momentAt(new Date(), 'Europe/Atlantide')).toThrow(RangeError);
    });
});

describe('minuteOn', () => {
    it('ne donne l’heure que pour aujourd’hui', () => {
        const moment = { date: '2026-10-06', minute: 920 };

        expect(minuteOn('2026-10-06', moment)).toBe(920);
        expect(minuteOn('2026-10-05', moment)).toBeNull();
        expect(minuteOn('2026-10-07', moment)).toBeNull();
    });
});
