import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import { defineConfig } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { TAILWIND_RESTRICTIONS } from './eslint-restrictions.js';

export default defineConfig(
    {
        files: ['**/*.{js,ts,tsx}'],
        extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files: ['assets/**/*.{ts,tsx}', 'tests/front/**/*.{ts,tsx}'],
        extends: [
            eslintReact.configs['recommended-type-checked'],
            reactHooks.configs.flat['recommended-latest'],
            jsxA11y.configs.strict,
        ],
        languageOptions: {
            globals: globals.browser,
        },
        rules: {
            // Une zone qui défile sans rien de focalisable se parcourt au clavier
            // (WCAG 2.1.1) : elle prend le focus, comme région nommée.
            'jsx-a11y-x/no-noninteractive-tabindex': ['error', { roles: ['region'] }],
        },
    },
    {
        // Ces composants évitent exprès quelques nouveautés de React : ils lisent un contexte
        // par useContext, le fournissent par .Provider et passent leur référence par forwardRef.
        files: ['assets/components/**/*.tsx'],
        rules: {
            '@eslint-react/no-context-provider': 'off',
            '@eslint-react/no-forward-ref': 'off',
            '@eslint-react/no-use-context': 'off',
        },
    },
    {
        // Le code de l'écran seulement : les tests écrivent exprès des classes fautives.
        files: ['assets/**/*.{ts,tsx}'],
        rules: {
            // Aucune valeur visuelle en dur : ni classe Tailwind qui porte
            // sa valeur (eslint-restrictions.js), ni style écrit dans le composant.
            'no-restricted-syntax': [
                'error',
                ...TAILWIND_RESTRICTIONS,
                {
                    selector: 'JSXAttribute[name.name="style"]',
                    message: 'Pas de style dans un composant : une classe, ou data-color pour une teinte de ticket.',
                },
            ],
        },
    },
    {
        // Les fichiers de configuration en JavaScript importent des extensions sans
        // types : l'analyse par les types n'y a rien à lire.
        files: ['**/*.js'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        files: ['*.config.js', '*.config.ts', 'tests/e2e/**/*.ts'],
        languageOptions: {
            globals: globals.node,
        },
    },
);
