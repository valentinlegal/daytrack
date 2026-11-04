import type { Page, Route } from '@playwright/test';

/** Un type de ticket tel que l'API des réglages le rend. */
export interface ServedType {
    readonly id: string;
    readonly name: string;
    readonly color: string;
}

export interface ServedSettings {
    readonly habitualObjective: number;
    readonly workingDays: readonly number[];
    readonly issueTypes: readonly ServedType[];
}

/** Les réglages d'exemple : 7h30, du lundi au vendredi, cinq types. */
export const SAMPLE_SETTINGS: ServedSettings = {
    habitualObjective: 450,
    workingDays: [1, 2, 3, 4, 5],
    issueTypes: [
        { id: '0199a3c4-0000-7000-8000-000000000001', name: 'Story', color: 'vert' },
        { id: '0199a3c4-0000-7000-8000-000000000002', name: 'Bug', color: 'rouge' },
        { id: '0199a3c4-0000-7000-8000-000000000003', name: 'Tâche', color: 'bleu' },
        { id: '0199a3c4-0000-7000-8000-000000000004', name: 'Epic', color: 'violet' },
        { id: '0199a3c4-0000-7000-8000-000000000005', name: 'Support client', color: 'cyan' },
    ],
};

/**
 * Les réglages servis à un onglet, comme le serveur les tient (src/Settings/UserSettings.php),
 * sans toucher ceux de l'application de développement : un objectif habituel changé y
 * changerait les journées vides de tous les parcours qui tournent en même temps.
 *
 * Il garde ce qu'il a reçu, et sait répondre lentement ou tomber en panne.
 */
export class SettingsServer {
    settings: ServedSettings;
    /** Chaque écriture reçue : « PUT /api/settings/… {…} ». */
    readonly received: string[] = [];
    /** Ce que fera la prochaine écriture. */
    next: 'accept' | 'fail' = 'accept';
    /** Le temps que met une écriture à répondre, en millisecondes. */
    delay = 0;

    constructor(settings: ServedSettings) {
        this.settings = settings;
    }

    async serve(page: Page): Promise<void> {
        await page.route('**/api/settings**', (route) => this.answer(route));
    }

    private async answer(route: Route): Promise<void> {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === 'GET') {
            await route.fulfill({ json: this.settings });

            return;
        }
        const body = request.postDataJSON() as Record<string, unknown>;
        this.received.push(`${request.method()} ${path} ${JSON.stringify(body)}`);
        const outcome = this.next;
        this.next = 'accept';
        if (this.delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.delay));
        }
        if (outcome === 'fail') {
            await route.fulfill({ status: 500, body: 'Erreur' });

            return;
        }
        this.settings = applied(this.settings, path, body);
        await route.fulfill({ json: this.settings });
    }
}

function applied(settings: ServedSettings, path: string, body: Record<string, unknown>): ServedSettings {
    if (path.endsWith('/habitual-objective') && typeof body.objective === 'number') {
        return { ...settings, habitualObjective: body.objective };
    }
    const day = /\/working-days\/(\d)$/.exec(path)?.[1];
    if (day !== undefined && typeof body.worked === 'boolean') {
        const others = settings.workingDays.filter((other) => other !== Number(day));

        return { ...settings, workingDays: body.worked ? [...others, Number(day)].sort((a, b) => a - b) : others };
    }
    const type = /\/issue-types\/([^/]+)$/.exec(path)?.[1];
    if (type !== undefined && typeof body.color === 'string') {
        const color = body.color;

        return { ...settings, issueTypes: settings.issueTypes.map((t) => (t.id === type ? { ...t, color } : t)) };
    }

    throw new Error(`Écriture inattendue : ${path} ${JSON.stringify(body)}`);
}

/**
 * Le pied des réglages écrit la version installée et l'année où elle a été construite :
 * une capture les remet à des valeurs d'exemple, pour ne pas changer à chaque version.
 */
export async function pinFooter(page: Page): Promise<void> {
    const footer = page.locator('footer');
    await footer.getByText(/^DayTrack /).evaluate((node) => {
        node.textContent = 'DayTrack 2.4.0';
    });
    await footer.getByText(/Valentin Le Gal$/).evaluate((node) => {
        node.textContent = '© 2026 Valentin Le Gal';
    });
}
