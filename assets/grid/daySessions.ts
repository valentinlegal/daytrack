import { type DayApi, DaySession, type TabMemory } from './daySession';

/**
 * Les journées d'un onglet : celle qu'on affiche, et celles qu'on vient de quitter, le
 * temps que leurs gestes finissent de s'enregistrer.
 *
 * Revenir sur un jour pendant qu'un de ses gestes part encore ne doit pas montrer la
 * journée d'avant ce geste : l'ouverture attend qu'il soit enregistré, puis relit la
 * journée. Seule la dernière journée demandée s'ouvre.
 */
export class DaySessions {
    private readonly api: DayApi;
    private readonly memory: TabMemory;
    private readonly leaving = new Map<string, DaySession>();
    private shown: DaySession | null = null;
    private requests = 0;

    constructor(api: DayApi, memory: TabMemory) {
        this.api = api;
        this.memory = memory;
    }

    /**
     * Ferme la journée affichée et ouvre celle-ci. Rend null quand une autre journée a été
     * demandée entre-temps ; lève quand la journée ne se lit pas.
     */
    async open(date: string): Promise<DaySession | null> {
        this.requests += 1;
        const request = this.requests;
        if (this.shown !== null) {
            this.leave(this.shown);
            this.shown = null;
        }
        await this.leaving.get(date)?.settled();
        if (request !== this.requests) {
            return null;
        }
        const day = await this.api.read(date);
        if (request !== this.requests) {
            return null;
        }
        if (day.date !== date) {
            throw new Error(`Le serveur a rendu le ${day.date} pour le ${date}.`);
        }
        this.shown = new DaySession(day, this.api, this.memory);

        return this.shown;
    }

    private leave(session: DaySession): void {
        session.close();
        this.leaving.set(session.date, session);
        void session.settled().then(() => {
            if (this.leaving.get(session.date) === session) {
                this.leaving.delete(session.date);
            }
        });
    }
}
