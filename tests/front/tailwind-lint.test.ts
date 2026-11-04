import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { TAILWIND_RESTRICTIONS } from '../../eslint-restrictions.js';

/**
 * Les classes Tailwind qui portent leur valeur en elles-mêmes, que le thème réduit
 * aux tokens ne peut pas retirer : ESLint les refuse (eslint-restrictions.js).
 */
const linter = new Linter();

function errors(className: string): number {
    return linter.verify(
        `export const classes = '${className}';`,
        [
            {
                files: ['**/*.ts'],
                languageOptions: { parser: tseslint.parser },
                rules: { 'no-restricted-syntax': ['error', ...TAILWIND_RESTRICTIONS] },
            },
        ],
        'classes.ts',
    ).length;
}

describe('les classes Tailwind qui portent leur valeur', () => {
    it.each([
        'w-[13px]',
        'p-[3px]',
        'hover:bg-[#f00]',
        '[color:red]',
        'hover:[background:#f00]',
        'opacity-45',
        'disabled:opacity-50',
        'border-2',
        'border-l-4',
        'outline-2',
        'outline-offset-2',
        'ring-2',
        'duration-300',
        'delay-150',
        'z-10',
        'scale-110',
        '-translate-x-2',
        'inline-flex opacity-45',
        'data-[state=open]:bg-[#f00]',
        'data-[state=open]:[color:red]',
        'aria-[sort=ascending]:opacity-50',
        'group-data-[state=open]:w-[13px]',
        'group-data-[menu=open]/card:w-[13px]',
        'group-hover/card:w-[13px]',
        'group-focus/card:opacity-50',
        'group-hover/card:[color:red]',
        'min-[900px]:p-3',
    ])('« %s » est refusée', (className) => {
        expect(errors(className)).toBe(1);
    });

    it.each([
        'opacity-(--o-disabled)',
        'duration-(--dur-panel)',
        'border',
        'border-line-strong',
        'p-3',
        'h-ctl',
        'text-sm',
        'grid-cols-7',
        'bg-bg-side text-ink-3',
        'Annuler (Ctrl+Z)',
        '[data-theme="dark"]',
        'data-[state=open]:bg-bg-sel',
        'hover:data-[state=closed]:text-ink-2',
        'aria-[sort=ascending]:text-ink',
        'group-data-[state=open]:bg-bg-hover',
        'group-data-[menu=open]/card:shadow-1',
        'group-hover/card:border-line-strong',
    ])('« %s » passe', (className) => {
        expect(errors(className)).toBe(0);
    });
});
