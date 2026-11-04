/**
 * Ce que l'onglet garde : le presse-papier, l'historique de chaque journée.
 *
 * La mémoire passe d'abord : elle a toujours la dernière écriture de l'onglet.
 * `sessionStorage` n'est là que pour qu'un rechargement la retrouve. Quand il refuse
 * une écriture — plein, ou bloqué par le navigateur —, sa copie est retirée plutôt que
 * laissée en retard : un rechargement repart alors de rien, jamais d'un état qui ne
 * dit plus ce que l'onglet a fait.
 */
export type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Un stockage qui ne garde rien : l'onglet tient alors tout en mémoire. */
const NO_STORAGE: TabStorage = {
    getItem: () => null,
    setItem: () => {
        throw new DOMException('Le navigateur refuse le stockage.', 'SecurityError');
    },
    removeItem: () => undefined,
    key: () => null,
    length: 0,
};

/**
 * Le sessionStorage de l'onglet. Un navigateur qui bloque les données du site lève
 * dès qu'on y touche : l'écran tourne alors sans rien garder au rechargement.
 */
export function tabStorage(source: Pick<Window, 'sessionStorage'>): TabStorage {
    try {
        return source.sessionStorage;
    } catch {
        return NO_STORAGE;
    }
}

export class TabValues<T> {
    private readonly memory = new Map<string, T>();
    private readonly storage: TabStorage;
    private readonly prefix: string;
    private readonly read: (json: unknown) => T | undefined;
    private readonly evicts: boolean;

    /**
     * @param read   lit une valeur rangée ; undefined pour ce qui n'en a pas la forme —
     *               une autre version de DayTrack, une main passée par les outils du
     *               navigateur
     * @param evicts quand le stockage est plein, les autres clés lui laissent la place :
     *               les historiques des journées qu'on ne regarde plus
     */
    constructor(storage: TabStorage, prefix: string, read: (json: unknown) => T | undefined, evicts = false) {
        this.storage = storage;
        this.prefix = prefix;
        this.read = read;
        this.evicts = evicts;
    }

    get(key: string): T | undefined {
        if (this.memory.has(key)) {
            return this.memory.get(key);
        }
        try {
            const stored = this.storage.getItem(this.prefix + key);

            return stored === null ? undefined : this.read(JSON.parse(stored));
        } catch {
            return undefined;
        }
    }

    /** Garde la valeur, et dit si un rechargement la retrouvera. */
    set(key: string, value: T): boolean {
        this.memory.set(key, value);
        const json = JSON.stringify(value);
        if (this.store(key, json)) {
            return true;
        }
        if (this.evicts) {
            // L'onglet garde en mémoire ce qu'il retire : seul un rechargement le perd.
            for (const other of this.storedKeys().filter((stored) => stored !== key)) {
                this.remove(other);
            }
            if (this.store(key, json)) {
                return true;
            }
        }
        this.remove(key);

        return false;
    }

    delete(key: string): void {
        this.memory.delete(key);
        this.remove(key);
    }

    /** Un rechargement ne retrouvera pas cette valeur ; l'onglet, lui, la garde. */
    unstore(key: string): void {
        this.remove(key);
    }

    private store(key: string, json: string): boolean {
        try {
            this.storage.setItem(this.prefix + key, json);

            return true;
        } catch {
            return false;
        }
    }

    private remove(key: string): void {
        try {
            this.storage.removeItem(this.prefix + key);
        } catch {
            // Le navigateur refuse tout : la mémoire seule fait foi.
        }
    }

    private storedKeys(): string[] {
        const keys: string[] = [];
        try {
            for (let index = 0; index < this.storage.length; index += 1) {
                const key = this.storage.key(index);
                if (key?.startsWith(this.prefix) === true) {
                    keys.push(key.slice(this.prefix.length));
                }
            }
        } catch {
            // Rien à libérer.
        }

        return keys;
    }
}
