import { useEffect, useState } from 'react';

/**
 * Sous ce délai, l'onglet qui redevient visible et la fenêtre qui reprend la main sont un
 * seul retour : revenir sur l'onglet donne les deux à la suite.
 */
export const SAME_RETURN = 1000;

type ReturnKind = 'visible' | 'focus';

/**
 * Appelle `onReturn` à chaque retour sur la page : l'onglet qui redevient visible, ou la
 * fenêtre qui reprend la main — avec deux fenêtres côte à côte, l'onglet ne se cache
 * jamais. Les deux à la suite ne comptent qu'une fois. Rend de quoi arrêter d'écouter.
 */
export function watchReturns(target: Window, onReturn: () => void): () => void {
    let last: { readonly kind: ReturnKind; readonly at: number } | null = null;
    const returned = (kind: ReturnKind, at: number) => {
        if (last !== null && last.kind !== kind && at - last.at < SAME_RETURN) {
            last = null;

            return;
        }
        last = { kind, at };
        onReturn();
    };
    const onVisibility = (event: Event) => {
        if (target.document.visibilityState === 'visible') {
            returned('visible', event.timeStamp);
        }
    };
    // Le focus d'un élément ne remonte pas jusqu'ici : seule la fenêtre qui reprend la main compte.
    const onFocus = (event: Event) => {
        returned('focus', event.timeStamp);
    };
    target.document.addEventListener('visibilitychange', onVisibility);
    target.addEventListener('focus', onFocus);

    return () => {
        target.document.removeEventListener('visibilitychange', onVisibility);
        target.removeEventListener('focus', onFocus);
    };
}

/**
 * Le nombre de retours sur la page depuis l'ouverture de l'écran (watchReturns). Ce qui
 * se relit au retour — un autre onglet a pu le changer — le met dans les dépendances de
 * l'effet qui le lit.
 */
export function useReturns(): number {
    const [returns, setReturns] = useState(0);
    useEffect(
        () =>
            watchReturns(window, () => {
                setReturns((count) => count + 1);
            }),
        [],
    );

    return returns;
}
