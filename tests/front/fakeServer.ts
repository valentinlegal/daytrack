/** Une requête reçue par le faux serveur : son adresse, et ce qui l'accompagne. */
export interface SentRequest {
    url: string;
    init: RequestInit | undefined;
}

/**
 * Un `fetch` qui répond toujours la même chose — un texte tel quel, le reste en JSON — et
 * garde les requêtes reçues.
 */
export function answeringFetch(status: number, body: unknown): { fetcher: typeof fetch; sent: SentRequest[] } {
    const sent: SentRequest[] = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: input instanceof Request ? input.url : input.toString(), init });

        return Promise.resolve(
            new Response(typeof body === 'string' ? body : JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
    }) as typeof fetch;

    return { fetcher, sent };
}

/** Une API du navigateur branchée sur ce faux serveur. */
export function answering<Api>(
    api: (fetcher: typeof fetch) => Api,
    status: number,
    body: unknown,
): { api: Api; sent: SentRequest[] } {
    const { fetcher, sent } = answeringFetch(status, body);

    return { api: api(fetcher), sent };
}
