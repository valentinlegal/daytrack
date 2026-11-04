import * as Quarter from './quarter';

/**
 * Ce qu'un quart d'heure contient : un ticket et son commentaire, ou une pause, qui
 * n'entre jamais dans le temps travaillé (src/Day/SlotContent.php).
 */
export type SlotContent =
    { readonly kind: 'work'; readonly ticket: string; readonly comment: string | null } | { readonly kind: 'pause' };

/** Ce qu'un quart d'heure contient, ou null s'il est vide. */
export type Cell = SlotContent | null;

/** Des quarts d'heure voisins au même contenu, tels que la grille les affiche. */
export interface Block {
    readonly start: number;
    readonly end: number;
    readonly content: SlotContent;
}

export const PAUSE: SlotContent = { kind: 'pause' };

export function work(ticket: string, comment: string | null = null): SlotContent {
    return { kind: 'work', ticket, comment };
}

/** Ce qui entoure un texte sans se voir : espaces de toute sorte, sauts de ligne, caractères de mise en forme. */
const INVISIBLE_EDGES = /^[\p{Z}\p{Cc}\p{Cf}]+|[\p{Z}\p{Cc}\p{Cf}]+$/gu;

function trimmed(value: string): string | null {
    const trimmed = value.replace(INVISIBLE_EDGES, '');

    return trimmed === '' ? null : trimmed;
}

/**
 * Le ticket tel que le serveur l'enregistre (src/Api/Input/SlotChangeInput.php) : en
 * majuscules, comme dans Jira où « shop-482 » mène à SHOP-482, et sans ce qui
 * l'entoure d'invisible. Seules les lettres sans accent changent, comme côté serveur.
 * Les cas de tests/cases/slot-text.json éprouvent les deux réécritures : un écart
 * ferait partir deux fois le même geste.
 */
export function normalizeTicket(ticket: string): string | null {
    return trimmed(ticket.replace(/[a-z]+/g, (letters) => letters.toUpperCase()));
}

/**
 * Le commentaire tel que le serveur l'enregistre : une espace insécable se tape sans la
 * voir, et deux espaces s'affichent comme une ; deux commentaires qui se lisent pareil
 * doivent être le même, sinon ils coupent le bloc en deux.
 */
export function normalizeComment(comment: string | null): string | null {
    return comment === null ? null : trimmed(comment.replace(/\p{Zs}+/gu, ' '));
}

/** Le contenu tel que le serveur l'enregistrera. Un ticket vide reste vide : le serveur le refusera. */
export function normalizeCell(cell: Cell): Cell {
    return cell?.kind === 'work' ? work(normalizeTicket(cell.ticket) ?? '', normalizeComment(cell.comment)) : cell;
}

/**
 * Deux contenus identiques. Deux quarts d'heure voisins au même contenu forment un
 * seul bloc : c'est cette égalité-là, et aucune autre, qui découpe la journée.
 */
export function sameCell(a: Cell, b: Cell): boolean {
    if (a === null || b === null) {
        return a === b;
    }
    if (a.kind === 'pause' || b.kind === 'pause') {
        return a.kind === b.kind;
    }

    return a.ticket === b.ticket && a.comment === b.comment;
}

function indexOf(quarter: number): number {
    Quarter.assertQuarter(quarter);

    return (quarter - Quarter.FIRST) / Quarter.MINUTES;
}

/**
 * Une journée vue quart d'heure par quart d'heure : ce que chacun contient, ou rien,
 * comme côté serveur (src/Day/Grid.php).
 *
 * C'est la forme d'où tout se déduit : les blocs affichés, le temps travaillé, ce
 * qu'un geste change. Un quart d'heure n'a qu'un contenu : deux saisies ne peuvent
 * pas s'y superposer. Une grille ne change pas : un geste en rend une nouvelle.
 */
export class Grid {
    private readonly cells: readonly Cell[];

    private constructor(cells: readonly Cell[]) {
        this.cells = cells;
    }

    static empty(): Grid {
        return new Grid(Array.from({ length: Quarter.COUNT }, () => null));
    }

    /** Chaque quart d'heure occupé, par son début. */
    static of(quarters: Iterable<readonly [number, SlotContent]>): Grid {
        const cells: Cell[] = Array.from({ length: Quarter.COUNT }, () => null);
        for (const [quarter, content] of quarters) {
            cells[indexOf(quarter)] = content;
        }

        return new Grid(cells);
    }

    /**
     * La grille de blocs reçus du serveur. Deux blocs qui se recouvrent sont refusés :
     * l'écran n'affiche jamais une journée que la base ne pourrait pas contenir.
     */
    static fromBlocks(blocks: Iterable<Block>): Grid {
        const cells: Cell[] = Array.from({ length: Quarter.COUNT }, () => null);
        for (const block of blocks) {
            if (!Quarter.isBoundary(block.end) || block.end <= block.start) {
                throw new RangeError(`Le bloc de ${Quarter.format(block.start)} finit de travers.`);
            }
            for (const quarter of Quarter.between(block.start, block.end)) {
                const index = indexOf(quarter);
                if (cells[index] !== null) {
                    throw new RangeError(`Deux blocs couvrent ${Quarter.format(quarter)}.`);
                }
                cells[index] = block.content;
            }
        }

        return new Grid(cells);
    }

    at(quarter: number): Cell {
        return this.cells[indexOf(quarter)] ?? null;
    }

    /** Les blocs affichés : les quarts d'heure voisins au même contenu, regroupés. */
    blocks(): Block[] {
        const blocks: Block[] = [];
        let current: Block | null = null;
        for (const start of Quarter.all()) {
            const content = this.at(start);
            if (current !== null && sameCell(current.content, content)) {
                current = { start: current.start, end: start + Quarter.MINUTES, content: current.content };
                continue;
            }
            if (current !== null) {
                blocks.push(current);
            }
            current = content === null ? null : { start, end: start + Quarter.MINUTES, content };
        }
        if (current !== null) {
            blocks.push(current);
        }

        return blocks;
    }

    /** Le bloc qui couvre un quart d'heure, ou null s'il est vide. */
    blockAt(quarter: number): Block | null {
        return this.blocks().find((block) => block.start <= quarter && quarter < block.end) ?? null;
    }

    /** Le temps travaillé, en minutes : les quarts d'heure saisis, pauses exclues. */
    workedMinutes(): number {
        return this.workedBefore(Quarter.DAY_END);
    }

    /** Le temps travaillé avant une heure donnée, un quart d'heure entamé compté à la minute. */
    workedBefore(minute: number): number {
        let worked = 0;
        for (const start of Quarter.all()) {
            if (start >= minute) {
                break;
            }
            if (this.at(start)?.kind === 'work') {
                worked += Math.min(Quarter.MINUTES, minute - start);
            }
        }

        return worked;
    }

    /** Une pause couvre cette minute. Hors de la grille, il n'y en a jamais. */
    isPauseAt(minute: number): boolean {
        const quarter = minute - (minute % Quarter.MINUTES);

        return Quarter.isQuarter(quarter) && this.at(quarter)?.kind === 'pause';
    }

    /** La grille où chaque quart d'heure nommé prend son nouveau contenu, ou se vide. */
    with(changes: ReadonlyMap<number, Cell>): Grid {
        const cells = [...this.cells];
        for (const [quarter, content] of changes) {
            cells[indexOf(quarter)] = content;
        }

        return new Grid(cells);
    }

    /** Les quarts d'heure où cette grille et l'autre diffèrent, et ce qu'ils valent dans l'autre. */
    changesTo(other: Grid): Map<number, Cell> {
        const changes = new Map<number, Cell>();
        for (const quarter of Quarter.all()) {
            if (!sameCell(this.at(quarter), other.at(quarter))) {
                changes.set(quarter, other.at(quarter));
            }
        }

        return changes;
    }

    equals(other: Grid): boolean {
        return this.changesTo(other).size === 0;
    }
}
