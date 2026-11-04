import { isRecord } from '../grid/json';

/**
 * Un favori (src/Entity/Favorite.php) : un ticket, avec un nom s'il a été renommé. Son
 * nom ne sert qu'à la liste, et n'entre jamais dans une saisie.
 */
export interface Favorite {
    readonly id: string;
    readonly ticket: string;
    readonly name: string | null;
}

/** La liste rendue par l'API, ou une erreur si elle n'en a pas la forme. */
export function readFavorites(json: unknown): Favorite[] {
    const list = isRecord(json) ? json.favorites : undefined;
    if (!Array.isArray(list)) {
        throw new TypeError("L'API ne rend pas la liste des favoris.");
    }

    return list.map((favorite: unknown) => {
        if (
            !isRecord(favorite) ||
            typeof favorite.id !== 'string' ||
            typeof favorite.ticket !== 'string' ||
            !(favorite.name === null || typeof favorite.name === 'string')
        ) {
            throw new TypeError("L'API rend un favori qui n'en a pas la forme.");
        }

        return { id: favorite.id, ticket: favorite.ticket, name: favorite.name };
    });
}

/**
 * La liste où ce favori est passé à cette place, comptée dans la liste sans lui ; null
 * s'il n'y est plus, ou s'il y est déjà.
 */
export function moved(list: readonly Favorite[], id: string, index: number): Favorite[] | null {
    const from = list.findIndex((favorite) => favorite.id === id);
    const favorite = list[from];
    if (favorite === undefined) {
        return null;
    }
    const rest = list.filter((other) => other.id !== id);
    const to = Math.min(Math.max(index, 0), rest.length);
    if (to === from) {
        return null;
    }
    rest.splice(to, 0, favorite);

    return rest;
}
