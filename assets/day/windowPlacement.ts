/** Une étendue verticale de l'écran, en pixels depuis son haut. */
export interface Span {
    readonly top: number;
    readonly bottom: number;
}

/** Une étendue horizontale de l'écran, en pixels depuis son bord gauche. */
export interface Stretch {
    readonly left: number;
    readonly right: number;
}

/** Ce qu'il faut à la fenêtre : sa hauteur, son écart avec le créneau et sa marge avec le bord. */
export interface Room {
    readonly height: number;
    readonly gap: number;
    readonly margin: number;
}

/**
 * Comment la fenêtre de ticket s'est accrochée à son ouverture. Cela ne change plus tant
 * qu'elle reste ouverte : en défilant, elle ne change ni de côté ni de morceau, ce qui la
 * ferait sauter.
 */
export interface Attachment {
    /** Le morceau de la sélection auquel elle s'accroche. */
    readonly run: number;
    /** Son bord du morceau : au-dessus de son haut, sous son bas, ou sous son premier quart d'heure visible. */
    readonly edge: 'above' | 'below' | 'first';
    /** Ouverte sur la barre faute de place, le créneau qu'elle a pris ; null sinon : elle reste sous la barre. */
    readonly tight: number | null;
}

/** Ce à quoi la fenêtre s'accroche maintenant, et si elle s'est arrêtée au bord de la grille. */
export interface Anchor {
    readonly span: Span;
    /** Arrêtée, elle ne désigne plus le créneau : sa flèche disparaît. */
    readonly stopped: boolean;
}

/** Où la fenêtre se pose en largeur : son bord gauche, et l'horizontale que désigne sa flèche. */
export interface Across {
    readonly left: number;
    readonly arrow: number;
}

/**
 * Où la fenêtre de ticket s'accroche à l'ouverture : du côté qu'elle préfère — au-dessus
 * de la sélection pour Nouveau ticket, sous le quart d'heure visé pour Modifier le
 * ticket —, et de l'autre faute de place. La place se compte dans la partie visible de la
 * grille : la fenêtre ne recouvre pas la barre du haut, ni ne sort de l'écran.
 *
 * Une sélection en morceaux s'accroche par son premier morceau visible ; une sélection
 * trop haute pour laisser la place au-dessus comme dessous, par son premier quart
 * d'heure visible, la fenêtre posée dessous. Sans place nulle part, elle se pose
 * au-dessus et mord sur la barre, plutôt que d'être coupée en bas de l'écran.
 *
 * @param runs   les morceaux de la sélection, dans l'ordre, ou le seul quart d'heure visé
 * @param view   la partie visible de la grille
 * @param room   ce qu'il faut à la fenêtre
 * @param row    la hauteur d'un quart d'heure
 * @param prefer le côté où elle se pose quand la place y est
 */
export function attachWindow(
    runs: readonly Span[],
    view: Span,
    room: Room,
    row: number,
    prefer: 'above' | 'below',
): Attachment {
    const found = runs.findIndex((span) => visible(span, view));
    const index = found === -1 ? 0 : found;
    const run = runs[index] ?? view;
    const need = needOf(room);
    const shown = visible(run, view)
        ? { top: Math.max(run.top, view.top), bottom: Math.min(run.bottom, view.bottom) }
        : run;
    const fits = { above: shown.top >= view.top + need, below: view.bottom - shown.bottom >= need };
    const sides = prefer === 'above' ? (['above', 'below'] as const) : (['below', 'above'] as const);
    const side = sides.find((candidate) => fits[candidate]);
    if (side !== undefined) {
        return { run: index, edge: side, tight: null };
    }
    const first = Math.min(shown.top + row, shown.bottom);

    return view.bottom - first >= need
        ? { run: index, edge: 'first', tight: null }
        : { run: index, edge: 'above', tight: shown.top };
}

/**
 * Ce à quoi la fenêtre de ticket s'accroche, la grille là où elle est : elle suit son
 * créneau, du côté pris à l'ouverture. Sorti de la partie visible, il la laisse au bord
 * qu'il a passé, entière et à sa marge de ce bord.
 *
 * Radix pose la fenêtre au-dessus de ce rectangle tant qu'elle tient dans l'écran, et
 * dessous sinon. Pour qu'elle passe dessous alors qu'elle tiendrait encore au-dessus,
 * sur la barre, le rectangle rendu monte jusqu'au haut de l'écran : au-dessus, elle
 * n'y tient plus.
 */
export function windowAnchor(
    runs: readonly Span[],
    view: Span,
    room: Room,
    row: number,
    attachment: Attachment,
): Anchor {
    const run = runs[attachment.run] ?? runs[0] ?? view;
    const need = needOf(room);
    if (attachment.edge === 'above') {
        // Ouverte sur la barre faute de place, elle ne monte pas plus ; sorti de la vue, son
        // créneau la laisse sous la barre, comme les autres.
        const under = view.top + need;
        const ceiling = visible(run, view) && attachment.tight !== null ? Math.min(attachment.tight, under) : under;
        const top = between(run.top, ceiling, view.bottom - room.margin + room.gap);

        return {
            span: { top, bottom: Math.max(top, Math.min(run.bottom, view.bottom)) },
            stopped: top !== run.top || !visible(run, view),
        };
    }
    const wanted = attachment.edge === 'below' ? run.bottom : Math.min(Math.max(run.top, view.top) + row, run.bottom);
    const bottom = between(wanted, view.top + room.margin - room.gap, view.bottom - need);

    return {
        span: { top: Math.min(bottom, 0), bottom },
        stopped: bottom !== wanted || !visible(run, view),
    };
}

/**
 * Où la fenêtre de ticket se pose en largeur : centrée sur le pointeur, sa flèche au
 * pointeur. Elle reste dans la colonne des blocs, à sa marge de ses bords : près d'un
 * bord, elle glisse pour rester entière, et sa flèche reste au pointeur, assez loin des
 * bords de la fenêtre pour ne pas tomber dans son arrondi. Sans pointeur — au clavier —,
 * le milieu de la colonne en tient lieu.
 *
 * @param pointer   l'horizontale du pointeur à l'écran ; null au clavier
 * @param lane      la colonne des blocs
 * @param width     la largeur de la fenêtre
 * @param margin    sa marge avec les bords de la colonne
 * @param arrowRoom du bord de la fenêtre au milieu de sa flèche, au plus près
 */
export function across(
    pointer: number | null,
    lane: Stretch,
    width: number,
    margin: number,
    arrowRoom: number,
): Across {
    const aimed = pointer ?? (lane.left + lane.right) / 2;
    const left = between(aimed - width / 2, lane.left + margin, lane.right - margin - width);

    return { left, arrow: between(aimed, left + arrowRoom, left + width - arrowRoom) };
}

/**
 * Le quart d'heure que Modifier le ticket désigne : celui qu'on a double-cliqué, ou celui
 * où s'arrête la sélection au clavier, tant qu'il est dans le bloc. Le bloc changé
 * ailleurs sans lui, elle passe au premier quart d'heure du bloc.
 *
 * @param quarters les quarts d'heure du bloc
 * @param aimed    le quart d'heure visé à l'ouverture
 */
export function aimedQuarter(quarters: readonly number[], aimed: number | null): number | undefined {
    return aimed !== null && quarters.includes(aimed) ? aimed : quarters[0];
}

function needOf({ height, gap, margin }: Room): number {
    return height + gap + margin;
}

function visible(span: Span, view: Span): boolean {
    return span.bottom > view.top && span.top < view.bottom;
}

function between(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(value, high));
}
