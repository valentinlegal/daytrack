import { type Cell, PAUSE, work } from './grid';
import * as Quarter from './quarter';

/**
 * Lire ce que rendent l'API et le stockage de l'onglet sans le croire sur parole :
 * une autre version de DayTrack, ou une main passée par les outils du navigateur,
 * peut y avoir laissé n'importe quoi.
 */
export function isRecord(json: unknown): json is Record<string, unknown> {
    return typeof json === 'object' && json !== null && !Array.isArray(json);
}

/** Un contenu de quart d'heure, ou undefined s'il n'en a pas la forme. */
export function readCell(json: unknown): Cell | undefined {
    if (json === null) {
        return null;
    }
    if (!isRecord(json)) {
        return undefined;
    }
    if (json.kind === 'pause') {
        return PAUSE;
    }
    if (
        json.kind === 'work' &&
        typeof json.ticket === 'string' &&
        (json.comment === null || typeof json.comment === 'string')
    ) {
        return work(json.ticket, json.comment);
    }

    return undefined;
}

/** Les quarts d'heure touchés par un geste rangé : des débuts de quart d'heure, chacun une fois. */
export function readQuarters(json: unknown): number[] | undefined {
    if (!Array.isArray(json)) {
        return undefined;
    }
    const quarters: number[] = [];
    for (const quarter of json as unknown[]) {
        if (typeof quarter !== 'number' || !Quarter.isQuarter(quarter) || quarters.includes(quarter)) {
            return undefined;
        }
        quarters.push(quarter);
    }

    return quarters;
}
