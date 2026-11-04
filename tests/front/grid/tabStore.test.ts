import { describe, expect, it } from 'vitest';

import { tabStorage, TabValues } from '../../../assets/grid/tabStore';
import { memoryStorage } from './support';

const asText = (json: unknown): string | undefined => (typeof json === 'string' ? json : undefined);

describe('TabValues', () => {
    it('rend la dernière écriture de l’onglet, même quand le stockage l’a refusée', () => {
        const storage = memoryStorage();
        const values = new TabValues(storage, 'daytrack.test.', asText);
        expect(values.set('jour', 'court')).toBe(true);
        storage.quota = storage.used();

        expect(values.set('jour', 'bien plus long')).toBe(false);
        expect(values.get('jour')).toBe('bien plus long');
    });

    it('ne laisse jamais à un rechargement une valeur en retard', () => {
        const storage = memoryStorage();
        new TabValues(storage, 'daytrack.test.', asText).set('jour', 'court');
        storage.quota = storage.used();
        new TabValues(storage, 'daytrack.test.', asText).set('jour', 'bien plus long');

        expect(new TabValues(storage, 'daytrack.test.', asText).get('jour')).toBeUndefined();
    });

    it('fait de la place avec ses autres clés quand il le peut, sans les oublier en mémoire', () => {
        const storage = memoryStorage();
        const values = new TabValues(storage, 'daytrack.test.', asText, true);
        values.set('hier', 'une valeur');
        // Assez pour la nouvelle clé seule, pas pour les deux.
        storage.quota = storage.used() + 10;

        expect(values.set('aujourd’hui', 'une valeur')).toBe(true);
        expect(new TabValues(storage, 'daytrack.test.', asText).get('hier')).toBeUndefined();
        expect(values.get('hier')).toBe('une valeur');
    });

    it('ne touche pas aux clés des autres', () => {
        const storage = memoryStorage();
        storage.items.set('daytrack.theme', 'dark');
        const values = new TabValues(storage, 'daytrack.test.', asText, true);
        storage.quota = storage.used() + 5;

        values.set('jour', 'une valeur');
        expect(storage.items.get('daytrack.theme')).toBe('dark');
    });

    it('vaut rien pour ce qui est rangé de travers', () => {
        const storage = memoryStorage();
        storage.items.set('daytrack.test.jour', 'pas du JSON');
        storage.items.set('daytrack.test.nombre', '42');

        const values = new TabValues(storage, 'daytrack.test.', asText);
        expect(values.get('jour')).toBeUndefined();
        expect(values.get('nombre')).toBeUndefined();
    });

    it('garde tout en mémoire quand le navigateur refuse le stockage', () => {
        const values = new TabValues(memoryStorage({ refuse: true }), 'daytrack.test.', asText, true);

        expect(values.set('jour', 'une valeur')).toBe(false);
        expect(values.get('jour')).toBe('une valeur');
        values.delete('jour');
        expect(values.get('jour')).toBeUndefined();
    });

    it('se passe du stockage quand le navigateur en refuse l’accès', () => {
        const blocked = {
            get sessionStorage(): Storage {
                throw new DOMException('Bloqué', 'SecurityError');
            },
        };

        const values = new TabValues(tabStorage(blocked), 'daytrack.test.', asText);

        expect(values.set('jour', 'une valeur')).toBe(false);
        expect(values.get('jour')).toBe('une valeur');
    });

    it('prend le sessionStorage de l’onglet quand il est là', () => {
        const storage = memoryStorage() as unknown as Storage;

        expect(tabStorage({ sessionStorage: storage })).toBe(storage);
    });
});
