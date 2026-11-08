import { describe, expect, it } from 'vitest';

import { TICKET_SHAPE_REFUSAL } from '../../../assets/day/messages';
import { type SaveSteps, shapeRefusal, ticketError, TicketSave } from '../../../assets/day/ticketSave';
import { TICKET_NOT_FOUND } from '../../../assets/jira/lookupMessages';
import { NO_CHECK, type TicketCheck } from '../../../assets/jira/useTicketLookup';

/** Une promesse qu'on tient quand on veut. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });

    return { promise, resolve };
}

/** Ce qu'un enregistrement a fait, étape par étape, et ce qu'il écrit. */
function recorder(overrides: Partial<SaveSteps<string>> = {}) {
    const steps: string[] = [];
    const written = deferred<string>();
    const recorded: SaveSteps<string> = {
        check: NO_CHECK,
        sending: false,
        refuse: (message, answered) => {
            steps.push(`refuse ${message}${answered ? ' (Jira a répondu)' : ''}`);
        },
        start: () => {
            steps.push('start');

            return () => {
                steps.push('write');

                return written.promise;
            };
        },
        settle: (result) => {
            steps.push(`settle ${result}`);

            return result === 'saved';
        },
        ...overrides,
    };

    return { steps, written, recorded };
}

/** Jira cherche encore : sa réponse arrive quand on la donne. */
function searching(): { check: TicketCheck; answer: (exists: boolean) => void } {
    const answer = deferred<boolean>();

    return { check: { refused: false, known: () => answer.promise }, answer: answer.resolve };
}

describe('la forme du ticket, jugée en quittant le champ', () => {
    it('refuse ce qui n’a pas la forme d’un ticket, et laisse un champ vide sans rien dire', () => {
        expect(shapeRefusal('SHOP')).toBe(TICKET_SHAPE_REFUSAL);
        expect(shapeRefusal('SHOP_482')).toBe(TICKET_SHAPE_REFUSAL);
        expect(shapeRefusal('SHOP-0')).toBe(TICKET_SHAPE_REFUSAL);
        expect(shapeRefusal('')).toBeNull();
        expect(shapeRefusal('  ')).toBeNull();
        expect(shapeRefusal('SHOP-482')).toBeNull();
        expect(shapeRefusal('shop-482')).toBeNull();
    });
});

describe('ce que le champ dit sous lui', () => {
    it('dit le refus d’un enregistrement d’abord, puis un ticket que Jira ne connaît pas', () => {
        const unknown: TicketCheck = { refused: true, known: () => undefined };
        expect(ticketError('Indiquez un ticket.', unknown)).toBe('Indiquez un ticket.');
        expect(ticketError(null, unknown)).toBe(TICKET_NOT_FOUND);
        expect(ticketError(null, NO_CHECK)).toBeNull();
    });
});

describe('l’enregistrement d’un champ Ticket', () => {
    it('écrit, puis dit si c’est fini', async () => {
        const save = new TicketSave();
        const { steps, written, recorded } = recorder();
        const done = save.run(recorded);
        expect(save.current).toBe(done);
        await Promise.resolve();
        written.resolve('saved');

        expect(await done).toBe(true);
        expect(steps).toEqual(['start', 'write', 'settle saved']);
        expect(save.current).toBeNull();
    });

    it('n’en lance pas un second tant que le premier est en route : Entrée répétée, clic à côté', async () => {
        const save = new TicketSave();
        const first = recorder();
        const second = recorder();
        const done = save.run(first.recorded);

        expect(save.run(second.recorded)).toBe(done);
        expect(second.steps).toEqual([]);
        first.written.resolve('refused');
        expect(await done).toBe(false);
        // Fini, un autre peut partir.
        void save.run(second.recorded);
        expect(second.steps).toEqual(['start']);
    });

    it('ne part pas, d’aucun geste, sur un ticket que Jira ne connaît pas', async () => {
        const save = new TicketSave();
        const { steps, recorded } = recorder({ check: { refused: true, known: () => undefined } });

        expect(await save.run(recorded)).toBe(false);
        expect(steps).toEqual([`refuse ${TICKET_NOT_FOUND}`]);
        expect(save.current).toBeNull();
    });

    it('ne part pas sur un refus connu d’avance, qui passe devant Jira', async () => {
        const save = new TicketSave();
        const { steps, recorded } = recorder({
            check: { refused: true, known: () => undefined },
            refusal: TICKET_SHAPE_REFUSAL,
        });

        expect(await save.run(recorded)).toBe(false);
        expect(steps).toEqual([`refuse ${TICKET_SHAPE_REFUSAL}`]);
    });

    it('attend la réponse de Jira, l’écran en route, et écrit une fois le ticket trouvé', async () => {
        const save = new TicketSave();
        const jira = searching();
        const { steps, written, recorded } = recorder({ check: jira.check });
        const done = save.run(recorded);
        await Promise.resolve();
        expect(steps).toEqual(['start']);

        jira.answer(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(steps).toEqual(['start', 'write']);
        written.resolve('saved');
        expect(await done).toBe(true);
    });

    it('n’écrit rien sur un ticket que Jira dit introuvable, et le dit, l’écran n’étant plus en route', async () => {
        const save = new TicketSave();
        const jira = searching();
        const { steps, recorded } = recorder({ check: jira.check });
        const done = save.run(recorded);

        jira.answer(false);
        expect(await done).toBe(false);
        expect(steps).toEqual(['start', `refuse ${TICKET_NOT_FOUND} (Jira a répondu)`]);
        expect(save.current).toBeNull();
    });

    it('sans ticket à vérifier — un nom, une pause —, n’attend pas Jira', async () => {
        const save = new TicketSave();
        const { steps, written, recorded } = recorder({ check: null });
        const done = save.run(recorded);
        await Promise.resolve();
        expect(steps).toEqual(['start', 'write']);
        written.resolve('saved');
        expect(await done).toBe(true);
    });

    it('l’écran montre encore l’envoi, la réponse arrivée : c’est elle qui vaut, et rien ne repart', async () => {
        const save = new TicketSave();
        const first = recorder();
        const done = save.run(first.recorded);
        first.written.resolve('saved');
        expect(await done).toBe(true);

        const late = recorder({ sending: true, check: { refused: true, known: () => undefined } });
        expect(await save.run(late.recorded)).toBe(true);
        expect(late.steps).toEqual([]);

        const refused = recorder();
        const again = save.run(refused.recorded);
        refused.written.resolve('refused');
        expect(await again).toBe(false);
        const stale = recorder({ sending: true });
        expect(await save.run(stale.recorded)).toBe(false);
        expect(stale.steps).toEqual([]);
    });

    it('après un ticket que Jira dit introuvable, un geste qui voit encore l’envoi sait la fenêtre ouverte', async () => {
        const save = new TicketSave();
        const saved = recorder();
        const first = save.run(saved.recorded);
        saved.written.resolve('saved');
        expect(await first).toBe(true);

        const jira = searching();
        const unknown = recorder({ check: jira.check });
        const refused = save.run(unknown.recorded);
        jira.answer(false);
        expect(await refused).toBe(false);

        const late = recorder({ sending: true });
        expect(await save.run(late.recorded)).toBe(false);
        expect(late.steps).toEqual([]);
    });

    it('rien à écrire : la réponse tout de suite, sans attendre Jira ni rien écrire', async () => {
        const save = new TicketSave();
        const jira = searching();
        const { steps, recorded } = recorder({
            check: jira.check,
            start: () => {
                steps.push('start');

                return true;
            },
        });

        expect(await save.run(recorded)).toBe(true);
        expect(steps).toEqual(['start']);
        expect(save.current).toBeNull();
    });
});
