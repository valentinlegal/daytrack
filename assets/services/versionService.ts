import type { VersionInfo } from '@/types/api';

const BASE = '/api/version';
const CACHE_KEY = 'daytrack.versionCheck';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — évite de solliciter /api/version à chaque retour de focus

interface CachedVersionCheck {
    data: VersionInfo;
    checkedAt: number;
}

/**
 * Interroge le serveur pour connaître la version courante et la dernière version publiée.
 * Toujours un appel réseau frais — à utiliser au chargement de la page pour refléter
 * immédiatement l'état réel (ex : l'utilisateur vient de mettre à jour puis a rechargé).
 * Alimente le cache utilisé par getVersionInfoCached pour les vérifications suivantes.
 */
export async function getVersionInfo(): Promise<VersionInfo> {
    const res = await fetch(BASE);
    if (!res.ok) throw new Error('Impossible de vérifier la version');
    const data = await res.json() as VersionInfo;
    writeCache({ data, checkedAt: Date.now() });
    return data;
}

/**
 * Comme getVersionInfo, mais évite les appels réseau rapprochés en réutilisant un résultat
 * récent stocké en sessionStorage. Réservé à la re-vérification au retour de focus de
 * l'onglet — ne pas utiliser au chargement initial, sous peine d'afficher un résultat
 * périmé (sessionStorage survit aux rechargements de page).
 */
export async function getVersionInfoCached(): Promise<VersionInfo> {
    const cached = readCache();
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
        return cached.data;
    }

    return getVersionInfo();
}

function readCache(): CachedVersionCheck | null {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        return raw ? (JSON.parse(raw) as CachedVersionCheck) : null;
    } catch {
        return null;
    }
}

function writeCache(entry: CachedVersionCheck): void {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch {
        // sessionStorage indisponible (mode privé strict, quota...) — le cache est simplement désactivé
    }
}
