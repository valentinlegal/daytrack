import type { Locator, Page } from '@playwright/test';

const MONTHS = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
];

/** Le calendrier du mois, dans la colonne de gauche. */
export function calendar(page: Page): Locator {
    return page.getByRole('grid');
}

/** Un jour du calendrier, par le début de son libellé : « 8 septembre ». */
export function cell(page: Page, date: string): Locator {
    const label = `${String(Number(date.slice(8)))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;

    return calendar(page).getByRole('button', { name: new RegExp(`^${label}(,|$)`) });
}

/** La couleur du chiffre d'un jour du calendrier. */
export async function numberColor(day: Locator): Promise<string> {
    return day
        .locator(':scope > span')
        .first()
        .evaluate((number) => getComputedStyle(number).color);
}
