import { TabValues, type TabStorage } from '../grid/tabStore';
import { isDate } from './calendar';

/**
 * Ce que l'écran retient le temps de l'onglet : l'heure en haut de la grille, et le jour
 * d'où l'on est parti vers les réglages. Un rechargement les retrouve, un nouvel onglet
 * repart de l'heure par défaut et d'aujourd'hui. Le récapitulatif ouvert, lui, est une
 * préférence (recapPreference.ts).
 */
export const SCREEN_STORAGE_PREFIX = 'daytrack.screen.';

export interface ScreenMemory {
    /** L'heure en haut de la grille, en minutes depuis minuit. */
    gridTop(): number | undefined;
    setGridTop(minutes: number): void;
    /** Le jour affiché quand les réglages se sont ouverts : « Retour à la journée » y ramène. */
    settingsBack(): string | undefined;
    setSettingsBack(date: string): void;
}

export function screenMemory(storage: TabStorage): ScreenMemory {
    const top = new TabValues(storage, SCREEN_STORAGE_PREFIX, (json) =>
        typeof json === 'number' && Number.isFinite(json) ? json : undefined,
    );

    const back = new TabValues(storage, SCREEN_STORAGE_PREFIX, (json) =>
        typeof json === 'string' && isDate(json) ? json : undefined,
    );

    return {
        gridTop: () => top.get('grid-top'),
        setGridTop: (minutes) => {
            top.set('grid-top', minutes);
        },
        settingsBack: () => back.get('settings-back'),
        setSettingsBack: (date) => {
            back.set('settings-back', date);
        },
    };
}
