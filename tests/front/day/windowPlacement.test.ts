import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    across,
    aimedQuarter,
    type Anchor,
    attachWindow,
    reattachWindow,
    type Span,
    windowAnchor,
} from '../../../assets/day/windowPlacement';

/** Une grille visible de 64 à 720 px, une fenêtre haute de 340 px, des quarts d'heure de 24 px. */
const VIEW = { top: 64, bottom: 720 };
const ROOM = { height: 340, gap: 12, margin: 8 };
const ROW = 24;

/** Ce à quoi elle s'accroche en s'ouvrant. */
function opening(runs: readonly Span[], view: Span = VIEW, prefer: 'above' | 'below' = 'above'): Span {
    return windowAnchor(runs, view, ROOM, ROW, attachWindow(runs, view, ROOM, ROW, prefer)).span;
}

/** Ce à quoi elle s'accroche, la grille défilée de ce qu'il faut, ouverte sur ces créneaux. */
function scrolled(runs: readonly Span[], by: number, view: Span = VIEW, prefer: 'above' | 'below' = 'above') {
    const moved = runs.map(({ top, bottom }) => ({ top: top + by, bottom: bottom + by }));

    return windowAnchor(moved, view, ROOM, ROW, attachWindow(runs, view, ROOM, ROW, prefer));
}

describe('ce à quoi Nouveau ticket s’accroche à l’ouverture', () => {
    it('s’accroche à la sélection, au-dessus quand la place y est', () => {
        expect(opening([{ top: 500, bottom: 548 }])).toEqual({ top: 500, bottom: 548 });
    });

    it('passe dessous quand la place manque au-dessus, sans recouvrir la barre du haut', () => {
        // 316 px au-dessus dans la grille : la fenêtre y tiendrait sur la barre, pas sous elle.
        expect(opening([{ top: 380, bottom: 404 }], { top: 64, bottom: 900 })).toEqual({ top: 0, bottom: 404 });
    });

    it('s’accroche au premier quart d’heure d’une sélection trop haute, la fenêtre dessous', () => {
        expect(opening([{ top: 220, bottom: 412 }])).toEqual({ top: 0, bottom: 244 });
        // Plus haute que l'écran : sa partie visible compte.
        expect(opening([{ top: -400, bottom: 2000 }])).toEqual({ top: 0, bottom: 88 });
    });

    it('s’accroche au premier morceau visible d’une sélection en morceaux', () => {
        const morning = { top: -1000, bottom: -976 };
        const evening = { top: 680, bottom: 704 };
        expect(opening([morning, evening])).toEqual(evening);

        const both = [
            { top: 100, bottom: 124 },
            { top: 600, bottom: 624 },
        ];
        expect(opening(both)).toEqual({ top: 0, bottom: 124 });
    });

    it('garde la sélection quand ni le dessus ni le dessous n’ont la place', () => {
        const anchor = scrolled([{ top: 360, bottom: 384 }], 0);

        expect(anchor).toEqual({ span: { top: 360, bottom: 384 }, stopped: false, maxHeight: null });
    });

    it('s’arrête au bord pour une sélection hors de la vue, sans flèche', () => {
        const anchor = scrolled([{ top: 900, bottom: 924 }], 0);

        expect(anchor.stopped).toBe(true);
        // Le bas de la fenêtre à sa marge du bas de l'écran : l'écart avec le créneau en plus.
        expect(anchor.span.top - ROOM.gap).toBe(VIEW.bottom - ROOM.margin);
    });
});

describe('Nouveau ticket quand la grille défile', () => {
    const ABOVE = [{ top: 500, bottom: 548 }];
    const BELOW = [{ top: 100, bottom: 124 }];

    it('suit son créneau, flèche comprise, tant qu’il reste dans la vue', () => {
        expect(scrolled(ABOVE, 50)).toEqual({ span: { top: 550, bottom: 598 }, stopped: false, maxHeight: null });
        expect(scrolled(BELOW, 50)).toEqual({ span: { top: 0, bottom: 174 }, stopped: false, maxHeight: null });
    });

    it('ne change pas de côté, même quand la place revient de l’autre', () => {
        // Ouverte au-dessus, elle y reste quand le créneau monte : elle s'arrête sous la barre.
        const up = scrolled(ABOVE, -200);
        expect(up.stopped).toBe(true);
        expect(up.span.top - ROOM.gap - ROOM.height).toBe(VIEW.top + ROOM.margin);

        // Ouverte dessous, elle y reste quand le créneau descend : elle s'arrête en bas.
        const down = scrolled(BELOW, 400);
        expect(down.stopped).toBe(true);
        expect(down.span.top).toBeLessThanOrEqual(0);
        expect(down.span.bottom + ROOM.gap + ROOM.height).toBe(VIEW.bottom - ROOM.margin);
    });

    it('s’arrête sous la barre, entière, quand le créneau est sorti par le haut', () => {
        const anchor = scrolled(BELOW, -300);

        expect(anchor.stopped).toBe(true);
        expect(anchor.span.bottom + ROOM.gap).toBe(VIEW.top + ROOM.margin);
    });

    it('s’arrête en bas de l’écran, entière, quand le créneau est sorti par le bas', () => {
        const anchor = scrolled(ABOVE, 600);

        expect(anchor.stopped).toBe(true);
        expect(anchor.span.top - ROOM.gap).toBe(VIEW.bottom - ROOM.margin);
    });

    it('accrochée au-dessus, grandit vers le bas quand un refus apparaît sous son champ, son créneau défilé', () => {
        const attached = attachWindow(ABOVE, VIEW, ROOM, ROW, 'above');
        const taller = { ...ROOM, height: ROOM.height + 80 };
        const moved = ABOVE.map(({ top, bottom }) => ({ top: top - 40, bottom: bottom - 40 }));

        const anchor = windowAnchor(moved, VIEW, taller, ROW, attached, ROOM.height);

        // Son bord haut reste là où il était, haute de 340 px, son créneau monté de 40 px : à 108 ; elle
        // passe sur son créneau, sans sa flèche.
        expect(anchor).toEqual({ span: { top: 0, bottom: 96 }, stopped: true, maxHeight: 712 - 108 });
    });

    it('reprend son créneau, flèche comprise, quand il revient', () => {
        expect(scrolled(ABOVE, 600).stopped).toBe(true);
        expect(scrolled(ABOVE, 0)).toEqual({ span: { top: 500, bottom: 548 }, stopped: false, maxHeight: null });
    });

    it('reste accrochée au même morceau d’une sélection en morceaux', () => {
        const runs = [
            { top: 500, bottom: 524 },
            { top: 900, bottom: 924 },
        ];

        // Le premier morceau sort par le haut, le second entre dans la vue : elle ne saute pas dessus.
        const anchor = scrolled(runs, -480);
        expect(anchor.stopped).toBe(true);
        expect(anchor.span.top - ROOM.gap - ROOM.height).toBe(VIEW.top + ROOM.margin);
    });

    it('ouverte sur la barre faute de place, elle n’en monte pas plus', () => {
        const runs = [{ top: 360, bottom: 384 }];

        expect(scrolled(runs, -100).span.top).toBe(360);
        expect(scrolled(runs, 100)).toEqual({ span: { top: 460, bottom: 484 }, stopped: false, maxHeight: null });

        // Son créneau sorti de la vue par le haut, elle s'arrête sous la barre, comme les autres.
        const gone = scrolled(runs, -400);
        expect(gone.stopped).toBe(true);
        expect(gone.span.top - ROOM.gap - ROOM.height).toBe(VIEW.top + ROOM.margin);
    });
});

describe('ce à quoi Modifier le ticket s’accroche', () => {
    /** Le quart d'heure double-cliqué, haut de 24 px. */
    const quarter = (top: number): Span[] => [{ top, bottom: top + ROW }];

    it('se pose sous le quart d’heure visé quand la place y est', () => {
        // Le rectangle monte jusqu'en haut de l'écran : au-dessus, elle n'y tiendrait pas.
        expect(opening(quarter(300), VIEW, 'below')).toEqual({ top: 0, bottom: 324 });
    });

    it('passe au-dessus faute de place dessous, sans recouvrir la barre du haut', () => {
        expect(opening(quarter(600), VIEW, 'below')).toEqual({ top: 600, bottom: 624 });
    });

    it('mord sur la barre quand ni le dessous ni le dessus n’ont la place', () => {
        // 316 px de chaque côté dans la grille, pour une fenêtre qui en demande 360.
        const attached = attachWindow(quarter(380), VIEW, ROOM, ROW, 'below');

        expect(attached).toEqual({ run: 0, edge: 'above', tight: 380 });
        expect(windowAnchor(quarter(380), VIEW, ROOM, ROW, attached)).toEqual({
            span: { top: 380, bottom: 404 },
            stopped: false,
            maxHeight: null,
        });
    });

    it('reste sous son quart d’heure quand le dessous, sans la place entière, en a plus que le dessus barre comprise', () => {
        // 160 px au-dessus jusqu'en haut de l'écran, 532 dessous, pour une fenêtre qui en demande 360.
        const view = { top: 64, bottom: 340 + ROW + 532 };
        const attached = attachWindow(quarter(160), view, { ...ROOM, height: 900 }, ROW, 'below');

        expect(attached).toEqual({ run: 0, edge: 'first', tight: 184 });
        // Son contenu défile : elle ne remonte pas sur son quart d'heure.
        expect(windowAnchor(quarter(160), view, { ...ROOM, height: 900 }, ROW, attached)).toEqual({
            span: { top: 0, bottom: 184 },
            stopped: false,
            maxHeight: null,
        });
    });

    it('suit son quart d’heure quand la grille défile, du côté pris à l’ouverture', () => {
        expect(scrolled(quarter(300), 30, VIEW, 'below')).toEqual({
            span: { top: 0, bottom: 354 },
            stopped: false,
            maxHeight: null,
        });

        // La place revenue au-dessus, elle reste dessous, jusqu'à s'arrêter en bas de l'écran.
        const down = scrolled(quarter(300), 300, VIEW, 'below');
        expect(down.stopped).toBe(true);
        expect(down.span.bottom + ROOM.gap + ROOM.height).toBe(VIEW.bottom - ROOM.margin);
    });

    it('accrochée dessous, s’allonge sans remonter quand elle grandit, sa flèche gardée', () => {
        // Un refus : son message, et Nouveau ticket qui prend sa place, plus haut de 80 px.
        const attached = attachWindow(quarter(300), VIEW, ROOM, ROW, 'below');
        const taller = { ...ROOM, height: ROOM.height + 80 };

        const anchor = windowAnchor(quarter(300), VIEW, taller, ROW, attached, ROOM.height);

        // Toujours sous son quart d'heure : son pied s'arrête au bas de l'écran, et son contenu défile.
        expect(anchor).toEqual({ span: { top: 0, bottom: 324 }, stopped: false, maxHeight: 720 - 8 - 336 });
    });

    it('s’arrête sous la barre, entière et sans flèche, quand son quart d’heure est sorti par le haut', () => {
        const gone = scrolled(quarter(300), -300, VIEW, 'below');

        expect(gone.stopped).toBe(true);
        expect(gone.span.bottom + ROOM.gap).toBe(VIEW.top + ROOM.margin);
    });
});

/**
 * Le bord haut de la fenêtre, là où Radix la pose : au-dessus du rectangle rendu, sous le
 * haut de l'écran à sa marge, tant qu'elle s'accroche au-dessus sans avoir grandi ; dessous
 * sinon, le rectangle montant jusqu'en haut de l'écran.
 */
function windowTop(anchor: Anchor, height: number): number {
    return anchor.span.top > 0
        ? Math.max(ROOM.margin, anchor.span.top - ROOM.gap - height)
        : anchor.span.bottom + ROOM.gap;
}

describe('une fenêtre qui grandit, ou un écran réduit', () => {
    /** La case « Récurrence » cochée : 580 px, plus que la place de part et d'autre de son créneau. */
    const unfolded = { ...ROOM, height: 580 };
    /** Le dessus d'un créneau que ni le dessus, ni le dessous n'ont entier : 316 px de chaque côté. */
    const tight = [{ top: 380, bottom: 404 }];

    it('au-dessus de son créneau, grandit vers le bas, sur lui, sans sa flèche', () => {
        // Nouveau ticket au-dessus de 12:00, haute de 340 px : son bord haut à 148.
        const noon = [{ top: 500, bottom: 524 }];
        const opened = attachWindow(noon, VIEW, ROOM, ROW, 'above');
        expect(opened).toEqual({ run: 0, edge: 'above', tight: null });
        expect(windowAnchor(noon, VIEW, ROOM, ROW, opened, ROOM.height)).toEqual({
            span: { top: 500, bottom: 524 },
            stopped: false,
            maxHeight: null,
        });

        // Dépliée de 80 px, puis de 240, plus que la place sous son bord haut : elle ne remonte
        // pas, et s'allonge jusqu'à sa marge du bas de l'écran, où son contenu défile.
        for (const grown of [{ ...ROOM, height: 420 }, unfolded]) {
            expect(reattachWindow(noon, VIEW, grown, ROW, 'above', opened, 'grown')).toBe(opened);
            expect(windowAnchor(noon, VIEW, grown, ROW, opened, ROOM.height)).toEqual({
                span: { top: 0, bottom: 136 },
                stopped: true,
                maxHeight: 712 - 148,
            });
        }

        // Repliée, elle retrouve sa place et sa flèche.
        expect(windowAnchor(noon, VIEW, ROOM, ROW, opened, ROOM.height).stopped).toBe(false);
    });

    it('ouverte dépliée au-dessus, se recolle en rapetissant, puis regrandit sans bouger son bord haut', () => {
        // Modifier le ticket d'un bloc bas d'un grand écran, ouverte case cochée : au-dessus,
        // faute de place dessous.
        const tall = { top: 64, bottom: 1000 };
        const low = [{ top: 900, bottom: 924 }];
        const opened = attachWindow(low, tall, unfolded, ROW, 'below');
        expect(opened).toEqual({ run: 0, edge: 'above', tight: null });

        // Case décochée : 340 px, elle se recolle à son bloc.
        expect(reattachWindow(low, tall, ROOM, ROW, 'below', opened, 'shrunk')).toBe(opened);
        expect(windowAnchor(low, tall, ROOM, ROW, opened, ROOM.height)).toEqual({
            span: { top: 900, bottom: 924 },
            stopped: false,
            maxHeight: null,
        });

        // Recochée : elle regrandit depuis ce bord haut, à 548, vers le bas, sans sa flèche.
        expect(reattachWindow(low, tall, unfolded, ROW, 'below', opened, 'grown')).toBe(opened);
        expect(windowAnchor(low, tall, unfolded, ROW, opened, ROOM.height)).toEqual({
            span: { top: 0, bottom: 536 },
            stopped: true,
            maxHeight: 992 - 548,
        });
    });

    it('sous son créneau, s’allonge sans remonter : son contenu défile au bas de l’écran, sa flèche gardée', () => {
        // Modifier le ticket sous 12:00 : 196 px dessous, assez pour 176 px fermée.
        const noon = [{ top: 500, bottom: 524 }];
        const closed = { ...ROOM, height: 176 };
        const opened = attachWindow(noon, VIEW, closed, ROW, 'below');
        expect(opened).toEqual({ run: 0, edge: 'below', tight: null });

        const kept = reattachWindow(noon, VIEW, unfolded, ROW, 'below', opened, 'grown');
        expect(kept).toBe(opened);
        expect(windowAnchor(noon, VIEW, unfolded, ROW, kept, closed.height)).toEqual({
            span: { top: 0, bottom: 524 },
            stopped: false,
            maxHeight: 720 - 8 - 524 - 12,
        });
    });

    it('ouverte sur la barre faute de place, grandit aussi vers le bas, sans remonter', () => {
        // Nouveau ticket au milieu d'un écran de portable : au-dessus, en mordant sur la barre,
        // son bord haut à 28.
        const opened = attachWindow(tight, VIEW, ROOM, ROW, 'above');
        expect(opened).toEqual({ run: 0, edge: 'above', tight: 380 });
        expect(windowTop(windowAnchor(tight, VIEW, ROOM, ROW, opened, ROOM.height), ROOM.height)).toBe(28);

        expect(reattachWindow(tight, VIEW, unfolded, ROW, 'above', opened, 'grown')).toBe(opened);
        expect(windowAnchor(tight, VIEW, unfolded, ROW, opened, ROOM.height)).toEqual({
            span: { top: 0, bottom: 16 },
            stopped: true,
            maxHeight: 712 - 28,
        });
    });

    it('ouverte sur la barre plus haute que la place, grandit depuis le haut de l’écran jusqu’en bas', () => {
        // Ouverte dépliée : son contenu défile déjà, son bord haut à la marge du haut de l'écran.
        const opened = attachWindow(tight, VIEW, unfolded, ROW, 'above');
        expect(opened).toEqual({ run: 0, edge: 'above', tight: 380 });
        expect(windowTop(windowAnchor(tight, VIEW, unfolded, ROW, opened, unfolded.height), unfolded.height)).toBe(8);

        const grown = { ...ROOM, height: 700 };
        const anchor = windowAnchor(tight, VIEW, grown, ROW, opened, unfolded.height);
        expect(anchor).toEqual({ span: { top: -4, bottom: -4 }, stopped: true, maxHeight: 712 - 8 });
        expect(windowTop(anchor, grown.height)).toBe(8);
    });

    it('ouverte sur la barre, reprend une accroche ordinaire en rapetissant quand elle tient entière, puis regrandit sans bouger', () => {
        // Modifier le ticket d'un bloc qui revient, ouverte dépliée au-dessus sur la barre.
        const opened = attachWindow(tight, VIEW, unfolded, ROW, 'below');
        expect(opened).toEqual({ run: 0, edge: 'above', tight: 380 });

        // Case décochée, assez basse pour tenir dessous : elle y passe, comme ouverte ainsi.
        const closed = { ...ROOM, height: 290 };
        const ordinary = reattachWindow(tight, VIEW, closed, ROW, 'below', opened, 'shrunk');
        expect(ordinary).toEqual({ run: 0, edge: 'below', tight: null });
        expect(windowAnchor(tight, VIEW, closed, ROW, ordinary, closed.height)).toEqual({
            span: { top: 0, bottom: 404 },
            stopped: false,
            maxHeight: null,
        });

        // Recochée : elle garde ce bord haut, sous son créneau, et son contenu défile.
        expect(reattachWindow(tight, VIEW, unfolded, ROW, 'below', ordinary, 'grown')).toBe(ordinary);
        expect(windowAnchor(tight, VIEW, unfolded, ROW, ordinary, closed.height)).toEqual({
            span: { top: 0, bottom: 404 },
            stopped: false,
            maxHeight: 712 - 416,
        });

        // Rapetissée sans tenir entière nulle part, elle garde son accroche sur la barre.
        expect(reattachWindow(tight, VIEW, { ...ROOM, height: 400 }, ROW, 'below', opened, 'shrunk')).toBe(opened);
    });

    it('au-dessus de son créneau, se replace quand l’écran réduit ne lui laisse plus la place, son contenu défile', () => {
        const noon = [{ top: 500, bottom: 524 }];
        const opened = attachWindow(noon, VIEW, ROOM, ROW, 'above');

        const replaced = reattachWindow(noon, VIEW, unfolded, ROW, 'above', opened, 'view');

        expect(replaced).toEqual({ run: 0, edge: 'above', tight: 500 });
        expect(windowAnchor(noon, VIEW, unfolded, ROW, replaced, unfolded.height)).toEqual({
            span: { top: 500, bottom: 524 },
            stopped: false,
            maxHeight: null,
        });
    });

    it('se replace dessous quand c’est là qu’elle se voit le plus', () => {
        // Modifier le ticket sous 09:00, haut dans l'écran : 116 px au-dessus, 524 dessous.
        const nine = [{ top: 156, bottom: 180 }];
        const opened = attachWindow(nine, VIEW, ROOM, ROW, 'below');

        expect(reattachWindow(nine, VIEW, unfolded, ROW, 'below', opened, 'view')).toEqual({
            run: 0,
            edge: 'first',
            tight: 180,
        });
    });

    it('garde son côté quand l’écran change et qu’elle tient encore entière, remontée de ce qui lui manque', () => {
        // Le navigateur réduit : 80 px de moins dessous, qu'elle aurait encore au-dessus.
        // Rouverte de l'autre côté, elle sauterait de sa hauteur.
        const quarter = [{ top: 570, bottom: 594 }];
        const opened = attachWindow(quarter, { top: 64, bottom: 1000 }, ROOM, ROW, 'below');
        const shorter = { top: 64, bottom: 920 };

        expect(reattachWindow(quarter, shorter, ROOM, ROW, 'below', opened, 'view')).toBe(opened);
        const anchor = windowAnchor(quarter, shorter, ROOM, ROW, opened);
        expect(anchor.stopped).toBe(true);
        expect(anchor.span.bottom + ROOM.gap + ROOM.height).toBe(shorter.bottom - ROOM.margin);
    });

    it('se replace quand l’écran réduit ne lui laisse plus la place entière', () => {
        // Modifier le ticket sous 10:00, puis le navigateur réduit : 300 px au-dessus jusqu'en
        // haut de l'écran, 276 dessous.
        const quarter = [{ top: 300, bottom: 324 }];
        const opened = attachWindow(quarter, VIEW, ROOM, ROW, 'below');
        expect(opened).toEqual({ run: 0, edge: 'below', tight: null });
        const short = { top: 64, bottom: 600 };

        const replaced = reattachWindow(quarter, short, ROOM, ROW, 'below', opened, 'view');

        expect(replaced).toEqual({ run: 0, edge: 'above', tight: 300 });
        // Au-dessus, sur la barre, sans descendre sur son quart d'heure : son contenu défile.
        expect(windowAnchor(quarter, short, ROOM, ROW, replaced)).toEqual({
            span: { top: 300, bottom: 324 },
            stopped: false,
            maxHeight: null,
        });
    });

    it('ne recouvre jamais son créneau visible ni ne demande plus que l’écran quand l’écran change, quelle que soit sa hauteur', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 64, max: 700 }),
                fc.integer({ min: 100, max: 1200 }),
                fc.integer({ min: 100, max: 1200 }),
                fc.constantFrom<'above' | 'below'>('above', 'below'),
                (top, first, then, prefer) => {
                    const runs = [{ top, bottom: top + ROW }];
                    const opened = attachWindow(runs, VIEW, { ...ROOM, height: first }, ROW, prefer);
                    const room = { ...ROOM, height: then };
                    const kept = reattachWindow(runs, VIEW, room, ROW, prefer, opened, 'view');
                    const fresh = attachWindow(runs, VIEW, room, ROW, prefer);
                    if (fresh.tight === null) {
                        // Entière quelque part : elle garde ce qu'elle avait.
                        expect(kept).toBe(opened);

                        return;
                    }
                    const { span } = windowAnchor(runs, VIEW, room, ROW, kept);
                    // Accrochée au bord de son créneau, au-dessus ou dessous : elle n'en couvre que
                    // ce que la flèche désigne.
                    expect(span.top === top || span.bottom === Math.min(top + ROW, VIEW.bottom)).toBe(true);
                },
            ),
        );
    });

    it('ne bouge jamais son bord haut en grandissant, quelle que soit son accroche, et garde son pied à l’écran', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 64, max: 700 }),
                fc.integer({ min: 100, max: 900 }),
                fc.integer({ min: 1, max: 900 }),
                fc.constantFrom<'above' | 'below'>('above', 'below'),
                (top, first, more, prefer) => {
                    const runs = [{ top, bottom: top + ROW }];
                    const closed = { ...ROOM, height: first };
                    const opened = attachWindow(runs, VIEW, closed, ROW, prefer);
                    const grown = { ...ROOM, height: first + more };
                    const before = windowAnchor(runs, VIEW, closed, ROW, opened, first);
                    const kept = reattachWindow(runs, VIEW, grown, ROW, prefer, opened, 'grown');
                    const after = windowAnchor(runs, VIEW, grown, ROW, kept, first);

                    expect(kept).toBe(opened);
                    const edge = windowTop(before, first);
                    expect(windowTop(after, grown.height)).toBe(edge);
                    // Dessous, son pied à sa marge du bas de l'écran au plus.
                    expect(after.span.top).toBeLessThanOrEqual(0);
                    expect(after.maxHeight).toBe(Math.max(0, VIEW.bottom - ROOM.margin - edge));
                    // Au-dessus de son créneau, elle passe sur lui, sans sa flèche.
                    expect(after.stopped).toBe(opened.edge === 'above' || before.stopped);
                },
            ),
        );
    });
});

describe('le quart d’heure que Modifier le ticket désigne', () => {
    // Un long bloc de 09:30 à 11:15, en minutes depuis minuit.
    const BLOCK = [570, 585, 600, 615, 630, 645, 660];

    it('est celui qu’on a double-cliqué, en bas d’un long bloc comme en haut', () => {
        expect(aimedQuarter(BLOCK, 660)).toBe(660);
        expect(aimedQuarter(BLOCK, 570)).toBe(570);
    });

    it('passe au premier quart d’heure du bloc quand il n’en fait plus partie', () => {
        // Le bloc raccourci dans un autre onglet, après le double-clic.
        expect(aimedQuarter(BLOCK.slice(0, 3), 660)).toBe(570);
        expect(aimedQuarter(BLOCK, null)).toBe(570);
    });
});

describe('où la fenêtre se pose en largeur', () => {
    /** La colonne des blocs à 1440 px, récapitulatif ouvert : 792 px, après les favoris et les heures. */
    const LANE = { left: 320, right: 1112 };
    const WIDTH = 400;
    const MARGIN = 8;
    /** --s-3 entre le bord de la fenêtre et sa flèche, large de 16 px. */
    const ARROW = 20;

    const place = (pointer: number | null, lane = LANE) => across(pointer, lane, WIDTH, MARGIN, ARROW);

    it('se centre sur le pointeur, sa flèche au pointeur, au milieu de la colonne', () => {
        expect(place(700)).toEqual({ left: 500, arrow: 700 });
    });

    it('glisse contre le bord gauche de la colonne, sans passer sur les heures', () => {
        // Le double-clic de l'écran « ajout », à 140 px du bord.
        expect(place(460)).toEqual({ left: 328, arrow: 460 });
    });

    it('garde sa flèche hors de son arrondi, pointeur collé au bord', () => {
        expect(place(322)).toEqual({ left: 328, arrow: 348 });
        expect(place(1110)).toEqual({ left: 704, arrow: 1084 });
    });

    it('s’arrête contre le récapitulatif, sans passer dessous', () => {
        // Le double-clic de l'écran « introuvable », à 680 px du bord.
        expect(place(1000)).toEqual({ left: 704, arrow: 1000 });
    });

    it('prend le milieu de la colonne au clavier, sans pointeur', () => {
        expect(place(null)).toEqual({ left: 516, arrow: 716 });
    });

    it('part du bord gauche dans une colonne plus étroite qu’elle', () => {
        expect(place(450, { left: 320, right: 620 })).toEqual({ left: 328, arrow: 450 });
    });

    it('reste dans la colonne, sa flèche au pointeur dès qu’elle le peut', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1600 }),
                fc.integer({ min: 2 * MARGIN + WIDTH, max: 1400 }),
                fc.option(fc.integer({ min: -200, max: 1600 }), { nil: null }),
                (left, width, pointer) => {
                    const lane = { left, right: left + width };
                    const placed = place(pointer, lane);

                    expect(placed.left).toBeGreaterThanOrEqual(lane.left + MARGIN);
                    expect(placed.left + WIDTH).toBeLessThanOrEqual(lane.right - MARGIN);
                    expect(placed.arrow - placed.left).toBeGreaterThanOrEqual(ARROW);
                    expect(placed.left + WIDTH - placed.arrow).toBeGreaterThanOrEqual(ARROW);
                    const aimed = pointer ?? (lane.left + lane.right) / 2;
                    if (aimed >= lane.left + MARGIN + ARROW && aimed <= lane.right - MARGIN - ARROW) {
                        expect(placed.arrow).toBe(aimed);
                    }
                },
            ),
        );
    });
});
