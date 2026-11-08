import { describe, expect, it, vi } from 'vitest';

import { httpV1ImportApi, NOTHING_LEFT_OUT, readV1LeftOut } from '../../../assets/v1/v1ImportApi';

describe('ce que la page dit de la reprise', () => {
    it('se lit tel quel', () => {
        const leftOut = {
            entries: [{ date: '2024-03-04', start: '06:30', end: '07:00', ticket: 'SHOP-482' }],
            objectives: [{ date: '2024-03-06', from: 1440, to: 780 }],
            favorites: ['PROJET'],
        };

        expect(readV1LeftOut(JSON.stringify(leftOut))).toEqual(leftOut);
    });

    it.each([undefined, '', 'pas du JSON', 'null', '[]', '{"entries":"non"}'])(
        'ne dit rien de ce qui ne se lit pas : %s',
        (value) => {
            expect(readV1LeftOut(value)).toEqual(NOTHING_LEFT_OUT);
        },
    );

    it('laisse de côté une ligne de travers sans faire taire les autres', () => {
        const entry = { date: '2024-03-05', start: '09:10', end: null, ticket: null };
        const objective = { date: '2024-03-06', from: 1440, to: 780 };

        expect(
            readV1LeftOut(
                JSON.stringify({
                    entries: [entry, { date: '2024-03-04', start: 630 }, null],
                    objectives: [{ date: '2024-03-07', from: '24h00', to: 780 }, objective],
                    favorites: ['PROJET', 12],
                }),
            ),
        ).toEqual({ entries: [entry], objectives: [objective], favorites: ['PROJET'] });
    });
});

describe('dire que la liste est lue', () => {
    it('part en JSON, comme toute écriture', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

        await httpV1ImportApi(fetcher).seen();

        expect(fetcher).toHaveBeenCalledWith('/api/v1-import/seen', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: '{}',
        });
    });

    it('échoue quand le serveur refuse', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));

        await expect(httpV1ImportApi(fetcher).seen()).rejects.toThrow('500');
    });
});
