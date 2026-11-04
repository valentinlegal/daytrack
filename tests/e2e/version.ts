import type { Locator, Page } from '@playwright/test';

/** La version d'exemple : aucune n'est publiée, tout parcours la sert à la page. */
export const AVAILABLE = '2.5.0';

export function updateButton(page: Page): Locator {
    return page.getByRole('button', { name: /^Nouvelle version disponible/ });
}

export function updateWindow(page: Page): Locator {
    return page.getByRole('dialog', { name: `DayTrack ${AVAILABLE} est disponible` });
}
