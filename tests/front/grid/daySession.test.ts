import { describe, expect, it } from 'vitest';

import { fill } from '../../../assets/grid/changes';
import { type DayApi, DaySession, type TabMemory, tabMemory } from '../../../assets/grid/daySession';
import { DaySessions } from '../../../assets/grid/daySessions';
import { PAUSE, work } from '../../../assets/grid/grid';
import { LIMIT } from '../../../assets/grid/history';
import * as Quarter from '../../../assets/grid/quarter';
import { extendTo, selectQuarter } from '../../../assets/grid/selection';
import { FakeDayServer, type Request, type Transport } from './fakeDayServer';
import { memoryStorage, minutes, rangesOf, weeklyRule } from './support';

const TODAY = '2026-10-06';
const TOMORROW = '2026-10-07';
const nine = minutes('09:00');
const quarterPast = minutes('09:15');

function open(
    server: FakeDayServer,
    api: DayApi = server.api(),
    memory: TabMemory = tabMemory(memoryStorage()),
    date = TODAY,
) {
    return new DaySession(server.read(date), api, memory);
}

/** Des réponses retenues jusqu'à ce que le test les relâche : la requête, elle, arrive aussitôt. */
function held(): { transport: Transport; sent: () => Promise<void>; release: () => void } {
    const waiting: (() => void)[] = [];

    return {
        transport: (_, handle) => {
            const result = handle();

            return new Promise((resolve) =>
                waiting.push(() => {
                    resolve(result);
                }),
            );
        },
        // La file ne part qu'au tour suivant : on attend que la requête soit en route.
        sent: async () => {
            while (waiting.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        },
        release: () => {
            waiting.splice(0).forEach((resolve) => {
                resolve();
            });
        },
    };
}

/** Une panne sur les écritures : avant le serveur, ou après, la réponse perdue. */
function broken(when: 'before' | 'after', reads: 'work' | 'fail' = 'work'): Transport {
    return <T>(request: Request, handle: () => T): Promise<T> => {
        if (request.kind === 'read') {
            return reads === 'work' ? Promise.resolve(handle()) : Promise.reject(new TypeError('Failed to fetch'));
        }
        if (when === 'after') {
            handle();
        }

        return Promise.reject(new TypeError('Failed to fetch'));
    };
}

describe('DaySession', () => {
    it('n’envoie que ce qui change, et n’affiche que ce que le serveur a enregistré', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await expect(session.apply(fill([nine, quarterPast], work('shop-482')))).resolves.toMatchObject({
            kind: 'saved',
        });
        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:30', 'work', 'SHOP-482', null]]);
        expect(session.current().day.version).toBe(1);
        expect(session.current().canUndo).toBe(true);

        await session.apply(fill([nine, quarterPast, minutes('09:30')], work('SHOP-482')));
        expect(server.writes).toHaveLength(2);
    });

    it('n’écrit rien en ouvrant une journée, ni pour un geste qui ne change rien', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await expect(session.apply(fill([nine], null))).resolves.toEqual({ kind: 'unchanged' });
        expect(server.writes).toHaveLength(0);
        expect(session.current().canUndo).toBe(false);
    });

    it('dit ce que le geste a changé, tel que le serveur l’a enregistré', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.apply(fill([nine, quarterPast], work('SHOP-482')));

        await expect(session.apply(fill([quarterPast, minutes('09:30')], PAUSE))).resolves.toEqual({
            kind: 'saved',
            step: {
                quarters: [quarterPast, minutes('09:30')],
                before: [work('SHOP-482'), null],
                after: [PAUSE, PAUSE],
            },
        });
        await expect(session.undo()).resolves.toEqual({
            kind: 'saved',
            step: {
                quarters: [quarterPast, minutes('09:30')],
                before: [PAUSE, PAUSE],
                after: [work('SHOP-482'), null],
            },
        });
        await expect(session.setObjective(480)).resolves.toEqual({ kind: 'saved', step: null });
    });

    it('sait si le presse-papier de l’onglet tient quelque chose', async () => {
        const session = open(new FakeDayServer());
        expect(session.hasClipboard()).toBe(false);

        await session.copyContent(work('OPS-7'));
        expect(session.hasClipboard()).toBe(true);
    });

    it('n’enregistre qu’une fois un geste envoyé deux fois', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        const gesture = fill([nine], work('SHOP-482'));

        await expect(Promise.all([session.apply(gesture), session.apply(gesture)])).resolves.toMatchObject([
            { kind: 'saved' },
            { kind: 'unchanged' },
        ]);
        expect(server.writes).toHaveLength(1);
    });

    it('se remet sur la journée à jour quand un autre onglet l’a changée, sans rien écrire', async () => {
        const server = new FakeDayServer();
        const late = open(server);
        const other = open(server);
        await other.apply(fill([nine], work('OPS-7')));

        const refused = late.apply(fill([quarterPast], PAUSE));
        const behind = late.apply(fill([minutes('10:00')], PAUSE));

        await expect(refused).resolves.toEqual({ kind: 'stale' });
        await expect(behind).resolves.toEqual({ kind: 'abandoned' });
        expect(rangesOf(late.current().day.grid)).toEqual([['09:00', '09:15', 'work', 'OPS-7', null]]);
        expect(server.writes).toHaveLength(1);

        await expect(late.apply(fill([quarterPast], PAUSE))).resolves.toMatchObject({ kind: 'saved' });
    });

    it('rend les refus champ par champ, et abandonne ce qui attendait derrière', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        const refused = session.apply(fill([nine], work('pas un ticket')));
        const behind = session.apply(fill([quarterPast], PAUSE));

        await expect(refused).resolves.toEqual({
            kind: 'invalid',
            violations: [{ field: 'changes[0].ticket', message: 'Ticket invalide.' }],
        });
        await expect(behind).resolves.toEqual({ kind: 'abandoned' });
        expect(server.writes).toHaveLength(0);
    });

    it('relit la journée quand l’écriture n’arrive pas au serveur', async () => {
        const server = new FakeDayServer();
        const session = open(server, server.api(broken('before')));

        await expect(session.apply(fill([nine], PAUSE))).resolves.toEqual({ kind: 'failed' });
        expect(server.writes).toHaveLength(0);
        expect(session.current().day.grid.at(nine)).toBeNull();
        expect(session.current().canUndo).toBe(false);
    });

    it('montre ce que la base contient quand seule la réponse s’est perdue, et oublie l’historique', async () => {
        const server = new FakeDayServer();
        const memory = tabMemory(memoryStorage());
        const session = open(server, server.api(), memory);
        await session.apply(fill([quarterPast], PAUSE));
        const lost = open(server, server.api(broken('after')), memory);

        // L'écriture est passée, mais rien ne dit qu'elle est la sienne : un autre onglet
        // a pu écrire la même chose au même instant. Annuler pourrait défaire la sienne.
        await expect(lost.apply(fill([nine], work('SHOP-482')))).resolves.toEqual({ kind: 'failed' });
        expect(lost.current().day.grid.at(nine)).toEqual(work('SHOP-482'));
        expect(lost.current().canUndo).toBe(false);
        await expect(lost.undo()).resolves.toEqual({ kind: 'nothing' });
    });

    it('garde l’historique quand la journée relue montre que rien n’est passé', async () => {
        const server = new FakeDayServer();
        const memory = tabMemory(memoryStorage());
        await open(server, server.api(), memory).apply(fill([quarterPast], PAUSE));
        const session = open(server, server.api(broken('before')), memory);

        await expect(session.apply(fill([nine], PAUSE))).resolves.toEqual({ kind: 'failed' });
        expect(session.current().canUndo).toBe(true);
    });

    it('garde la journée d’avant quand rien ne répond, et oublie l’historique', async () => {
        const server = new FakeDayServer();
        const memory = tabMemory(memoryStorage());
        await open(server, server.api(), memory).apply(fill([quarterPast], PAUSE));
        const session = open(server, server.api(broken('after', 'fail')), memory);

        await expect(session.apply(fill([nine], PAUSE))).resolves.toEqual({ kind: 'failed' });
        expect(session.current().day.version).toBe(1);
        expect(session.current().canUndo).toBe(false);
    });

    it('annule et rétablit ce que le serveur a enregistré', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.apply(fill([nine], work('shop-482', 'Tests')));

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.read(TODAY).grid.at(nine)).toBeNull();
        expect(session.current()).toMatchObject({ canUndo: false, canRedo: true });

        await expect(session.redo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.read(TODAY).grid.at(nine)).toEqual(work('SHOP-482', 'Tests'));
        expect(session.current()).toMatchObject({ canUndo: true, canRedo: false });

        await expect(session.redo()).resolves.toEqual({ kind: 'nothing' });
    });

    it('n’annule jamais ce qu’un autre onglet a écrit sur les mêmes créneaux', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.apply(fill([nine, quarterPast], work('SHOP-482')));
        await open(server).apply(fill([quarterPast], work('OPS-7')));

        await expect(session.undo()).resolves.toEqual({ kind: 'stale' });
        await expect(session.undo()).resolves.toEqual({ kind: 'conflict' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([
            ['09:00', '09:15', 'work', 'SHOP-482', null],
            ['09:15', '09:30', 'work', 'OPS-7', null],
        ]);
        expect(session.current()).toMatchObject({ canUndo: false, canRedo: false });
    });

    it('annule ce qui n’a pas bougé ailleurs, une fois la journée à jour', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.apply(fill([nine], work('SHOP-482')));
        await open(server).apply(fill([minutes('14:00')], work('OPS-7')));

        await expect(session.undo()).resolves.toEqual({ kind: 'stale' });
        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['14:00', '14:15', 'work', 'OPS-7', null]]);
    });

    it('n’atteint plus l’écran une fois fermée, finit ce qui était en file et abandonne le reste', async () => {
        const server = new FakeDayServer();
        const { transport, sent, release } = held();
        const session = open(server, server.api(transport));
        let notified = 0;
        session.subscribe(() => {
            notified += 1;
        });

        const outcome = session.apply(fill([nine], PAUSE));
        const queued = session.apply(fill([quarterPast], PAUSE));
        await sent();
        const before = notified;
        session.close();
        await expect(session.apply(fill([minutes('10:00')], PAUSE))).resolves.toEqual({ kind: 'abandoned' });
        await expect(session.copy(selectQuarter(nine))).resolves.toBeNull();
        release();
        await sent();
        release();

        await expect(outcome).resolves.toMatchObject({ kind: 'saved' });
        await expect(queued).resolves.toMatchObject({ kind: 'saved' });
        expect(notified).toBe(before);
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:30', 'pause', null, null]]);
    });

    it('ne montre pas la journée d’avant un geste encore en route quand on revient dessus', async () => {
        const server = new FakeDayServer();
        const memory = tabMemory(memoryStorage());
        const { transport, sent, release } = held();
        const sessions = new DaySessions(server.api(transport), memory);
        const reading = sessions.open(TODAY);
        await sent();
        release();
        const today = await reading;
        if (today === null) {
            throw new Error('Le jour ne s’est pas ouvert.');
        }

        const pasted = today.apply(fill([nine, quarterPast], work('SHOP-482')));
        await sent();
        void sessions.open(TOMORROW);
        const back = sessions.open(TODAY);
        release();
        await expect(pasted).resolves.toMatchObject({ kind: 'saved' });
        await sent();
        release();
        const reopened = await back;

        expect(reopened?.current().day.version).toBe(1);
        expect(reopened?.current().day.grid.workedMinutes()).toBe(30);
        expect(reopened?.current().canUndo).toBe(true);
        const undo = reopened?.undo();
        await sent();
        release();
        await expect(undo).resolves.toMatchObject({ kind: 'saved' });
    });

    it('n’applique pas à la journée affichée la réponse d’un jour à venir quitté pendant un geste sur sa fois prévue', async () => {
        // Lundi, le Daily naît, chaque jour ouvré : mardi et mercredi le prévoient, sans l'écrire.
        const monday = '2026-10-05';
        const server = new FakeDayServer(monday);
        server.saveRecurrence(
            monday,
            0,
            [{ start: '09:00', end: '09:30', kind: 'work', ticket: 'OPS-12', comment: 'Daily' }],
            weeklyRule([1, 2, 3, 4, 5]),
            null,
        );
        const id = server.allRecurrences()[0]?.id ?? '';
        const planned = [['09:00', '09:30', 'work', 'OPS-12', 'Daily', id]];
        const { transport, sent, release } = held();
        const sessions = new DaySessions(server.api(transport), tabMemory(memoryStorage()));
        const opening = sessions.open(TODAY);
        await sent();
        release();
        const today = await opening;
        if (today === null) {
            throw new Error('Le jour ne s’est pas ouvert.');
        }
        expect(rangesOf(today.current().day.grid)).toEqual(planned);
        let notified = 0;
        today.subscribe(() => {
            notified += 1;
        });

        const cleared = today.apply(fill([quarterPast], null));
        await sent();
        const before = notified;
        const opened = sessions.open(TOMORROW);
        // La réponse du mardi arrive une fois le mercredi demandé.
        release();
        await expect(cleared).resolves.toMatchObject({ kind: 'saved' });
        await sent();
        release();
        const tomorrow = await opened;

        expect(notified).toBe(before);
        expect(tomorrow?.date).toBe(TOMORROW);
        expect(rangesOf(tomorrow?.current().day.grid ?? today.current().day.grid)).toEqual(planned);
        expect(tomorrow?.current().day.version).toBe(server.read(TOMORROW).version);
        expect(tomorrow?.current().canUndo).toBe(false);
        // Le geste n'a touché que le mardi : sa fois s'y est posée détachée, celle du mercredi reste prévue.
        expect(rangesOf(server.saved(TODAY).grid)).toEqual([['09:00', '09:15', 'work', 'OPS-12', 'Daily']]);
        expect(server.isSkipped(id, TODAY)).toBe(true);
        expect(rangesOf(server.saved(TOMORROW).grid)).toEqual([]);
        expect(server.isSkipped(id, TOMORROW)).toBe(false);

        // Un geste sur le mercredi part de sa propre journée : il n'est pas refusé.
        const paused = tomorrow?.apply(fill([minutes('10:00')], PAUSE));
        await sent();
        release();
        await expect(paused).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TOMORROW).grid)).toEqual([...planned, ['10:00', '10:15', 'pause', null, null]]);
    });

    it('n’ouvre que la dernière journée demandée', async () => {
        const server = new FakeDayServer();
        const sessions = new DaySessions(server.api(), tabMemory(memoryStorage()));

        const first = sessions.open(TODAY);
        const last = sessions.open(TOMORROW);

        await expect(first).resolves.toBeNull();
        expect((await last)?.date).toBe(TOMORROW);
    });

    it('oublie l’historique d’un jour rechargé pendant qu’une de ses écritures partait', async () => {
        const server = new FakeDayServer();
        const storage = memoryStorage();
        const memory = tabMemory(storage);
        await open(server, server.api(), memory).apply(fill([nine], work('SHOP-482')));
        const { transport, sent } = held();
        void open(server, server.api(transport), memory).apply(fill([minutes('14:00')], work('OPS-7')));
        await sent();

        // La page se recharge : la réponse est perdue, l'écriture, elle, est passée.
        const reloaded = open(server, server.api(), tabMemory(storage));

        expect(reloaded.current().canUndo).toBe(false);
        await expect(reloaded.undo()).resolves.toEqual({ kind: 'nothing' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([
            ['09:00', '09:15', 'work', 'SHOP-482', null],
            ['14:00', '14:15', 'work', 'OPS-7', null],
        ]);
    });

    it('garde l’historique d’un jour rechargé sans rien en route', async () => {
        const server = new FakeDayServer();
        const storage = memoryStorage();
        await open(server, server.api(), tabMemory(storage)).apply(fill([nine], PAUSE));

        expect(open(server, server.api(), tabMemory(storage)).current().canUndo).toBe(true);
    });

    it('annule le dernier geste même quand le stockage de l’onglet est plein', async () => {
        const server = new FakeDayServer();
        const storage = memoryStorage();
        const session = open(server, server.api(), tabMemory(storage));
        await session.apply(fill([nine], work('SHOP-1')));
        // Le premier geste tient tout juste : le second ne trouve plus de place.
        storage.quota = storage.used() + 20;
        await session.apply(fill([minutes('14:00')], work('OPS-2')));
        expect(storage.used()).toBeLessThanOrEqual(storage.quota);

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:15', 'work', 'SHOP-1', null]]);

        // Ce que le stockage n'a pas pu garder, un rechargement ne le retrouve pas en retard :
        // il ne peut plus rien annuler, plutôt que d'annuler à côté.
        storage.quota = Number.POSITIVE_INFINITY;
        await session.apply(fill([minutes('15:00')], work('OPS-3')));
        storage.quota = storage.used();
        await session.apply(fill([minutes('16:00')], work('OPS-4')));
        const reloaded = open(server, server.api(), tabMemory(storage));
        await expect(reloaded.undo()).resolves.toEqual({ kind: 'nothing' });
    });

    it('fait de la place dans un stockage plein avec l’historique des autres journées', async () => {
        const server = new FakeDayServer();
        const storage = memoryStorage();
        const memory = tabMemory(storage);
        await open(server, server.api(), memory, TOMORROW).apply(fill([nine], work('OPS-7', 'Revue du code')));
        storage.quota = storage.used() + 20;
        await open(server, server.api(), memory).apply(fill([nine], work('SHOP-482', 'Tests du mapping')));

        // Après un rechargement, la journée qu'on vient de saisir s'annule encore ; celle
        // qu'on a quittée a laissé sa place.
        expect(open(server, server.api(), tabMemory(storage)).current().canUndo).toBe(true);
        expect(open(server, server.api(), tabMemory(storage), TOMORROW).current().canUndo).toBe(false);
        // L'onglet, lui, n'a rien oublié.
        expect(open(server, server.api(), memory, TOMORROW).current().canUndo).toBe(true);
    });

    it('coupe et copie ce que le geste d’avant vient d’enregistrer', async () => {
        const server = new FakeDayServer();
        const memory = tabMemory(memoryStorage());
        const { transport, sent, release } = held();
        const session = open(server, server.api(transport), memory);

        const posed = session.apply(fill([nine], work('SHOP-1')));
        const cut = session.cut(selectQuarter(nine));
        await sent();
        release();
        await sent();
        release();

        await expect(posed).resolves.toMatchObject({ kind: 'saved' });
        await expect(cut).resolves.toMatchObject({ kind: 'saved' });
        expect(memory.clipboard.read()).toEqual({ cells: [{ offset: 0, content: work('SHOP-1') }] });
        expect(server.read(TODAY).grid.at(nine)).toBeNull();
    });

    it('colle à son tour dans la file, et dit ce qu’il a collé', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.apply(fill([nine, quarterPast], work('SHOP-482')));
        void session.copy(extendTo(selectQuarter(nine), quarterPast));

        await expect(session.paste(selectQuarter(minutes('14:00')))).resolves.toMatchObject({
            outcome: { kind: 'saved' },
            pasted: [minutes('14:00'), minutes('14:15')],
        });
        await expect(session.paste(selectQuarter(Quarter.LAST))).resolves.toEqual({
            outcome: { kind: 'overflow' },
            pasted: [],
        });
        expect(server.writes).toHaveLength(2);
    });

    it('ne colle rien sans presse-papier, et colle un favori sur toute la sélection', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await expect(session.paste(selectQuarter(nine))).resolves.toEqual({ outcome: { kind: 'nothing' }, pasted: [] });
        void session.copyContent(work('OPS-7'));
        await expect(session.paste(extendTo(selectQuarter(nine), quarterPast))).resolves.toMatchObject({
            outcome: { kind: 'saved' },
        });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:30', 'work', 'OPS-7', null]]);
    });

    it('garde un historique par journée, qui survit à un rechargement', async () => {
        const server = new FakeDayServer();
        const memory = tabMemory(memoryStorage());
        await open(server, server.api(), memory).apply(fill([nine], PAUSE));
        await open(server, server.api(), memory, TOMORROW).apply(fill([nine], work('OPS-7')));

        await expect(open(server, server.api(), memory, TOMORROW).undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(server.read(TOMORROW).grid.at(nine)).toBeNull();
        expect(server.read(TODAY).grid.at(nine)).toEqual(PAUSE);
        expect(open(server, server.api(), memory).current().canUndo).toBe(true);
    });

    it('annule jusqu’à 50 gestes, pas un de plus', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        for (let index = 0; index < LIMIT + 3; index += 1) {
            await session.apply(fill([nine], work(`SHOP-${String(index + 1)}`)));
        }

        for (let index = 0; index < LIMIT; index += 1) {
            await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        }
        await expect(session.undo()).resolves.toEqual({ kind: 'nothing' });
        expect(server.read(TODAY).grid.at(nine)).toEqual(work('SHOP-3'));
    });

    it('change l’objectif sans l’inscrire dans l’historique', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        await expect(session.setObjective(480)).resolves.toMatchObject({ kind: 'saved' });
        await expect(session.setObjective(480)).resolves.toEqual({ kind: 'unchanged' });
        await expect(session.setObjective(7)).resolves.toMatchObject({ kind: 'invalid' });
        expect(session.current().day.objective).toBe(480);
        expect(session.current().canUndo).toBe(false);
    });

    it('refuse une journée rendue pour un autre jour', async () => {
        const server = new FakeDayServer();
        const api = server.api();
        const session = open(server, {
            ...api,
            changeSlots: async (_, version, changes) => api.changeSlots(TOMORROW, version, changes),
            read: async () => api.read(TOMORROW),
        });

        await expect(session.apply(fill([nine], PAUSE))).resolves.toEqual({ kind: 'failed' });
        expect(session.current().day.date).toBe(TODAY);
        expect(session.current().day.grid.at(nine)).toBeNull();
    });

    it('dit qu’un geste attend sa réponse, et garde le même état tant que rien ne change', async () => {
        const server = new FakeDayServer();
        const { transport, sent, release } = held();
        const session = open(server, server.api(transport));
        expect(session.current()).toBe(session.current());

        const outcome = session.apply(fill([nine], PAUSE));
        expect(session.current().busy).toBe(true);
        await sent();
        expect(session.current().busy).toBe(true);
        release();
        await outcome;

        expect(session.current().busy).toBe(false);
    });

    it('refuse aussitôt un quart d’heure hors de la grille, sans bloquer les gestes suivants', async () => {
        const server = new FakeDayServer();
        const session = open(server);

        expect(() => session.apply(new Map([[Quarter.DAY_END, PAUSE]]))).toThrow(RangeError);
        await expect(session.apply(fill([nine], PAUSE))).resolves.toMatchObject({ kind: 'saved' });
    });
});

describe('DaySession, la journée relue au retour sur la page', () => {
    it('se relit à son tour dans la file, derrière les gestes déjà partis, et garde l’historique', async () => {
        const server = new FakeDayServer();
        const { transport, sent, release } = held();
        const session = open(server, server.api(transport));

        const gesture = session.apply(fill([nine], work('SHOP-482')));
        const refreshed = session.refresh();
        await sent();
        release();
        await expect(gesture).resolves.toMatchObject({ kind: 'saved' });
        await sent();
        release();
        await refreshed;

        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:15', 'work', 'SHOP-482', null]]);
        expect(session.current()).toMatchObject({ canUndo: true, busy: false });
        const undone = session.undo();
        await sent();
        release();
        await expect(undone).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([]);
    });

    it('refuse, comme le serveur, un geste fait avant une relecture qui trouve la journée changée ailleurs', async () => {
        const server = new FakeDayServer();
        const { transport, sent, release } = held();
        const session = open(server, server.api(transport));
        await open(server).apply(fill([nine], work('OPS-7')));

        // De retour sur la page, la relecture part ; deux gestes faits sur ce qu'on voyait la suivent.
        const refreshed = session.refresh();
        await sent();
        const refused = session.apply(fill([nine, quarterPast], PAUSE));
        const behind = session.apply(fill([minutes('10:00')], PAUSE));
        release();
        await refreshed;

        await expect(refused).resolves.toEqual({ kind: 'stale' });
        await expect(behind).resolves.toEqual({ kind: 'abandoned' });
        expect(server.writes).toHaveLength(1);
        expect(rangesOf(session.current().day.grid)).toEqual([['09:00', '09:15', 'work', 'OPS-7', null]]);

        // Fait sur la journée relue, le geste suivant part.
        const next = session.apply(fill([quarterPast], PAUSE));
        await sent();
        release();
        await expect(next).resolves.toMatchObject({ kind: 'saved' });
    });

    it('laisse partir un geste fait avant une relecture qui ne trouve rien de changé', async () => {
        const server = new FakeDayServer();
        const { transport, sent, release } = held();
        const session = open(server, server.api(transport));

        const refreshed = session.refresh();
        await sent();
        const gesture = session.apply(fill([nine], PAUSE));
        release();
        await refreshed;
        await sent();
        release();

        await expect(gesture).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:15', 'pause', null, null]]);
    });

    it('refuse un geste décidé avant la relecture qui n’entre dans la file qu’après elle', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        // Une fenêtre enregistrée attend Jira : ce qu'elle écrit est décidé maintenant.
        const seen = session.seen();
        await open(server).apply(fill([nine], work('OPS-7')));
        await session.refresh();

        await expect(session.apply(fill([nine], work('SHOP-482')), seen)).resolves.toEqual({ kind: 'stale' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([['09:00', '09:15', 'work', 'OPS-7', null]]);
        await expect(session.apply(fill([nine], work('SHOP-482')))).resolves.toMatchObject({ kind: 'saved' });
    });

    it('refuse l’envoi, l’objectif, l’annulation, la coupe et le collage décidés avant une relecture qui a tout changé', async () => {
        const server = new FakeDayServer();
        const { transport, sent, release } = held();
        const session = open(server, server.api(transport));
        const saved = session.apply(fill([nine], work('SHOP-482')));
        await sent();
        release();
        await saved;
        const copied = session.copy(extendTo(selectQuarter(nine), quarterPast));
        await copied;
        await open(server).apply(fill([minutes('14:00')], work('OPS-7')));

        const refreshed = session.refresh();
        await sent();
        const gestures = [
            session.sendToJira(),
            session.setObjective(240),
            session.undo(),
            session.cut(selectQuarter(nine)),
            session.paste(selectQuarter(minutes('16:00'))),
        ];
        release();
        await refreshed;

        await expect(Promise.all(gestures)).resolves.toEqual([
            { kind: 'stale' },
            { kind: 'abandoned' },
            { kind: 'abandoned' },
            { kind: 'abandoned' },
            { outcome: { kind: 'abandoned' }, pasted: [] },
        ]);
        expect(server.writes.map((request) => request.kind)).toEqual(['changeSlots', 'changeSlots']);
        expect(session.current().day.send.state).toBe('unsent');
    });

    // Chaque geste, seul en tête de file derrière la relecture : c'est lui qui est refusé.
    const gestures: [string, (session: DaySession) => Promise<unknown>, unknown][] = [
        ['un geste', (session) => session.apply(fill([quarterPast], PAUSE)), { kind: 'stale' }],
        ['la coupe', (session) => session.cut(selectQuarter(nine)), { kind: 'stale' }],
        [
            'le collage',
            (session) => session.paste(selectQuarter(minutes('16:00'))),
            { outcome: { kind: 'stale' }, pasted: [] },
        ],
        ['l’annulation', (session) => session.undo(), { kind: 'stale' }],
        ['le rétablissement', (session) => session.redo(), { kind: 'stale' }],
        ['l’objectif', (session) => session.setObjective(240), { kind: 'stale' }],
        ['l’envoi', (session) => session.sendToJira(), { kind: 'stale' }],
    ];
    for (const [name, gesture, refused] of gestures) {
        it(`refuse ${name} fait avant une relecture qui a trouvé la journée changée`, async () => {
            const server = new FakeDayServer();
            const { transport, sent, release } = held();
            const session = open(server, server.api(transport));
            const first = session.apply(fill([nine], work('SHOP-482')));
            await sent();
            release();
            await first;
            const undone = session.undo();
            await sent();
            release();
            await undone;
            const redone = session.redo();
            await sent();
            release();
            await redone;
            const undoneAgain = session.undo();
            await sent();
            release();
            await undoneAgain;
            await session.copy(selectQuarter(minutes('10:00')));
            const copied = session.copyContent(work('OPS-9'));
            await copied;
            await open(server).apply(fill([minutes('14:00')], work('OPS-7')));
            const writes = server.writes.length;

            const refreshed = session.refresh();
            await sent();
            const answer = gesture(session);
            release();
            await refreshed;

            await expect(answer).resolves.toEqual(refused);
            expect(server.writes).toHaveLength(writes);
        });
    }

    /** La journée telle que la session la montre : ce qu'une fenêtre d'envoi retient en s'ouvrant. */
    function shown(session: DaySession) {
        return { version: session.current().day.version, seen: session.seen() };
    }

    it('refuse l’envoi confirmé sur la journée que la fenêtre montrait avant une relecture qui l’a changée', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.apply(fill([nine], work('SHOP-482')));
        const opened = shown(session);
        await open(server).apply(fill([minutes('14:00')], work('OPS-7')));
        await session.refresh();

        await expect(session.sendToJira(opened)).resolves.toEqual({ kind: 'stale' });
        expect(server.writes.map((request) => request.kind)).toEqual(['changeSlots', 'changeSlots']);
        expect(session.current().day.send.state).toBe('unsent');
        await expect(session.sendToJira(shown(session))).resolves.toEqual({ kind: 'done' });
    });

    it('envoie la version que la fenêtre montrait : changée depuis, le serveur refuse, même quand le navigateur l’a laissé passer', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.apply(fill([nine], work('SHOP-482')));
        const opened = shown(session);
        await open(server).apply(fill([minutes('14:00')], work('OPS-7')));
        await session.refresh();

        // La relecture comptée comme vue : seul le serveur peut encore refuser (409).
        const sending: Request[] = [];
        const watched = new DaySession(
            session.current().day,
            server.api((request, handle) => {
                sending.push(request);

                return Promise.resolve(handle());
            }),
            tabMemory(memoryStorage()),
        );
        await expect(watched.sendToJira({ version: opened.version, seen: watched.seen() })).resolves.toEqual({
            kind: 'stale',
        });
        expect(sending.filter((request) => request.kind === 'send')).toHaveLength(1);
        expect(server.writes.map((request) => request.kind)).toEqual(['changeSlots', 'changeSlots']);
        expect(watched.current().day.send.state).toBe('unsent');
    });

    it('annule après la relecture ce qui n’a pas bougé ailleurs, et jamais ce qu’un autre onglet a récrit', async () => {
        const server = new FakeDayServer();
        const session = open(server);
        await session.apply(fill([nine], work('SHOP-482')));
        await session.apply(fill([minutes('11:00')], work('SHOP-519')));
        await open(server).apply(fill([minutes('14:00')], work('OPS-7')));
        await session.refresh();

        await expect(session.undo()).resolves.toMatchObject({ kind: 'saved' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([
            ['09:00', '09:15', 'work', 'SHOP-482', null],
            ['14:00', '14:15', 'work', 'OPS-7', null],
        ]);

        await open(server).apply(fill([nine], work('OPS-8')));
        await session.refresh();
        await expect(session.undo()).resolves.toEqual({ kind: 'conflict' });
        expect(rangesOf(server.read(TODAY).grid)).toEqual([
            ['09:00', '09:15', 'work', 'OPS-8', null],
            ['14:00', '14:15', 'work', 'OPS-7', null],
        ]);
    });
});
