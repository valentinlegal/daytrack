/** Ce que la reprise de la v1 a laissé de côté, posé sur la page par le serveur. */
export interface V1LeftOut {
    readonly entries: readonly {
        readonly date: string;
        readonly start: string;
        readonly end: string | null;
        readonly ticket: string | null;
    }[];
    readonly objectives: readonly { readonly date: string; readonly from: number; readonly to: number }[];
    readonly favorites: readonly string[];
}

export const NOTHING_LEFT_OUT: V1LeftOut = { entries: [], objectives: [], favorites: [] };

export function hasLeftOut({ entries, objectives, favorites }: V1LeftOut): boolean {
    return entries.length > 0 || objectives.length > 0 || favorites.length > 0;
}

/** Lit l'attribut de la page ; ce qui ne s'y lit pas ne se dit pas. */
export function readV1LeftOut(json: string | undefined): V1LeftOut {
    try {
        const parsed: unknown = JSON.parse(json ?? '');
        const { entries, objectives, favorites } = (parsed ?? {}) as Partial<V1LeftOut>;

        return { entries: entries ?? [], objectives: objectives ?? [], favorites: favorites ?? [] };
    } catch {
        return NOTHING_LEFT_OUT;
    }
}

export interface V1ImportApi {
    seen(): Promise<void>;
}

export function httpV1ImportApi(fetcher: typeof fetch = (...args) => fetch(...args)): V1ImportApi {
    return {
        seen: async () => {
            const response = await fetcher('/api/v1-import/seen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!response.ok) {
                throw new Error(`Le serveur a répondu ${String(response.status)}.`);
            }
        },
    };
}
