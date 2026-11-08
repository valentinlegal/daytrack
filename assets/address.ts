import { useEffect, useEffectEvent } from 'react';

import { isDate } from './day/calendar';

/**
 * Ce que dit l'adresse de la page : un jour (« /2026-10-06 »), les réglages, la bienvenue,
 * ou autre chose — un jour impossible compris —, que seul le serveur sait lire.
 *
 * L'adresse se lit et s'écrit ici seulement, et les flèches du navigateur s'écoutent à un
 * seul endroit (useBrowserArrows) : elle ne ment jamais sur l'écran affiché.
 */
export type Address =
    | { readonly screen: 'day'; readonly date: string }
    | { readonly screen: 'settings' }
    | { readonly screen: 'welcome' }
    | { readonly screen: 'other' };

/** Une adresse que l'écran écrit : jamais « autre chose ». */
export type ShownAddress = Exclude<Address, { readonly screen: 'other' }>;

export const SETTINGS: ShownAddress = { screen: 'settings' };

/** La bienvenue a son adresse, tant que Jira n'est pas relié. */
export const WELCOME: ShownAddress = { screen: 'welcome' };

const SETTINGS_PATH = '/reglages';
const WELCOME_PATH = '/bienvenue';

export function dayAddress(date: string): ShownAddress {
    return { screen: 'day', date };
}

/** L'adresse que dit ce chemin. */
export function addressOf(path: string): Address {
    if (path === SETTINGS_PATH) {
        return SETTINGS;
    }
    if (path === WELCOME_PATH) {
        return WELCOME;
    }
    const date = path.slice(1);

    return path.startsWith('/') && isDate(date) ? dayAddress(date) : { screen: 'other' };
}

export function pathOf(address: ShownAddress): string {
    switch (address.screen) {
        case 'day':
            return `/${address.date}`;
        case 'settings':
            return SETTINGS_PATH;
        case 'welcome':
            return WELCOME_PATH;
    }
}

/** L'adresse de la page, telle que la barre du navigateur la montre. */
export function currentAddress(): Address {
    return addressOf(window.location.pathname);
}

/**
 * Ce que l'application écrit dans chaque étape de l'historique de l'onglet : la suite où elle
 * l'a ajoutée, et sa place dans cette suite, qui avance d'un à chaque étape. Les étapes d'une
 * suite se suivent toujours, sans autre entre elles : une flèche refusée ramène de l'une à
 * l'autre sans ajouter d'étape.
 */
interface Step {
    readonly run: string;
    readonly place: number;
}

function stepOf(state: unknown): Step | null {
    return typeof state === 'object' &&
        state !== null &&
        'run' in state &&
        typeof state.run === 'string' &&
        'place' in state &&
        typeof state.place === 'number'
        ? { run: state.run, place: state.place }
        : null;
}

/** Une suite nouvelle, qu'aucune autre étape de l'onglet ne porte. */
function newRun(): Step {
    return { run: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, place: 0 };
}

function writeStep(step: Step, path: string, how: 'push' | 'replace'): void {
    if (how === 'push') {
        window.history.pushState(step, '', path);
    } else {
        window.history.replaceState(step, '', path);
    }
}

/**
 * L'étape où l'on est. Celle que l'application n'a pas écrite — une ancre ajoutée à
 * l'adresse, une étape d'avant une mise à jour — ouvre une suite à elle : on ne sait pas où
 * elle se place parmi les autres.
 */
function stepHere(): Step {
    const here = stepOf(window.history.state);
    if (here !== null) {
        return here;
    }
    const step = newRun();
    writeStep(step, window.location.href, 'replace');

    return step;
}

/**
 * L'étape dont l'écran est affiché. Elle ne suit une flèche du navigateur qu'une fois
 * l'écran changé (followArrow) : refusée, la flèche y ramène (refuseArrow). Elle est à
 * l'onglet, comme son historique.
 */
let shownStep: Step | null = null;

/**
 * Écrit l'adresse de l'écran affiché : `push` ajoute une étape que la flèche Précédent
 * défait, `replace` corrige celle où l'on est sans rien ajouter.
 */
export function showAddress(address: ShownAddress, how: 'push' | 'replace' = 'push'): void {
    const here = stepOf(window.history.state);
    const step = here === null ? newRun() : how === 'push' ? { run: here.run, place: here.place + 1 } : here;
    writeStep(step, pathOf(address), how);
    shownStep = step;
}

/** L'écran a suivi la flèche du navigateur : l'étape où elle a mené est celle qu'il montre. */
export function followArrow(): void {
    shownStep = stepHere();
}

/**
 * L'écran n'a pas suivi la flèche — une fenêtre refusée, un envoi en cours — : l'historique
 * revient à l'étape qu'il montre, sans en ajouter, et Précédent et Suivant mènent ensuite là
 * où ils menaient. Quand on ne sait pas où elle est par rapport à celle où l'on arrive —
 * l'une n'a pas été écrite par l'application —, l'adresse de l'écran affiché s'écrit de
 * nouveau, en une étape de plus.
 */
export function refuseArrow(shown: ShownAddress): void {
    const here = stepOf(window.history.state);
    if (here === null || shownStep?.run !== here.run) {
        showAddress(shown);
    } else if (here.place !== shownStep.place) {
        window.history.go(shownStep.place - here.place);
    }
}

/**
 * Les flèches Précédent et Suivant du navigateur, écoutées une fois pour toute
 * l'application : `onArrive` reçoit l'adresse où elles mènent, et lit l'état courant.
 *
 * L'étape où l'on arrive, si l'application ne l'a pas écrite, ouvre sa propre suite
 * (stepHere).
 */
export function useBrowserArrows(onArrive: (address: Address) => void): void {
    const arrive = useEffectEvent(onArrive);
    useEffect(() => {
        // L'étape où la page s'est ouverte : l'écran la montre.
        shownStep ??= stepHere();
        const listener = () => {
            stepHere();
            arrive(currentAddress());
        };
        window.addEventListener('popstate', listener);

        return () => {
            window.removeEventListener('popstate', listener);
        };
    }, []);
}
