import { isRecord } from '../grid/json';
import { serverApi } from '../serverApi';

/** Ce que la reprise de la v1 a laissé de côté, posé sur la page par le serveur. */
export interface V1LeftOut {
    readonly entries: readonly V1LeftOutEntry[];
    readonly objectives: readonly V1LeftOutObjective[];
    readonly favorites: readonly string[];
}

interface V1LeftOutEntry {
    readonly date: string;
    readonly start: string;
    readonly end: string | null;
    readonly ticket: string | null;
}

interface V1LeftOutObjective {
    readonly date: string;
    readonly from: number;
    readonly to: number;
}

export const NOTHING_LEFT_OUT: V1LeftOut = { entries: [], objectives: [], favorites: [] };

export function hasLeftOut({ entries, objectives, favorites }: V1LeftOut): boolean {
    return entries.length > 0 || objectives.length > 0 || favorites.length > 0;
}

/**
 * Lit l'attribut de la page (src/Entity/V1Import.php) ; ce qui ne s'y lit pas ne se dit
 * pas, ligne par ligne : une ligne de travers ne fait pas taire les autres.
 */
export function readV1LeftOut(json: string | undefined): V1LeftOut {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json ?? '');
    } catch {
        return NOTHING_LEFT_OUT;
    }
    if (!isRecord(parsed)) {
        return NOTHING_LEFT_OUT;
    }

    return {
        entries: listOf(parsed.entries, readEntry),
        objectives: listOf(parsed.objectives, readObjective),
        favorites: listOf(parsed.favorites, (favorite) => (typeof favorite === 'string' ? favorite : null)),
    };
}

function listOf<T>(json: unknown, read: (item: unknown) => T | null): T[] {
    return Array.isArray(json) ? json.map(read).filter((item): item is T => item !== null) : [];
}

function readEntry(json: unknown): V1LeftOutEntry | null {
    return isRecord(json) &&
        typeof json.date === 'string' &&
        typeof json.start === 'string' &&
        (json.end === null || typeof json.end === 'string') &&
        (json.ticket === null || typeof json.ticket === 'string')
        ? { date: json.date, start: json.start, end: json.end, ticket: json.ticket }
        : null;
}

function readObjective(json: unknown): V1LeftOutObjective | null {
    return isRecord(json) &&
        typeof json.date === 'string' &&
        typeof json.from === 'number' &&
        typeof json.to === 'number'
        ? { date: json.date, from: json.from, to: json.to }
        : null;
}

export interface V1ImportApi {
    seen(): Promise<void>;
}

/** Ce que la reprise de la v1 a laissé de côté, marqué lu (src/Controller/Api/V1ImportController.php). */
export function httpV1ImportApi(fetcher?: typeof fetch): V1ImportApi {
    const server = serverApi(fetcher);

    return {
        seen: () => server.request('POST', '/api/v1-import/seen', { 204: () => undefined }, { body: {} }),
    };
}
