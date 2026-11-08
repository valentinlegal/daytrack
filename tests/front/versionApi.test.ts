import { describe, expect, it } from 'vitest';

import { httpVersionApi, notesUrl, readAvailable } from '../../assets/version/versionApi';

describe('la version à installer', () => {
    it('se lit dans la réponse du serveur', () => {
        expect(readAvailable({ available: '2.5.0' })).toBe('2.5.0');
        expect(readAvailable({ available: null })).toBeNull();
    });

    it.each([
        ['une réponse vide', {}],
        ['une réponse qui n’est pas un objet', 'x'],
        ['null', null],
        ['un nombre', { available: 2 }],
        ['un numéro partiel', { available: '2.5' }],
        ['un préfixe', { available: 'v2.5.0' }],
        ['un suffixe', { available: '2.5.0-rc1' }],
        ['une fin de ligne', { available: '2.5.0\n' }],
        ['une adresse', { available: '2.5.0/../../evil' }],
        ['du balisage', { available: '<b>2.5.0</b>' }],
    ])('ne s’annonce pas sur %s', (_, json) => {
        expect(readAvailable(json)).toBeNull();
    });

    it('lève quand le serveur répond autre chose que 200', async () => {
        const api = httpVersionApi(() => Promise.resolve(new Response('', { status: 500 })));

        await expect(api.available()).rejects.toThrow('500');
    });

    it('lève sur une réponse illisible : l’avis reste tel qu’il était', async () => {
        const api = httpVersionApi(() => Promise.resolve(new Response('<html>', { status: 200 })));

        await expect(api.available()).rejects.toThrow(TypeError);
    });

    it('demande au serveur, jamais au registre', async () => {
        const urls: unknown[] = [];
        const api = httpVersionApi((input) => {
            urls.push(input);

            return Promise.resolve(Response.json({ available: '2.5.0' }));
        });

        await expect(api.available()).resolves.toBe('2.5.0');
        expect(urls).toEqual(['/api/version']);
    });

    it('mène aux notes publiées dans le dépôt, sous le tag de la version', () => {
        expect(notesUrl('2.5.0')).toBe('https://github.com/valentinlegal/daytrack/releases/tag/v2.5.0');
    });
});
