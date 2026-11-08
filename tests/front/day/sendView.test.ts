import { describe, expect, it } from 'vitest';

import type { SendOutcome } from '../../../assets/grid/daySession';
import {
    afterSend,
    detailHead,
    failureMessage,
    failureReason,
    fateLabel,
    fateMark,
    fateOf,
    partialSummary,
    recapFates,
    resultHead,
    resultTitle,
    sendButton,
    sendRows,
    SEND_UNANSWERED,
    sendSubtitle,
    STALE_SEND,
    ticketLine,
    VANISHED_LINE,
} from '../../../assets/day/sendView';
import { NOTHING_SENT, readSend, type SendStatus } from '../../../assets/grid/send';

const SENT_AT = { date: '2026-10-06', time: '18:02' };

function status(changes: Partial<SendStatus>): SendStatus {
    return { ...NOTHING_SENT, ...changes };
}

const TICKETS = [
    { ticket: 'SHOP-482', minutes: 90, comments: [] },
    { ticket: 'OPS-12', minutes: 30, comments: [] },
];

describe('le bouton Jira', () => {
    it('dit chacun des huit états', () => {
        expect(sendButton(status({ state: 'nothing' }))).toMatchObject({
            label: 'Envoyer sur Jira',
            variant: 'secondary',
            tooltip: 'Rien à envoyer pour ce jour',
            disabled: true,
            opens: null,
        });
        expect(sendButton(status({ state: 'unsent' }))).toMatchObject({
            label: 'Envoyer sur Jira',
            variant: 'primary',
            name: 'Envoyer sur Jira, journée non envoyée',
            tooltip: 'Journée non envoyée',
            badge: 'unsent',
            opens: 'confirm',
        });
        expect(sendButton(status({ state: 'sending' }))).toMatchObject({
            label: 'Envoi en cours',
            busy: true,
            tooltip: null,
            opens: null,
        });
        expect(sendButton(status({ state: 'sent', sentAt: SENT_AT }))).toMatchObject({
            label: 'Envoyé à 18:02',
            variant: 'secondary',
            icon: 'check',
            tooltip: 'Envoyé le 6 octobre à 18:02. Cliquez pour voir le détail.',
            opens: 'detail',
        });
        expect(sendButton(status({ state: 'modified', sentAt: SENT_AT }))).toMatchObject({
            label: 'Renvoyer sur Jira',
            name: "Renvoyer sur Jira, modifié depuis l'envoi",
            tooltip: "Modifié depuis l'envoi de 18:02",
            badge: 'modified',
            opens: 'confirm',
        });
        expect(
            sendButton(
                status({
                    state: 'partial',
                    outcomes: new Map([
                        ['SHOP-482', null],
                        ['SHOP-519', null],
                        ['OPS-12', null],
                        ['FERME-1', 'closed'],
                    ]),
                }),
            ),
        ).toMatchObject({
            label: "Réessayer l'envoi",
            name: "Réessayer l'envoi, envoi partiel",
            tooltip: 'Envoi partiel. Cliquez pour voir le détail.',
            badge: 'error',
            opens: 'result',
        });
        expect(sendButton(status({ state: 'unverified' }))).toMatchObject({
            label: "Réessayer l'envoi",
            name: "Réessayer l'envoi, envoi non vérifié",
            tooltip: 'Envoi non vérifié. Cliquez pour voir le détail.',
            badge: 'error',
            opens: 'result',
        });
        expect(sendButton(status({ state: 'failed', failure: 'unreachable' }))).toMatchObject({
            label: "Réessayer l'envoi",
            name: "Réessayer l'envoi, échec",
            tooltip: "Échec de l'envoi. Cliquez pour voir le détail.",
            opens: 'result',
        });
    });

    it('écrit « 1er » le premier du mois', () => {
        expect(sendButton(status({ state: 'sent', sentAt: { date: '2026-10-01', time: '09:15' } })).tooltip).toBe(
            'Envoyé le 1er octobre à 09:15. Cliquez pour voir le détail.',
        );
    });
});

describe('les fenêtres du bouton Jira', () => {
    it('confirme les tickets du jour, puis ceux retirés depuis l’envoi, à 0h00', () => {
        expect(sendRows(TICKETS, status({ state: 'modified', removed: ['FERME-1'] }), 'confirm')).toEqual([
            { ticket: 'SHOP-482', minutes: 90 },
            { ticket: 'OPS-12', minutes: 30 },
            { ticket: 'FERME-1', minutes: 0, removed: true },
        ]);
    });

    it('dit ce que chaque ticket est devenu, et un ticket dont l’essai ne dit rien n’est pas arrivé', () => {
        const partial = status({
            state: 'partial',
            outcomes: new Map([
                ['SHOP-482', null],
                ['FERME-1', 'closed'],
            ]),
            removed: ['FERME-1'],
        });

        expect(sendRows(TICKETS, partial, 'result')).toEqual([
            { ticket: 'SHOP-482', minutes: 90, failure: null },
            { ticket: 'OPS-12', minutes: 30, failure: 'mismatch' },
            { ticket: 'FERME-1', minutes: 0, removed: true, failure: 'closed' },
        ]);
    });

    it('nomme le ticket qui manque, même rangé en tête', () => {
        expect(
            partialSummary([
                { ticket: 'ECART-1', minutes: 60, failure: 'mismatch' },
                { ticket: 'SHOP-519', minutes: 30, failure: null },
            ]),
        ).toBe("1 ticket sur 2 est dans Jira. ECART-1 n'a pas été envoyé.");
    });

    it('marque chaque ticket d’un échec comme non envoyé, sans raison à lui', () => {
        const failed = status({ state: 'failed', failure: 'unreachable' });

        expect(sendRows(TICKETS, failed, 'result').map((row) => row.failure)).toEqual(['unreachable', 'unreachable']);
    });

    it('résume un envoi partiel', () => {
        const row = (failure: 'closed' | null) => ({ ticket: 'X', minutes: 15, failure });

        expect(partialSummary([row(null), row(null), row(null), row('closed')])).toBe(
            "3 tickets sur 4 sont dans Jira. X n'a pas été envoyé.",
        );
        expect(partialSummary([row(null), row('closed'), row('closed')])).toBe(
            "1 ticket sur 3 est dans Jira. Les 2 autres n'ont pas été envoyés.",
        );
        expect(partialSummary([row('closed')])).toBe("Le ticket n'a pas été envoyé.");
        expect(partialSummary([row('closed'), row('closed')])).toBe("Aucun des 2 tickets n'a été envoyé.");
    });

    it('ne compte pas un ticket retiré de la journée, et dit ce que Jira en garde', () => {
        const here = { ticket: 'SHOP-482', minutes: 60, failure: null };
        const closed = { ticket: 'FERME-5', minutes: 15, failure: 'closed' as const };
        const gone = { ticket: 'OPS-7', minutes: 0, removed: true, failure: null };

        expect(partialSummary([here, closed, gone])).toBe("1 ticket sur 2 est dans Jira. FERME-5 n'a pas été envoyé.");
        expect(
            partialSummary([here, { ticket: 'OPS-7', minutes: 0, removed: true, failure: 'closed', inJira: 45 }]),
        ).toBe('1 ticket sur 1 est dans Jira. OPS-7, retiré de la journée, a encore 0h45 dans Jira.');
        expect(partialSummary([{ ticket: 'OPS-7', minutes: 0, removed: true, failure: 'closed', inJira: 45 }])).toBe(
            'OPS-7, retiré de la journée, a encore 0h45 dans Jira.',
        );
    });

    it('nomme ce qui n’y est qu’en partie', () => {
        const here = (ticket: string) => ({ ticket, minutes: 60, failure: null });
        const part = (ticket: string) => ({ ticket, minutes: 150, failure: 'closed' as const, inJira: 105 });
        const none = (ticket: string) => ({ ticket, minutes: 30, failure: 'closed' as const });

        expect(partialSummary([here('A-1'), here('A-2'), here('A-3'), part('B-1')])).toBe(
            "3 tickets sur 4 sont dans Jira. B-1 n'y est qu'en partie.",
        );
        expect(partialSummary([here('A-1'), part('B-1'), none('C-1')])).toBe(
            "1 ticket sur 3 est dans Jira. B-1 n'y est qu'en partie, C-1 pas du tout.",
        );
        expect(partialSummary([here('A-1'), part('B-1'), part('B-2')])).toBe(
            "1 ticket sur 3 est dans Jira. Les 2 autres n'y sont pas en entier.",
        );
        expect(partialSummary([part('B-1')])).toBe("Le ticket n'est dans Jira qu'en partie.");
        expect(partialSummary([part('B-1'), none('C-1')])).toBe("Aucun des 2 tickets n'est dans Jira en entier.");
    });

    it('dit sous un ticket ce que Jira en a gardé', () => {
        const line = (failure: 'closed' | 'unreachable' | 'throttled' | 'mismatch', inJira: number, minutes = 150) =>
            ticketLine({ ticket: 'B-1', minutes, failure, inJira }, 'result')?.text;

        expect(line('closed', 105)).toBe('Jira a 1h45 sur 2h30, et refuse le reste.');
        expect(line('unreachable', 105)).toBe("Jira a 1h45 sur 2h30, et n'a pas répondu pour le reste.");
        expect(line('throttled', 105)).toBe("Jira a 1h45 sur 2h30, et demande d'attendre pour le reste.");
        expect(line('mismatch', 105)).toBe('Jira a 1h45 sur 2h30.');
        expect(line('mismatch', 180)).toBe('Jira a 3h00 au lieu de 2h30.');
        expect(line('mismatch', 0)).toBe('Jira a 0h00 sur 2h30.');
        expect(line('closed', 180)).toBe('Jira a 3h00 au lieu de 2h30. Jira refuse les heures de ce ticket fermé.');
        expect(line('mismatch', 150)).toBe("Jira n'a pas les mêmes heures pour ce ticket.");
        expect(line('closed', 150)).toBe('Jira refuse les heures de ce ticket fermé.');
        expect(ticketLine({ ticket: 'B-1', minutes: 60, failure: 'closed' }, 'result')).toEqual({
            text: 'Jira refuse les heures de ce ticket fermé.',
            tone: 'error',
        });
        expect(ticketLine({ ticket: 'B-1', minutes: 60, failure: 'mismatch' }, 'result')?.text).toBe(
            "Jira n'a pas les mêmes heures pour ce ticket.",
        );
        expect(ticketLine({ ticket: 'B-1', minutes: 60, failure: null }, 'result')).toBeNull();
        expect(ticketLine({ ticket: 'B-1', minutes: 60, failure: 'unverified' }, 'result')).toBeNull();
    });

    it('dit ce qu’il advient d’un ticket retiré, sans le dire en rouge quand tout va bien', () => {
        const row = { ticket: 'OPS-7', minutes: 0, removed: true };

        expect(ticketLine(row, 'confirm')).toEqual({ text: 'Ses heures seront retirées de Jira.', tone: 'soft' });
        expect(ticketLine(row, 'detail')).toEqual({ text: 'Retiré de la journée et de Jira.', tone: 'soft' });
        expect(ticketLine({ ...row, failure: null }, 'result')).toEqual({
            text: 'Retiré de la journée et de Jira.',
            tone: 'soft',
        });
        expect(ticketLine({ ...row, failure: 'closed', inJira: 45 }, 'result')).toEqual({
            text: 'Retiré de la journée, Jira en a encore 0h45. Jira refuse les heures de ce ticket fermé.',
            tone: 'error',
        });
        expect(ticketLine({ ticket: 'OPS-8', minutes: 30 }, 'confirm')).toBeNull();
    });

    it('n’affirme jamais que rien n’est parti quand Jira a accepté', () => {
        const row = (ticket: string, failure: 'unverified' | 'closed' | 'unanswered' | null) => ({
            ticket,
            minutes: 60,
            failure,
        });
        const accepted = [
            row('A-1', 'unverified'),
            row('A-2', 'unverified'),
            row('A-3', 'unverified'),
            row('A-4', 'unverified'),
        ];
        const unverified = status({ state: 'unverified' });

        expect(resultTitle(unverified)).toBe('Envoi non vérifié');
        expect(resultHead(accepted, unverified, false)).toEqual({
            text: "Jira a accepté les heures des 4 tickets, puis n'a plus répondu : DayTrack n'a pas pu vérifier qu'elles y sont.",
            muted: "Réessayer l'envoi vérifie ces heures, sans rien envoyer en double.",
        });
        expect(resultHead(accepted, status({ state: 'unverified', failure: 'refused' }), true)).toEqual({
            text: "Jira a accepté les heures des 4 tickets, puis a refusé le jeton enregistré : DayTrack n'a pas pu vérifier qu'elles y sont.",
            muted: "Mettez à jour le jeton, puis réessayez l'envoi : rien ne partira en double.",
        });
        expect(resultHead(accepted, status({ state: 'unverified', failure: 'missing_scope' }), true).text).toBe(
            'Jira a accepté les heures des 4 tickets, mais il manque au jeton enregistré un périmètre pour les relire.',
        );
        expect(
            resultHead(
                [
                    row('A-1', 'unverified'),
                    row('A-2', 'unverified'),
                    row('A-3', 'unverified'),
                    row('SHOP-519', 'closed'),
                ],
                unverified,
                false,
            ).text,
        ).toBe(
            "Jira a accepté les heures de 3 tickets sur 4, puis n'a plus répondu : DayTrack n'a pas pu vérifier qu'elles y sont. SHOP-519 n'a pas été envoyé.",
        );
        expect(resultHead([row('A-1', 'unverified'), row('A-2', null)], unverified, false).text).toBe(
            "1 ticket sur 2 est dans Jira. Jira a accepté les heures de A-1, puis n'a plus répondu : DayTrack n'a pas pu vérifier qu'elles y sont.",
        );
        expect(
            resultHead(
                [row('A-1', 'unverified'), row('A-2', 'unverified'), row('A-3', null), row('B-1', 'closed')],
                unverified,
                false,
            ).text,
        ).toBe(
            "1 ticket sur 4 est dans Jira. Jira a accepté les heures des 2 autres tickets, puis n'a plus répondu : DayTrack n'a pas pu vérifier qu'elles y sont. B-1 n'a pas été envoyé.",
        );
        // Un ticket retiré seul sans relecture : on ne compte pas de ticket, on le nomme.
        const gone = { ticket: 'R-1', minutes: 0, removed: true, failure: 'unverified' as const };
        expect(resultHead([row('B-1', 'closed'), gone], unverified, false).text).toBe(
            "B-1 n'a pas été envoyé. DayTrack n'a pas pu vérifier que Jira a retiré les heures de R-1.",
        );
        expect(resultHead([gone], unverified, false).text).toBe(
            "DayTrack n'a pas pu vérifier que Jira a retiré les heures de R-1.",
        );
        expect(
            resultHead([row('A-1', 'unanswered')], status({ state: 'unverified', failure: 'refused' }), true).text,
        ).toBe(
            "Jira a refusé le jeton enregistré pendant l'envoi des heures du ticket : DayTrack n'a pas pu vérifier qu'elles y sont.",
        );
        expect(resultHead([row('A-1', 'unverified')], unverified, false).text).toBe(
            "Jira a accepté les heures du ticket, puis n'a plus répondu : DayTrack n'a pas pu vérifier qu'elles y sont.",
        );
        // Sans réponse à l'écriture, Jira n'a rien accepté : DayTrack ne le prétend pas.
        expect(resultHead([row('A-1', 'unanswered'), row('A-2', 'unverified')], unverified, false).text).toBe(
            "Jira n'a pas répondu pendant l'envoi des heures des 2 tickets : DayTrack n'a pas pu vérifier qu'elles y sont.",
        );
    });

    it('dit ce qu’il y a à faire maintenant, le jeton remplacé depuis', () => {
        const accepted = [{ ticket: 'A-1', minutes: 60, failure: 'unverified' as const }];
        const refused = status({ state: 'unverified', failure: 'refused' });

        expect(resultHead(accepted, refused, false)).toEqual({
            text: "Jira a accepté les heures du ticket, puis a refusé le jeton enregistré : DayTrack n'a pas pu vérifier qu'elles y sont.",
            muted: "Réessayer l'envoi vérifie ces heures, sans rien envoyer en double.",
        });
    });

    it('ne dit « rien n’a été envoyé » que d’un échec', () => {
        const failed = status({ state: 'failed', failure: 'unreachable' });

        expect(resultTitle(failed)).toBe("Échec de l'envoi");
        const ticket = { ticket: 'A-1', minutes: 60, failure: 'unreachable' as const };
        const gone = { ticket: 'OPS-7', minutes: 0, removed: true, failure: 'unreachable' as const, inJira: 30 };

        expect(resultHead([ticket], failed, false)).toEqual({ text: failureMessage('unreachable'), muted: null });
        expect(resultHead([ticket, gone], failed, false).text).toBe(
            `${failureMessage('unreachable')} OPS-7, retiré de la journée, a encore 0h30 dans Jira.`,
        );
        expect(resultHead([ticket], status({ ...failed, sentAt: SENT_AT }), false).text).toBe(
            `${failureMessage('unreachable')} Jira garde les heures de l'envoi de 18:02.`,
        );
        expect(resultHead([gone], failed, false).text).toBe(
            "L'envoi a échoué. Jira ne répond pas, rien n'a été envoyé. OPS-7, retiré de la journée, a encore 0h30 dans Jira.",
        );
        expect(resultTitle(status({ state: 'partial' }))).toBe('Envoi partiel');
    });

    it('range un ticket selon ce que Jira en sait', () => {
        expect(fateOf(null, undefined)).toBe('sent');
        expect(fateOf('unverified', undefined)).toBe('unverified');
        expect(fateOf('unanswered', undefined)).toBe('unverified');
        expect(fateOf('closed', undefined)).toBe('absent');
        expect(fateOf('mismatch', 0)).toBe('absent');
        expect(fateOf('closed', 105)).toBe('partial');
    });

    it('ne marque le récapitulatif que si les tickets n’ont pas tous eu le même sort', () => {
        const partial = status({
            state: 'partial',
            outcomes: new Map([
                ['SHOP-482', null],
                ['OPS-12', 'closed'],
            ]),
        });

        expect([...(recapFates(TICKETS, partial) ?? [])]).toEqual([
            ['SHOP-482', 'sent'],
            ['OPS-12', 'absent'],
        ]);
        expect(
            recapFates(
                TICKETS,
                status({
                    state: 'unverified',
                    outcomes: new Map([
                        ['SHOP-482', 'unverified'],
                        ['OPS-12', 'unverified'],
                    ]),
                }),
            ),
        ).toBeNull();
        expect(recapFates(TICKETS, status({ state: 'failed', failure: 'unreachable' }))).toBeNull();
        expect(recapFates(TICKETS, status({ state: 'sent' }))).toBeNull();
    });

    it('dit pourquoi, en mots de l’écran', () => {
        expect(failureReason('closed')).toBe('Jira refuse les heures de ce ticket fermé.');
        expect(failureReason('mismatch')).toBe("Jira n'a pas les mêmes heures pour ce ticket.");
        expect(failureMessage('unreachable')).toBe(
            "L'envoi a échoué. Jira ne répond pas, rien n'a été envoyé. Vos saisies restent dans DayTrack.",
        );
        expect(failureMessage('refused')).toBe(
            "L'envoi a échoué. Jira refuse le jeton enregistré, il a sans doute expiré.",
        );
    });

    it('sous-titre le jour, l’heure de l’envoi ou celle de l’essai', () => {
        const sent = status({ state: 'sent', sentAt: SENT_AT, attemptedAt: { date: '2026-10-07', time: '09:00' } });

        expect(sendSubtitle('2026-10-06', sent, 'confirm')).toBe('Mardi 6 octobre');
        expect(sendSubtitle('2026-10-06', sent, 'detail')).toBe('Mardi 6 octobre à 18:02');
        expect(sendSubtitle('2026-10-06', sent, 'result')).toBe('Mercredi 7 octobre à 09:00');
    });
});

describe('un ticket retiré que Jira ne trouve plus', () => {
    const sent = status({ state: 'sent', sentAt: SENT_AT, removed: ['OPS-7', 'DISPARU-1'], vanished: ['DISPARU-1'] });

    it('vient en dernier, à 0h00, avec sa marque d’avertissement', () => {
        const rows = sendRows(TICKETS, sent, 'detail');

        expect(rows.slice(2)).toEqual([
            { ticket: 'OPS-7', minutes: 0, removed: true },
            { ticket: 'DISPARU-1', minutes: 0, removed: true, vanished: true },
        ]);
        expect(fateOf(null, undefined, true)).toBe('vanished');
        expect(fateMark('vanished')).toBe('warning');
        expect(fateLabel('vanished', true)).toBe('Introuvable dans Jira');
    });

    it('dit sous lui quoi faire, en noir, dans le détail comme dans le résultat', () => {
        const row = { ticket: 'DISPARU-1', minutes: 0, removed: true, vanished: true };
        const line = { text: VANISHED_LINE, tone: 'warning' };

        expect(VANISHED_LINE).toBe(
            "Jira ne trouve plus ce ticket. S'il a encore des heures de ce jour, retirez-les dans Jira.",
        );
        expect(ticketLine(row, 'detail')).toEqual(line);
        expect(ticketLine({ ...row, failure: null }, 'result')).toEqual(line);
    });

    it('ne promet pas à la confirmation de retirer de Jira des heures qu’il ne trouve plus', () => {
        const modified = status({ state: 'modified', removed: ['OPS-7', 'DISPARU-1'], vanished: ['DISPARU-1'] });
        const [retired, gone] = sendRows(TICKETS, modified, 'confirm').slice(2);

        expect(retired && ticketLine(retired, 'confirm')?.text).toBe('Ses heures seront retirées de Jira.');
        expect(gone && ticketLine(gone, 'confirm')).toEqual({ text: VANISHED_LINE, tone: 'warning' });
    });

    it('ne compte pas dans la tête d’un envoi partiel, qui ne parle que des tickets du jour', () => {
        const partial = status({
            state: 'partial',
            outcomes: new Map([
                ['SHOP-482', null],
                ['OPS-12', 'closed'],
                ['DISPARU-1', null],
            ]),
            removed: ['DISPARU-1'],
            vanished: ['DISPARU-1'],
        });

        expect(resultHead(sendRows(TICKETS, partial, 'result'), partial, false).text).toBe(
            "1 ticket sur 2 est dans Jira. OPS-12 n'a pas été envoyé.",
        );
    });

    it('le détail d’une journée vidée ne dit pas qu’elle a des heures dans Jira', () => {
        const emptied = status({ state: 'nothing', sentAt: SENT_AT, removed: ['DISPARU-1'], vanished: ['DISPARU-1'] });

        expect(detailHead(sendRows([], emptied, 'detail'))).toBeNull();
        expect(detailHead(sendRows(TICKETS, sent, 'detail'))).toBe('Ces heures sont dans Jira pour ce jour.');
    });
});

describe('ce qui suit un envoi', () => {
    const done: SendOutcome = { kind: 'done' };
    const none = { window: null, confetti: false, notice: null, tokenRefusal: null };

    it('fait partir les confettis quand tout est arrivé', () => {
        expect(afterSend(done, status({ state: 'sent', sentAt: SENT_AT }))).toEqual({ ...none, confetti: true });
        expect(afterSend(done, status({ state: 'nothing' }))).toEqual(none);
    });

    it('ouvre le détail, sans confettis, quand Jira ne trouve plus un ticket retiré', () => {
        expect(afterSend(done, status({ state: 'sent', sentAt: SENT_AT, vanished: ['DISPARU-1'] }))).toEqual({
            ...none,
            window: 'detail',
        });
        // Une journée vidée dont Jira ne trouve plus le ticket reste envoyée : son détail s'ouvre de même.
        expect(
            afterSend(
                done,
                status({ state: 'sent', sentAt: SENT_AT, removed: ['DISPARU-1'], vanished: ['DISPARU-1'] }),
            ),
        ).toEqual({
            ...none,
            window: 'detail',
        });
    });

    it('ouvre le résultat d’un envoi qui n’a pas tout envoyé, et dit au bandeau un jeton refusé', () => {
        expect(afterSend(done, status({ state: 'partial', vanished: ['DISPARU-1'] }))).toEqual({
            ...none,
            window: 'result',
        });
        expect(afterSend(done, status({ state: 'failed', failure: 'refused' }))).toEqual({
            ...none,
            window: 'result',
            tokenRefusal: 'refused',
        });
        expect(afterSend(done, status({ state: 'unverified', failure: 'missing_scope' })).tokenRefusal).toBe(
            'missing_scope',
        );
    });

    it('dit en bas de la grille une journée changée ailleurs, ou un serveur muet', () => {
        expect(afterSend({ kind: 'stale' }, status({ state: 'unsent' }))).toEqual({ ...none, notice: STALE_SEND });
        expect(afterSend({ kind: 'failed' }, status({ state: 'unsent' }))).toEqual({
            ...none,
            notice: SEND_UNANSWERED,
        });
        // Un autre onglet envoie : le résultat viendra avec la journée relue.
        expect(afterSend({ kind: 'failed' }, status({ state: 'sending' }))).toEqual(none);
        expect(afterSend({ kind: 'sending' }, status({ state: 'sending' }))).toEqual(none);
    });
});

describe('readSend', () => {
    it('lit l’état d’envoi d’une journée, un objet vide rendu en liste compris', () => {
        expect(
            readSend({
                state: 'partial',
                sentAt: null,
                attemptedAt: SENT_AT,
                failure: null,
                outcomes: { 'FERME-1': 'closed', 'OPS-7': null },
                removed: ['DISPARU-1'],
                inJira: { 'FERME-1': 105 },
                vanished: ['DISPARU-1'],
            }),
        ).toEqual({
            state: 'partial',
            sentAt: null,
            attemptedAt: SENT_AT,
            failure: null,
            outcomes: new Map([
                ['FERME-1', 'closed'],
                ['OPS-7', null],
            ]),
            removed: ['DISPARU-1'],
            inJira: new Map([['FERME-1', 105]]),
            vanished: ['DISPARU-1'],
        });
        expect(readSend({ ...NOTHING_SENT, outcomes: {}, inJira: {} }).outcomes.size).toBe(0);
        // Le serveur rend un objet même vide : un tableau n'en est pas un.
        expect(() => readSend({ ...NOTHING_SENT, outcomes: [] })).toThrow(TypeError);
        expect(() => readSend({ ...NOTHING_SENT, inJira: [] })).toThrow(TypeError);
    });

    it('refuse un état de travers plutôt que de l’afficher', () => {
        const ok = {
            state: 'sent',
            sentAt: SENT_AT,
            attemptedAt: null,
            failure: null,
            outcomes: {},
            removed: [],
            inJira: {},
            vanished: [],
        };

        for (const broken of [
            { ...ok, state: 'envoye' },
            { ...ok, sentAt: { date: '6 octobre', time: '18:02' } },
            { ...ok, failure: 'panne' },
            { ...ok, outcomes: { 'SHOP-482': 'perdu' } },
            { ...ok, removed: [3] },
            { ...ok, vanished: [3] },
            { ...ok, vanished: undefined },
            { ...ok, inJira: { 'SHOP-482': '1h45' } },
            null,
        ]) {
            expect(() => readSend(broken)).toThrow(TypeError);
        }
    });
});
