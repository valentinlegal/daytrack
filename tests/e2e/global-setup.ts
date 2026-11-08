import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type FullConfig, request } from '@playwright/test';

import { SAME_ORIGIN } from './day';
import { JIRA_ACCOUNT } from './jira';

/**
 * Aucun parcours n'atteint un vrai Jira. Les parcours servent l'état de Jira à la page,
 * mais leurs saisies font vérifier les tickets par l'application, et leurs envois partent
 * d'elle, avec sa connexion à elle : ils ne partent que si elle est reliée au Jira
 * simulé. Celle de l'intégration continue, née vide, s'y relie ici, comme celle d'un poste de
 * développement.
 *
 * Ils supposent aussi les jours travaillés par défaut, du lundi au vendredi : la journée
 * que lit la page les dit, et un samedi s'ouvre fermé à la saisie (tests/e2e/day.ts).
 *
 * Les jours que prennent les parcours s'inscrivent dans un dossier propre à
 * ce lancement (claimDay, tests/e2e/day.ts), que les fils de test héritent de
 * l'environnement, et qui disparaît avec lui.
 */
export default async function globalSetup(config: FullConfig): Promise<() => void> {
    const baseURL = config.projects[0]?.use.baseURL ?? 'https://localhost:8443';
    const context = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
    try {
        const response = await context.get('/api/jira');
        const state = (await response.json()) as { linked: boolean; site?: string };
        if (!state.linked) {
            const linked = await context.put('/api/jira', {
                headers: SAME_ORIGIN,
                data: { site: JIRA_ACCOUNT.site, email: JIRA_ACCOUNT.email, token: JIRA_ACCOUNT.token },
            });
            if (!linked.ok()) {
                throw new Error(
                    `L'application ne se relie pas au Jira simulé : ${String(linked.status())} ${await linked.text()}`,
                );
            }
        } else if (state.site !== JIRA_ACCOUNT.site) {
            throw new Error(
                `L'application est reliée à ${state.site ?? 'un autre Jira'} : les parcours n'y vérifieraient pas leurs tickets dans le Jira simulé. Reliez-la à ${JIRA_ACCOUNT.site}, ou lancez-les sur une autre application.`,
            );
        }
        const settings = (await (await context.get('/api/settings')).json()) as { workingDays: number[] };
        if (settings.workingDays.join() !== '1,2,3,4,5') {
            throw new Error(
                "Les jours travaillés de l'application ne sont plus ceux par défaut, du lundi au vendredi, que les parcours supposent. Rétablissez-les dans ses réglages, ou lancez-les sur une autre application.",
            );
        }
    } finally {
        await context.dispose();
    }

    const claims = mkdtempSync(join(tmpdir(), 'daytrack-days-'));
    process.env.E2E_DAY_CLAIMS = claims;

    return () => {
        rmSync(claims, { recursive: true });
    };
}
