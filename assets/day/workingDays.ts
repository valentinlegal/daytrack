import { useState } from 'react';

/** Les jours travaillés que chaque source a dits en dernier, null tant qu'elle n'a rien dit. */
export interface HeardWorkingDays {
    /** La journée lue. */
    readonly day: readonly number[] | null;
    /** Le calendrier relu, au retour sur la page ou après une écriture. */
    readonly month: readonly number[] | null;
}

function same(a: readonly number[] | null, b: readonly number[] | null): boolean {
    return a === b || (a !== null && b !== null && a.join() === b.join());
}

/**
 * Les jours travaillés les plus récents : ceux de la source qui vient de changer — un autre
 * onglet a pu changer les réglages. Si les deux ont changé ensemble, le calendrier, relu
 * après la journée, l'emporte. Rien n'a changé : ceux d'avant.
 */
export function latestWorkingDays(
    current: readonly number[],
    before: HeardWorkingDays,
    now: HeardWorkingDays,
): readonly number[] {
    const fresh = !same(now.month, before.month) ? now.month : !same(now.day, before.day) ? now.day : null;

    return fresh === null || same(fresh, current) ? current : fresh;
}

/**
 * Les jours travaillés que les flèches de la barre sautent et que la grille ferme : ceux de
 * la page au chargement, puis ceux de la dernière réponse arrivée (latestWorkingDays).
 */
export function useWorkingDays(initial: readonly number[], heard: HeardWorkingDays): readonly number[] {
    const [workingDays, setWorkingDays] = useState(initial);
    const [before, setBefore] = useState<HeardWorkingDays>({ day: null, month: null });
    if (!same(heard.day, before.day) || !same(heard.month, before.month)) {
        setBefore(heard);
        const latest = latestWorkingDays(workingDays, before, heard);
        if (latest !== workingDays) {
            setWorkingDays(latest);
        }
    }

    return workingDays;
}
