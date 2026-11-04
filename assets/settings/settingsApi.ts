import { bodyOf, readViolations } from '../day/dayApi';
import type { Violation } from '../grid/daySession';
import { isRecord } from '../grid/json';
import { isTint, type Tint } from './tints';

/** Un type de ticket rencontré dans les saisies ou les favoris, et sa teinte. */
export interface IssueTypeSetting {
    readonly id: string;
    readonly name: string;
    readonly color: Tint;
}

/** Les réglages que garde le serveur (src/Settings/UserSettings.php). */
export interface Settings {
    /** En minutes. */
    readonly habitualObjective: number;
    /** En jours de la semaine ISO, du lundi (1) au dimanche (7), dans l'ordre. */
    readonly workingDays: readonly number[];
    /** Du plus utilisé au moins utilisé. */
    readonly issueTypes: readonly IssueTypeSetting[];
}

export type SettingsResult =
    /** Enregistré, ou rien à changer (un type disparu entre-temps) : voici les réglages à jour. */
    | { readonly status: 'saved'; readonly settings: Settings }
    /** Une règle refuse la valeur : rien n'est écrit (422). */
    | { readonly status: 'invalid'; readonly violations: readonly Violation[] };

/** L'API des réglages, vue de la page. Une panne — réseau, erreur du serveur — lève. */
export interface SettingsApi {
    read(): Promise<Settings>;
    setHabitualObjective(minutes: number): Promise<SettingsResult>;
    setWorkingDay(day: number, worked: boolean): Promise<SettingsResult>;
    recolor(type: string, color: Tint): Promise<SettingsResult>;
}

/** L'API des réglages (src/Controller/Api/SettingsController.php). */
export function httpSettingsApi(fetcher: typeof fetch = (input, init) => fetch(input, init)): SettingsApi {
    const BASE = '/api/settings';

    async function write(target: string, body: unknown): Promise<SettingsResult> {
        const response = await fetcher(target, {
            method: 'PUT',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const json = await bodyOf(response);
        // Un type que la base n'a plus (404) ne change rien : la réponse rend les réglages.
        if (response.status === 200 || response.status === 404) {
            return { status: 'saved', settings: readSettings(json) };
        }
        if (response.status === 422 && isRecord(json)) {
            return { status: 'invalid', violations: readViolations(json.violations) };
        }

        throw new Error(`L'API a répondu ${String(response.status)} à PUT ${target}.`);
    }

    return {
        async read() {
            const response = await fetcher(BASE, { headers: { Accept: 'application/json' } });
            if (response.status !== 200) {
                throw new Error(`L'API a répondu ${String(response.status)} pour les réglages.`);
            }

            return readSettings(await bodyOf(response));
        },
        setHabitualObjective: (minutes) => write(`${BASE}/habitual-objective`, { objective: minutes }),
        setWorkingDay: (day, worked) => write(`${BASE}/working-days/${String(day)}`, { worked }),
        recolor: (type, color) => write(`${BASE}/issue-types/${encodeURIComponent(type)}`, { color }),
    };
}

export function readSettings(json: unknown): Settings {
    if (
        !isRecord(json) ||
        typeof json.habitualObjective !== 'number' ||
        !Array.isArray(json.workingDays) ||
        !Array.isArray(json.issueTypes)
    ) {
        throw new TypeError("L'API ne décrit pas les réglages.");
    }
    const workingDays = json.workingDays.filter((day: unknown): day is number => typeof day === 'number');
    if (workingDays.length !== json.workingDays.length) {
        throw new TypeError("L'API ne décrit pas les jours travaillés.");
    }

    return {
        habitualObjective: json.habitualObjective,
        workingDays,
        issueTypes: json.issueTypes.map((type: unknown) => {
            if (
                !isRecord(type) ||
                typeof type.id !== 'string' ||
                typeof type.name !== 'string' ||
                !isTint(type.color)
            ) {
                throw new TypeError("L'API ne décrit pas un type de ticket.");
            }

            return { id: type.id, name: type.name, color: type.color };
        }),
    };
}
