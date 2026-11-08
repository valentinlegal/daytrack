import { isRecord } from '../grid/json';
import { serverApi } from '../serverApi';

/** La version à installer, que le serveur lit dans le registre (src/Controller/Api/VersionController.php). */
export interface VersionApi {
    /** Le numéro de la version à installer ; rien si la nôtre est la dernière. */
    available(): Promise<string | null>;
}

export function httpVersionApi(fetcher?: typeof fetch): VersionApi {
    const server = serverApi(fetcher);

    return {
        available: () => server.read('/api/version', readAvailable),
    };
}

/** Il finit à l'écran et dans une adresse : tout ce qui n'est pas un numéro entier ne s'annonce pas. */
export function readAvailable(json: unknown): string | null {
    const available = isRecord(json) ? json.available : null;

    return typeof available === 'string' && /^\d+\.\d+\.\d+$/.test(available) ? available : null;
}

/** Le dépôt de DayTrack. */
export const REPOSITORY = 'https://github.com/valentinlegal/daytrack';

/** Les notes d'une version, publiées dans le dépôt, sous son tag. */
export function notesUrl(version: string): string {
    return `${REPOSITORY}/releases/tag/v${version}`;
}
