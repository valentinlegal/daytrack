import { firstRefusal, UNSAVED } from '../serverApi';
import type { Settings, SettingsApi, SettingsResult } from './settingsApi';
import type { Tint } from './tints';

/** Ce que dit la page quand les réglages ne se lisent pas. */
export const UNREAD = 'Les réglages ne se lisent pas. Rechargez la page.';

/** Ce qu'un refus vise : l'endroit de la page où il se dit. */
export type SettingsArea = 'objective' | 'days' | 'types';

export interface EditorSnapshot {
    /** Les réglages tels que la page les montre : ceux du serveur, et ce qui part ; null tant qu'ils ne sont pas lus. */
    readonly settings: Settings | null;
    /** Ils ne se lisent pas. */
    readonly unread: boolean;
    readonly errors: Readonly<Partial<Record<SettingsArea, string>>>;
}

type Change =
    | { readonly kind: 'objective'; readonly minutes: number }
    | { readonly kind: 'day'; readonly day: number; readonly worked: boolean }
    | { readonly kind: 'tint'; readonly type: string; readonly color: Tint };

/**
 * Les réglages que la page change, sans bouton : chacun s'applique aussitôt à l'écran et
 * part au serveur.
 *
 * Une seule écriture à la fois, dans l'ordre des gestes : chaque réponse rend des
 * réglages plus récents que la précédente, et une réponse en retard ne défait jamais
 * l'écran. Un réglage changé plusieurs fois pendant qu'une écriture attend ne part
 * qu'une fois, à sa dernière valeur. Un refus remet ce qu'il visait comme le serveur le
 * tient, et se dit à son endroit.
 */
export class SettingsEditor {
    private readonly api: SettingsApi;
    private readonly listeners = new Set<() => void>();
    private server: Settings | null = null;
    private unread = false;
    private errors: Partial<Record<SettingsArea, string>> = {};
    /** Ce qui attend de partir, par réglage, dans l'ordre où on l'a changé. */
    private readonly pending = new Map<string, Change>();
    private sending: Change | null = null;
    private waiting: (() => void)[] = [];
    private snapshot: EditorSnapshot = { settings: null, unread: false, errors: {} };

    constructor(api: SettingsApi) {
        this.api = api;
    }

    current(): EditorSnapshot {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }

    async load(): Promise<void> {
        try {
            this.server = await this.api.read();
            this.unread = false;
        } catch {
            this.unread = this.server === null;
        }
        this.publish();
    }

    setHabitualObjective(minutes: number): void {
        this.change({ kind: 'objective', minutes });
    }

    setWorkingDay(day: number, worked: boolean): void {
        this.change({ kind: 'day', day, worked });
    }

    recolor(type: string, color: Tint): void {
        this.change({ kind: 'tint', type, color });
    }

    /** Rien n'attend de partir ni de réponse. */
    idle(): boolean {
        return this.sending === null && this.pending.size === 0;
    }

    /** Attend que tout ce qui a été changé soit enregistré, ou refusé : avant de quitter la page. */
    settled(): Promise<void> {
        if (this.idle()) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.waiting.push(resolve);
        });
    }

    private change(change: Change): void {
        const key = keyOf(change);
        // Le réglage passe en dernier : c'est sa valeur la plus récente.
        this.pending.delete(key);
        this.pending.set(key, change);
        this.errors = withoutError(this.errors, areaOf(change));
        this.publish();
        void this.drain();
    }

    private async drain(): Promise<void> {
        if (this.sending !== null) {
            return;
        }
        for (let next = this.pending.entries().next(); !next.done; next = this.pending.entries().next()) {
            const [key, change] = next.value;
            this.pending.delete(key);
            this.sending = change;
            try {
                const result = await this.send(change);
                if (result.status === 'saved') {
                    this.server = result.settings;
                } else {
                    this.errors = { ...this.errors, [areaOf(change)]: firstRefusal(result.violations) };
                }
            } catch {
                this.errors = { ...this.errors, [areaOf(change)]: UNSAVED };
            }
            this.sending = null;
            this.publish();
        }
        const waiting = this.waiting;
        this.waiting = [];
        for (const resolve of waiting) {
            resolve();
        }
    }

    private send(change: Change): Promise<SettingsResult> {
        switch (change.kind) {
            case 'objective':
                return this.api.setHabitualObjective(change.minutes);
            case 'day':
                return this.api.setWorkingDay(change.day, change.worked);
            case 'tint':
                return this.api.recolor(change.type, change.color);
        }
    }

    private publish(): void {
        let settings = this.server;
        if (settings !== null) {
            for (const change of [...(this.sending === null ? [] : [this.sending]), ...this.pending.values()]) {
                settings = applied(settings, change);
            }
        }
        this.snapshot = { settings, unread: this.unread, errors: this.errors };
        for (const listener of this.listeners) {
            listener();
        }
    }
}

function keyOf(change: Change): string {
    switch (change.kind) {
        case 'objective':
            return 'objective';
        case 'day':
            return `day:${String(change.day)}`;
        case 'tint':
            return `tint:${change.type}`;
    }
}

function areaOf(change: Change): SettingsArea {
    return change.kind === 'objective' ? 'objective' : change.kind === 'day' ? 'days' : 'types';
}

function withoutError(
    errors: Partial<Record<SettingsArea, string>>,
    area: SettingsArea,
): Partial<Record<SettingsArea, string>> {
    if (errors[area] === undefined) {
        return errors;
    }

    return Object.fromEntries(Object.entries(errors).filter(([other]) => other !== area));
}

/** Les réglages avec ce changement, comme le serveur les rendra s'il l'accepte. */
function applied(settings: Settings, change: Change): Settings {
    switch (change.kind) {
        case 'objective':
            return { ...settings, habitualObjective: change.minutes };
        case 'day': {
            const others = settings.workingDays.filter((day) => day !== change.day);

            return { ...settings, workingDays: change.worked ? [...others, change.day].sort((a, b) => a - b) : others };
        }
        case 'tint':
            return {
                ...settings,
                issueTypes: settings.issueTypes.map((type) =>
                    type.id === change.type ? { ...type, color: change.color } : type,
                ),
            };
    }
}
