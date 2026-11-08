import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { UNSAVED } from '../../../assets/serverApi';
import type { Settings, SettingsApi, SettingsResult } from '../../../assets/settings/settingsApi';
import { SettingsEditor } from '../../../assets/settings/settingsEditor';
import { type Tint, TINTS } from '../../../assets/settings/tints';

const STORY = '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b';
const BUG = '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6c';

const START: Settings = {
    habitualObjective: 450,
    workingDays: [1, 2, 3, 4, 5],
    issueTypes: [
        { id: STORY, name: 'Story', color: 'vert' },
        { id: BUG, name: 'Bug', color: 'rouge' },
    ],
};

/**
 * Un serveur qui applique les réglages comme le vrai (src/Settings/UserSettings.php), et
 * ne répond que quand le test le lui dit. Il peut tomber en panne, ou refuser.
 */
class FakeServer implements SettingsApi {
    settings: Settings = START;
    readonly received: string[] = [];
    private readonly answers: (() => void)[] = [];
    /** Ce qu'il fera de la prochaine requête. */
    next: 'accept' | 'refuse' | 'fail' = 'accept';

    read(): Promise<Settings> {
        return Promise.resolve(this.settings);
    }

    setHabitualObjective(minutes: number): Promise<SettingsResult> {
        return this.write(`objectif ${String(minutes)}`, (settings) => ({ ...settings, habitualObjective: minutes }));
    }

    setWorkingDay(day: number, worked: boolean): Promise<SettingsResult> {
        return this.write(`jour ${String(day)} ${worked ? 'allumé' : 'éteint'}`, (settings) => {
            const others = settings.workingDays.filter((other) => other !== day);

            return { ...settings, workingDays: worked ? [...others, day].sort((a, b) => a - b) : others };
        });
    }

    recolor(type: string, color: Tint): Promise<SettingsResult> {
        return this.write(`teinte ${type === STORY ? 'Story' : 'Bug'} ${color}`, (settings) => ({
            ...settings,
            issueTypes: settings.issueTypes.map((other) => (other.id === type ? { ...other, color } : other)),
        }));
    }

    /** Répond à la plus ancienne requête en attente. */
    async answer(): Promise<void> {
        this.answers.shift()?.();
        await flush();
    }

    get waiting(): number {
        return this.answers.length;
    }

    private write(label: string, change: (settings: Settings) => Settings): Promise<SettingsResult> {
        this.received.push(label);
        const outcome = this.next;
        this.next = 'accept';

        return new Promise((resolve, reject) => {
            this.answers.push(() => {
                if (outcome === 'fail') {
                    reject(new Error('réseau'));
                } else if (outcome === 'refuse') {
                    resolve({ status: 'invalid', violations: [{ field: 'objective', message: 'Refusé.' }] });
                } else {
                    this.settings = change(this.settings);
                    resolve({ status: 'saved', settings: this.settings });
                }
            });
        });
    }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loaded(server = new FakeServer()) {
    const editor = new SettingsEditor(server);
    await editor.load();

    return { editor, server };
}

describe("l'éditeur des réglages", () => {
    it('montre un réglage dès le geste, puis le garde comme le serveur le rend', async () => {
        const { editor, server } = await loaded();

        editor.setWorkingDay(6, true);
        expect(editor.current().settings?.workingDays).toEqual([1, 2, 3, 4, 5, 6]);

        await server.answer();
        expect(editor.current().settings).toEqual(server.settings);
        expect(server.received).toEqual(['jour 6 allumé']);
    });

    it('n’envoie qu’une écriture à la fois, dans l’ordre des gestes', async () => {
        const { editor, server } = await loaded();

        editor.setWorkingDay(6, true);
        editor.setWorkingDay(1, false);
        editor.recolor(STORY, 'cyan');
        expect(server.waiting).toBe(1);

        await server.answer();
        await server.answer();
        await server.answer();

        expect(server.received).toEqual(['jour 6 allumé', 'jour 1 éteint', 'teinte Story cyan']);
        expect(editor.current().settings?.workingDays).toEqual([2, 3, 4, 5, 6]);
    });

    it('n’envoie qu’une fois un réglage changé plusieurs fois pendant une attente, à sa dernière valeur', async () => {
        const { editor, server } = await loaded();

        editor.setHabitualObjective(465);
        editor.setHabitualObjective(480);
        editor.setHabitualObjective(495);
        editor.setHabitualObjective(510);
        expect(editor.current().settings?.habitualObjective).toBe(510);

        await server.answer();
        expect(editor.current().settings?.habitualObjective, 'La réponse en retard ne défait pas l’écran.').toBe(510);
        await server.answer();

        expect(server.received).toEqual(['objectif 465', 'objectif 510']);
        expect(server.settings.habitualObjective).toBe(510);
    });

    it('dit un refus à son endroit, et remet ce qu’il visait comme le serveur le tient', async () => {
        const { editor, server } = await loaded();

        server.next = 'refuse';
        editor.setHabitualObjective(480);
        editor.setWorkingDay(6, true);
        await server.answer();

        expect(editor.current().errors).toEqual({ objective: 'Refusé.' });
        expect(editor.current().settings?.habitualObjective).toBe(450);
        expect(editor.current().settings?.workingDays, 'Le reste part.').toEqual([1, 2, 3, 4, 5, 6]);

        await server.answer();
        editor.setHabitualObjective(495);
        expect(editor.current().errors, 'Un nouveau geste efface le refus.').toEqual({});
    });

    it('dit qu’un enregistrement n’a pas abouti, sans rien laisser à l’écran qui ne soit enregistré', async () => {
        const { editor, server } = await loaded();

        server.next = 'fail';
        editor.recolor(BUG, 'magenta');
        await server.answer();

        expect(editor.current().errors).toEqual({ types: UNSAVED });
        expect(editor.current().settings?.issueTypes[1]?.color).toBe('rouge');
    });

    it('attend que tout soit enregistré avant de laisser quitter la page', async () => {
        const { editor, server } = await loaded();
        let settled = false;

        editor.setHabitualObjective(480);
        editor.setWorkingDay(6, true);
        void editor.settled().then(() => {
            settled = true;
        });
        await server.answer();
        expect(settled).toBe(false);
        await server.answer();

        expect(settled).toBe(true);
        await expect(editor.settled()).resolves.toBeUndefined();
    });

    it('dit quand les réglages ne se lisent pas', async () => {
        const server = new FakeServer();
        server.read = () => Promise.reject(new Error('réseau'));
        const editor = new SettingsEditor(server);

        await editor.load();

        expect(editor.current()).toEqual({ settings: null, unread: true, errors: {} });
    });

    it('finit toujours comme le serveur, quels que soient les gestes, les pannes et les refus', async () => {
        const gesture = fc.oneof(
            fc.record({
                kind: fc.constant('objective' as const),
                minutes: fc.integer({ min: 0, max: 52 }).map((q) => q * 15),
            }),
            fc.record({ kind: fc.constant('day' as const), day: fc.integer({ min: 1, max: 7 }), worked: fc.boolean() }),
            fc.record({
                kind: fc.constant('tint' as const),
                type: fc.constantFrom(STORY, BUG),
                color: fc.constantFrom(...TINTS),
            }),
        );
        const step = fc.record({
            gesture,
            outcome: fc.constantFrom<FakeServer['next']>('accept', 'accept', 'accept', 'refuse', 'fail'),
            answers: fc.integer({ min: 0, max: 2 }),
        });

        await fc.assert(
            fc.asyncProperty(fc.array(step, { maxLength: 30 }), async (steps) => {
                const { editor, server } = await loaded();
                for (const { gesture: g, outcome, answers } of steps) {
                    server.next = outcome;
                    if (g.kind === 'objective') {
                        editor.setHabitualObjective(g.minutes);
                    } else if (g.kind === 'day') {
                        editor.setWorkingDay(g.day, g.worked);
                    } else {
                        editor.recolor(g.type, g.color);
                    }
                    for (let i = 0; i < answers; i++) {
                        await server.answer();
                    }
                }
                while (server.waiting > 0) {
                    await server.answer();
                }
                await editor.settled();

                expect(editor.current().settings).toEqual(server.settings);
            }),
        );
    });
});
