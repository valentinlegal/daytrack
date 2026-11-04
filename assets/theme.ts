/**
 * Le thème de l'écran, choisi par navigateur : Clair, Sombre, ou Système.
 *
 * Le choix vit dans localStorage, jamais sur le serveur, pour qu'un poste sombre et
 * un poste clair cohabitent. Le gabarit (templates/base.html.twig) pose le thème
 * avant le premier affichage, avec la même clé : la page ne clignote pas.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'daytrack.theme';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Un choix fait dans cet onglet : l'événement storage ne prévient que les autres. Il
 * porte le choix lui-même, qui vaut pour la page même quand le navigateur refuse de le
 * garder.
 */
const CHOSEN_EVENT = 'daytrack:theme';

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
    if (preference === 'system') {
        return systemPrefersDark ? 'dark' : 'light';
    }

    return preference;
}

/**
 * Le choix enregistré, ou « Système » quand il n'y en a pas, qu'il est
 * illisible, ou que le navigateur refuse l'accès au stockage (navigation privée).
 */
export function readPreference(storage: Pick<Storage, 'getItem'>): ThemePreference {
    let stored: string | null;

    try {
        stored = storage.getItem(THEME_STORAGE_KEY);
    } catch {
        return 'system';
    }

    return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Le choix enregistré dans ce navigateur. L'accès à localStorage lui-même lève quand le
 * navigateur bloque les données du site : il se fait dans getItem, donc sous la garde
 * de readPreference.
 */
export function storedPreference(view: Window): ThemePreference {
    return readPreference({ getItem: (key: string) => view.localStorage.getItem(key) });
}

/**
 * Retient le choix dans ce navigateur, et le pose aussitôt sur la page. Refusé par le
 * navigateur (navigation privée), il ne vaut que pour la page.
 */
export function choosePreference(view: Window, preference: ThemePreference): void {
    try {
        view.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
        // Le choix vaut pour cette page seulement.
    }
    view.dispatchEvent(new CustomEvent<ThemePreference>(CHOSEN_EVENT, { detail: preference }));
}

/** Prévient d'un choix changé, ici ou dans un autre onglet. Rend de quoi arrêter. */
export function onPreferenceChange(view: Window, listener: (preference: ThemePreference) => void): () => void {
    const onChosen = (event: Event): void => {
        if (event instanceof CustomEvent && isPreference(event.detail)) {
            listener(event.detail);
        }
    };
    const onStorage = (event: StorageEvent): void => {
        if (event.key === THEME_STORAGE_KEY || event.key === null) {
            listener(storedPreference(view));
        }
    };
    view.addEventListener(CHOSEN_EVENT, onChosen);
    view.addEventListener('storage', onStorage);

    return () => {
        view.removeEventListener(CHOSEN_EVENT, onChosen);
        view.removeEventListener('storage', onStorage);
    };
}

/**
 * Pose le thème sur la racine, puis le suit : un système qui passe au sombre en
 * cours de journée, un choix changé ici ou dans un autre onglet. Rend de quoi arrêter.
 */
export function followTheme(root: HTMLElement, view: Window): () => void {
    const query = view.matchMedia(SYSTEM_DARK_QUERY);
    let preference = storedPreference(view);
    const apply = (): void => {
        root.dataset.theme = resolveTheme(preference, query.matches);
    };
    const onSystemChange = (): void => {
        apply();
        reloadIcon(root.ownerDocument, query.matches);
    };

    apply();
    query.addEventListener('change', onSystemChange);
    const stop = onPreferenceChange(view, (chosen) => {
        preference = chosen;
        apply();
    });

    return () => {
        query.removeEventListener('change', onSystemChange);
        stop();
    };
}

/**
 * L'icône de l'onglet suit le système, comme la barre du navigateur qui la porte, et pas le
 * thème choisi. Elle le lit à son chargement seulement : changer son adresse la recharge.
 */
function reloadIcon(page: Document, dark: boolean): void {
    page.querySelector('link[rel="icon"][type="image/svg+xml"]')?.setAttribute(
        'href',
        `/favicon.svg?theme=${dark ? 'dark' : 'light'}`,
    );
}

function isPreference(value: unknown): value is ThemePreference {
    return value === 'light' || value === 'dark' || value === 'system';
}
