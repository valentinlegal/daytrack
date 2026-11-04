import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App, type AppConfig } from './App';
import { readJiraStatus } from './jira/jiraStatus';
import { followTheme } from './theme';
import { readV1LeftOut } from './v1/v1ImportApi';

followTheme(document.documentElement, window);

const root = document.getElementById('app');

if (root !== null) {
    createRoot(root).render(
        <StrictMode>
            <App config={readConfig(root)} />
        </StrictMode>,
    );
}

/** Ce que le serveur pose sur la racine de l'application (templates/app.html.twig). */
function readConfig(root: HTMLElement): AppConfig {
    const { screen, date, timezone, futureDays, workingDays, jira, jiraScopes, oldCompose, v1LeftOut } = root.dataset;
    if (date === undefined || timezone === undefined || futureDays === undefined) {
        throw new Error('La page ne dit pas quel jour ouvrir.');
    }

    return {
        screen: screen === 'settings' ? 'settings' : 'day',
        day: {
            date,
            timezone,
            futureDays: Number(futureDays),
            // « 1 2 3 4 5 » ; vide si aucun jour n'est travaillé.
            workingDays: (workingDays ?? '').split(' ').filter(Boolean).map(Number),
        },
        jira: readJiraStatus(jira, jiraScopes),
        oldCompose: oldCompose === 'default' || oldCompose === 'custom' ? oldCompose : null,
        v1LeftOut: readV1LeftOut(v1LeftOut),
    };
}
