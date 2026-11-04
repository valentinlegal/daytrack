import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compile } from '@tailwindcss/node';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Tailwind ne connaît que les tokens : une classe de son thème par défaut ne se génère
 * pas, et celles des tokens pointent vers leur variable.
 */
const STYLES = new URL('../../assets/styles/', import.meta.url);

let build: (candidates: string[]) => string;

beforeAll(async () => {
    const compiler = await compile(readFileSync(new URL('app.css', STYLES), 'utf8'), {
        base: fileURLToPath(STYLES),
        onDependency: () => undefined,
    });
    build = (candidates) => compiler.build(candidates);
});

describe('Tailwind réduit aux tokens', () => {
    it.each([
        'bg-red-500',
        'text-blue-600',
        'bg-white',
        'p-8',
        'p-0.5',
        'mt-12',
        'w-64',
        'h-10',
        'text-base',
        'text-2xl',
        'font-sans',
        'rounded-lg',
        'shadow-md',
    ])('%s ne se génère pas', (candidate) => {
        expect(build([candidate])).not.toContain(`.${candidate.replace('.', '\\.')}`);
    });

    it.each([
        ['bg-bg-side', 'var(--bg-side)'],
        ['text-ink-3', 'var(--ink-3)'],
        ['border-line-strong', 'var(--line-strong)'],
        ['p-3', 'var(--s-3)'],
        ['p-7', 'var(--s-7)'],
        ['text-sm', 'var(--t-sm)'],
        ['gap-2', 'var(--s-2)'],
        ['h-ctl', 'var(--h-ctl)'],
        ['w-side', 'var(--w-side)'],
        ['rounded-2', 'var(--r-2)'],
        ['text-md', 'var(--t-md)'],
        ['font-mono', 'var(--f-mono)'],
        ['shadow-pop', 'var(--shadow)'],
        ['bg-ty-bg', 'var(--ty-bg)'],
    ])('%s passe par %s', (candidate, variable) => {
        const css = build([candidate]);

        expect(css).toContain(`.${candidate}`);
        expect(css).toContain(variable);
    });
});
