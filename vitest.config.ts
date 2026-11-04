import { defineConfig } from 'vitest/config';

export default defineConfig({
    oxc: {
        jsx: { runtime: 'automatic' },
    },
    // Ce que la construction pose (webpack.config.js) : une version et une année de test.
    define: {
        DAYTRACK_VERSION: JSON.stringify('2.4.0'),
        DAYTRACK_BUILD_YEAR: JSON.stringify(2027),
    },
    test: {
        include: ['tests/front/**/*.test.{ts,tsx}'],
        setupFiles: ['tests/front/setup.ts'],
        // Le jour de l'utilisateur n'est pas celui de l'heure universelle : les tests
        // tournent dans un fuseau qui les sépare, et jamais dans celui de la machine.
        env: { TZ: 'Europe/Paris' },
    },
});
