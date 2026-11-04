import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { across, aimedQuarter, attachWindow, type Span, windowAnchor } from '../../../assets/day/windowPlacement';

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

        expect(anchor).toEqual({ span: { top: 360, bottom: 384 }, stopped: false });
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
        expect(scrolled(ABOVE, 50)).toEqual({ span: { top: 550, bottom: 598 }, stopped: false });
        expect(scrolled(BELOW, 50)).toEqual({ span: { top: 0, bottom: 174 }, stopped: false });
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

    it('reste sous la barre quand elle grandit, un refus apparu sous son champ', () => {
        const attached = attachWindow(ABOVE, VIEW, ROOM, ROW, 'above');
        const taller = { ...ROOM, height: ROOM.height + 80 };
        const moved = ABOVE.map(({ top, bottom }) => ({ top: top - 40, bottom: bottom - 40 }));

        const anchor = windowAnchor(moved, VIEW, taller, ROW, attached);

        expect(anchor.span.top - taller.gap - taller.height).toBe(VIEW.top + taller.margin);
    });

    it('reprend son créneau, flèche comprise, quand il revient', () => {
        expect(scrolled(ABOVE, 600).stopped).toBe(true);
        expect(scrolled(ABOVE, 0)).toEqual({ span: { top: 500, bottom: 548 }, stopped: false });
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
        expect(scrolled(runs, 100)).toEqual({ span: { top: 460, bottom: 484 }, stopped: false });

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
        });
    });

    it('suit son quart d’heure quand la grille défile, du côté pris à l’ouverture', () => {
        expect(scrolled(quarter(300), 30, VIEW, 'below')).toEqual({ span: { top: 0, bottom: 354 }, stopped: false });

        // La place revenue au-dessus, elle reste dessous, jusqu'à s'arrêter en bas de l'écran.
        const down = scrolled(quarter(300), 300, VIEW, 'below');
        expect(down.stopped).toBe(true);
        expect(down.span.bottom + ROOM.gap + ROOM.height).toBe(VIEW.bottom - ROOM.margin);
    });

    it('reste dessous quand elle grandit sans place, remontée de ce qui lui manque et sans flèche', () => {
        // Un refus : son message, et Nouveau ticket qui prend sa place, plus haut de 80 px.
        const attached = attachWindow(quarter(300), VIEW, ROOM, ROW, 'below');
        const taller = { ...ROOM, height: ROOM.height + 80 };

        const anchor = windowAnchor(quarter(300), VIEW, taller, ROW, attached);

        expect(anchor.stopped).toBe(true);
        expect(anchor.span.bottom + taller.gap + taller.height).toBe(VIEW.bottom - taller.margin);
    });

    it('s’arrête sous la barre, entière et sans flèche, quand son quart d’heure est sorti par le haut', () => {
        const gone = scrolled(quarter(300), -300, VIEW, 'below');

        expect(gone.stopped).toBe(true);
        expect(gone.span.bottom + ROOM.gap).toBe(VIEW.top + ROOM.margin);
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
