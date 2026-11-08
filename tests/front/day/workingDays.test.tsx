// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { type HeardWorkingDays, latestWorkingDays, useWorkingDays } from '../../../assets/day/workingDays';

// React vérifie que ses rendus de test passent par act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = [1, 2, 3, 4, 5];
const SIX = [1, 2, 3, 4, 5, 6];
const FOUR = [1, 2, 3, 4];
const NOTHING: HeardWorkingDays = { day: null, month: null };

describe('latestWorkingDays', () => {
    it('garde ceux d’avant tant que rien n’a changé', () => {
        expect(latestWorkingDays(WEEK, NOTHING, NOTHING)).toBe(WEEK);
        expect(latestWorkingDays(WEEK, { day: SIX, month: SIX }, { day: [...SIX], month: [...SIX] })).toBe(WEEK);
    });

    it('prend ceux de la source qui vient de changer', () => {
        expect(latestWorkingDays(WEEK, NOTHING, { day: SIX, month: null })).toBe(SIX);
        expect(latestWorkingDays(WEEK, { day: SIX, month: null }, { day: SIX, month: FOUR })).toBe(FOUR);
        expect(latestWorkingDays(FOUR, { day: SIX, month: FOUR }, { day: WEEK, month: FOUR })).toBe(WEEK);
    });

    it('donne raison au calendrier quand les deux changent ensemble', () => {
        expect(latestWorkingDays(WEEK, NOTHING, { day: SIX, month: FOUR })).toBe(FOUR);
    });

    it('ne revient pas à ceux d’avant quand une source se tait', () => {
        // Changer de jour : la journée suivante est en lecture.
        expect(latestWorkingDays(SIX, { day: SIX, month: null }, NOTHING)).toBe(SIX);
    });

    it('rend les mêmes jours tels quels, sans en faire de nouveaux', () => {
        expect(latestWorkingDays(WEEK, NOTHING, { day: [...WEEK], month: null })).toBe(WEEK);
    });
});

describe('useWorkingDays', () => {
    let root: ReturnType<typeof createRoot> | null = null;

    afterEach(() => {
        act(() => {
            root?.unmount();
        });
        root = null;
    });

    function Probe({
        initial,
        heard,
        seen,
    }: {
        initial: readonly number[];
        heard: HeardWorkingDays;
        seen: (readonly number[])[];
    }) {
        seen.push(useWorkingDays(initial, heard));

        return null;
    }

    function render(initial: readonly number[], heard: HeardWorkingDays, seen: (readonly number[])[]) {
        root ??= createRoot(document.createElement('div'));
        act(() => {
            root?.render(<Probe initial={initial} heard={heard} seen={seen} />);
        });
    }

    it('part de ceux de la page, puis suit la dernière réponse arrivée', () => {
        const seen: (readonly number[])[] = [];
        render(WEEK, NOTHING, seen);
        expect(seen.at(-1)).toEqual(WEEK);

        render(WEEK, { day: SIX, month: null }, seen);
        expect(seen.at(-1)).toEqual(SIX);

        // Le calendrier relu au retour sur l'onglet : un autre a changé les réglages.
        render(WEEK, { day: SIX, month: FOUR }, seen);
        expect(seen.at(-1)).toEqual(FOUR);

        // Un autre jour, lu ensuite, les redit autrement : c'est lui le plus récent.
        render(WEEK, { day: null, month: FOUR }, seen);
        render(WEEK, { day: WEEK, month: FOUR }, seen);
        expect(seen.at(-1)).toEqual(WEEK);
    });
});
