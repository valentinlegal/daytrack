import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { clearDay, freezeTime, writeDay } from './day';
import { clickSlot, doubleClickSlot, expectGridMatchesBase, NEAR_LEFT, savedDay, ticketWindow } from './editing';
import { expect, refusedWith, test } from './fixtures';
import { connection, JIRA_ACCOUNT, JIRA_TICKETS } from './jira';

/**
 * Jira relié depuis l'application : la bienvenue, les réglages, le bandeau du jeton
 * refusé, et ce que la fenêtre de ticket apprend de Jira.
 *
 * L'état de la connexion est servi à la page (tests/e2e/jira.ts) : les parcours
 * tournent en même temps, et aucun ne relie pour de bon l'application de
 * développement. Tester une connexion, ou en voir une refusée, part vers le vrai
 * serveur et le Jira simulé, qui ne gardent rien.
 */

/**
 * Le jour d'un parcours : `index` jours après le lundi 4 mars 2024, que les autres
 * parcours ne prennent pas. Un samedi ou un dimanche est fermé à la saisie : un parcours
 * qui y saisit prend un jour de semaine.
 */
function day(index: number): string {
    return new Date(Date.UTC(2024, 2, 4 + index)).toISOString().slice(0, 10);
}

const EXPORT = JIRA_TICKETS['SHOP-482'];
const FILTRE = JIRA_TICKETS['SHOP-498'];

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function expectAccessible(page: Page): Promise<void> {
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations).toEqual([]);
}

/** La ligne d'état « Connecté à Jira en tant que… ». */
function connectedLine(page: Page) {
    return page.getByRole('status').filter({ hasText: 'Connecté à Jira en tant que' });
}

/** Ce que dit la section Jira modifiée quand on veut quitter la page. */
const LEAVE_MESSAGE = 'Enregistrez ou annulez vos modifications de Jira.';

/** Un jeton collé par-dessus les seize points. */
async function pasteToken(page: Page, token: string): Promise<void> {
    await page.getByLabel("Jeton d'API").focus();
    await page.keyboard.type(token);
}

async function fillConnection(page: Page, site: string, email: string, token: string): Promise<void> {
    await page.getByLabel('Adresse de Jira').fill(site);
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel("Jeton d'API").fill(token);
}

test.describe('la bienvenue', () => {
    test.use({ jira: { state: 'unlinked' } });

    test('tient lieu de journée tant que Jira n’est pas relié, l’aide repliée', async ({ page }) => {
        await page.goto(`/${day(0)}`);

        await expect(page.getByRole('heading', { name: 'Bienvenue dans DayTrack' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toHaveCount(0);
        // L'adresse ne dit pas un jour qu'on ne voit pas.
        await expect(page).toHaveURL(/\/bienvenue$/);
        await expect(page.getByLabel('Adresse de Jira')).toHaveAttribute(
            'placeholder',
            'https://exemple.atlassian.net',
        );
        const help = page.getByRole('button', { name: 'Comment créer un jeton' });
        await expect(help).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByText('Cochez ces trois périmètres.')).toHaveCount(0);
        await expectAccessible(page);

        await help.click();
        await expect(help).toHaveAttribute('aria-expanded', 'true');
        await expect(
            page.getByRole('link', { name: "la page des jetons d'API, dans un nouvel onglet" }),
        ).toHaveAttribute('href', 'https://id.atlassian.com/manage-profile/security/api-tokens');
        await expect(page.getByRole('link', { name: 'Son aide, dans un nouvel onglet' })).toHaveAttribute(
            'target',
            '_blank',
        );
        await expectAccessible(page);

        // Survolé, un lien de l'aide, comme « Comment créer un jeton », souligne de la
        // couleur de son texte.
        await page.mouse.move(0, 0);
        for (const link of [
            help,
            page.getByRole('link', { name: "la page des jetons d'API, dans un nouvel onglet" }),
        ]) {
            const underlined = () =>
                link.evaluate((node) => {
                    const style = getComputedStyle(node);

                    return style.textDecorationColor === style.color;
                });
            expect(await underlined()).toBe(false);
            await link.hover();
            await expect.poll(underlined).toBe(true);
            await page.mouse.move(0, 0);
        }
    });

    test('teste la connexion sans rien garder, et l’oublie dès qu’on retape', async ({ page }) => {
        await page.route('**/api/jira/test', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 800));
            await route.fallback();
        });
        await page.goto(`/${day(1)}`);
        await fillConnection(page, JIRA_ACCOUNT.site, JIRA_ACCOUNT.email, JIRA_ACCOUNT.token);
        const test = page.getByRole('button', { name: 'Tester la connexion' });
        const start = page.getByRole('button', { name: 'Commencer' });

        // Le temps que Jira réponde : la roue, l'autre bouton et les champs attendent.
        await test.click();
        await expect(test).toHaveAttribute('aria-busy', 'true');
        await expect(test.locator('.spin')).toBeVisible();
        await expect(start).toHaveAttribute('aria-disabled', 'true');
        for (const label of ['Adresse de Jira', 'Adresse e-mail', "Jeton d'API"]) {
            await expect(page.getByLabel(label)).toHaveAttribute('readonly', '');
        }

        await expect(connectedLine(page)).toHaveText(`Connecté à Jira en tant que ${JIRA_ACCOUNT.name}.`);
        await expect(test).not.toHaveAttribute('aria-busy', 'true');
        await expect(test.locator('.spin')).toHaveCount(0);
        await expect(start).not.toHaveAttribute('aria-disabled', 'true');
        await expect(page.getByLabel('Adresse de Jira')).not.toHaveAttribute('readonly', '');
        await expect(page.getByRole('heading', { name: 'Bienvenue dans DayTrack' })).toBeVisible();

        await page.getByLabel('Adresse e-mail').fill('autre@daytrack.test');
        await expect(page.getByText('Connecté à Jira en tant que')).toHaveCount(0);
    });

    test.describe('refusée', () => {
        test.use({ expectedErrors: [refusedWith(422)] });

        test('dit le refus sous son champ, y pose le curseur, et garde la saisie', async ({ page }) => {
            await page.goto(`/${day(2)}`);
            await fillConnection(page, JIRA_ACCOUNT.site, JIRA_ACCOUNT.email, 'jeton-expire');

            await page.getByRole('button', { name: 'Tester la connexion' }).click();

            const token = page.getByLabel("Jeton d'API");
            await expect(token).toHaveAttribute('aria-invalid', 'true');
            await expect(token).toHaveAccessibleDescription(
                'Jira refuse cette adresse e-mail ou ce jeton. Vérifiez-les, ou créez un nouveau jeton.',
            );
            await expect(token).toBeFocused();
            await expect(token).toHaveValue('jeton-expire');
            await expect(page.getByLabel('Adresse e-mail')).toHaveValue(JIRA_ACCOUNT.email);

            // Taper de nouveau efface le refus.
            await token.press('End');
            await token.press('Backspace');
            await expect(token).not.toHaveAttribute('aria-invalid', 'true');
        });

        test('refuse un jeton à qui il manque un périmètre, et une adresse que Jira ne sert pas', async ({ page }) => {
            await page.goto(`/${day(3)}`);
            await fillConnection(page, JIRA_ACCOUNT.site, JIRA_ACCOUNT.email, 'jeton-de-la-v1');

            await page.getByRole('button', { name: 'Commencer' }).click();

            await expect(page.getByLabel("Jeton d'API")).toHaveAccessibleDescription(
                'Il manque à ce jeton un périmètre dont DayTrack a besoin. Créez-en un nouveau avec read:jira-work, write:jira-work et read:jira-user.',
            );
            await expect(page.getByRole('heading', { name: 'Bienvenue dans DayTrack' })).toBeVisible();

            await page.getByLabel('Adresse de Jira').fill('https://inconnu.test');
            await page.getByRole('button', { name: 'Tester la connexion' }).click();

            const site = page.getByLabel('Adresse de Jira');
            await expect(site).toHaveAccessibleDescription('Jira ne répond pas à cette adresse. Vérifiez-la.');
            await expect(site).toBeFocused();
            await expectAccessible(page);
        });

        test('demande chaque champ laissé vide', async ({ page }) => {
            await page.goto(`/${day(4)}`);

            await page.getByRole('button', { name: 'Commencer' }).click();

            await expect(page.getByLabel('Adresse de Jira')).toHaveAccessibleDescription("Indiquez l'adresse de Jira.");
            await expect(page.getByLabel('Adresse e-mail')).toHaveAccessibleDescription(
                'Indiquez votre adresse e-mail.',
            );
            await expect(page.getByLabel('Adresse de Jira')).toBeFocused();
        });
    });

    test('commence : la connexion se garde une fois, et la journée s’ouvre', async ({ page }) => {
        const sent: string[] = [];
        await page.route('**/api/jira', async (route) => {
            if (route.request().method() !== 'PUT') {
                await route.fallback();

                return;
            }
            sent.push(route.request().postData() ?? '');
            await new Promise((resolve) => setTimeout(resolve, 300));
            await route.fulfill({ json: connection({ state: 'connected' }) });
        });
        await page.goto(`/${day(5)}`);
        await fillConnection(page, JIRA_ACCOUNT.site, JIRA_ACCOUNT.email, JIRA_ACCOUNT.token);

        await page.getByRole('button', { name: 'Commencer' }).dblclick();
        await page.getByLabel("Jeton d'API").press('Enter');

        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/${day(5)}$`));
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect(sent).toEqual([
            JSON.stringify({ site: JIRA_ACCOUNT.site, email: JIRA_ACCOUNT.email, token: JIRA_ACCOUNT.token }),
        ]);
    });

    test.describe('les périmètres', () => {
        test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

        test('se copient d’un clic, et « Copié » le dit deux secondes', async ({ page }) => {
            // L'heure ne passe qu'à la main : celle qui s'écoulerait entre deux lignes compterait dans les deux secondes.
            await freezeTime(page, day(7), '10:00');
            await page.goto(`/${day(6)}`);
            await page.getByRole('button', { name: 'Comment créer un jeton' }).click();

            await page.getByRole('button', { name: 'Copier write:jira-work' }).click();

            await expect(page.getByRole('tooltip')).toHaveText('Copié');
            await expect(page.getByRole('status')).toHaveText('write:jira-work copié');
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('write:jira-work');

            await page.clock.runFor(2000);
            await expect(page.getByRole('tooltip')).toHaveCount(0);
        });
    });
});

test.describe('le jeton refusé', () => {
    test.use({ jira: { state: 'refused' } });

    test('se dit tout en haut, et la saisie continue', async ({ page, request }) => {
        const date = day(10);
        await clearDay(request, date);
        await page.goto(`/${date}`);

        const banner = page.getByRole('alert');
        await expect(banner).toHaveText(
            'Jira refuse le jeton enregistré, il a sans doute expiré. En attendant, DayTrack ne peut ni vérifier vos tickets ni envoyer vos heures.Mettre à jour le jeton',
        );
        await expectAccessible(page);

        // SHOP-498 n'est ni dans la journée ni en favori : l'écran ne le connaît pas.
        await doubleClickSlot(page, '09:00');
        const window = ticketWindow(page);
        const ticket = window.getByLabel('Ticket');
        await ticket.fill('SHOP-498');
        await expect(ticket).toHaveAccessibleDescription(
            'Impossible de vérifier ce ticket, Jira refuse le jeton enregistré.',
        );
        await expect(ticket).not.toHaveAttribute('aria-invalid', 'true');
        await expect(window.getByRole('button', { name: 'Enregistrer' })).not.toHaveAttribute('aria-disabled', 'true');
        await window.getByRole('button', { name: 'Enregistrer' }).click();

        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([
            { start: '09:00', end: '09:15', kind: 'work', ticket: 'SHOP-498', comment: null },
        ]);
        await clearDay(request, date);
    });

    test('perd sa seconde phrase sous 1280 px', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 720 });
        await page.goto(`/${day(11)}`);

        await expect(page.getByRole('alert')).toContainText('il a sans doute expiré.');
        await expect(page.getByText('En attendant, DayTrack ne peut ni vérifier')).toBeHidden();
    });

    test('ouvre les réglages sur le jeton, et y ramène au même jour', async ({ page }) => {
        const date = day(12);
        await page.goto(`/${date}`);

        await page.getByRole('button', { name: 'Mettre à jour le jeton' }).click();

        await expect(page).toHaveURL(/\/reglages$/);
        const token = page.getByLabel("Jeton d'API");
        await expect(token).toBeFocused();
        await expect(token).toHaveAccessibleDescription(
            'Jira refuse le jeton enregistré, il a sans doute expiré. Créez-en un nouveau, puis collez-le ici.',
        );
        await expect(page.getByText('Connecté à Jira en tant que')).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);

        await page.getByRole('link', { name: 'Retour à la journée' }).click();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();
    });
});

test.describe('le périmètre qui manque au jeton', () => {
    test.use({ jira: { state: 'missing_scope', missingScopes: ['read:jira-user'] } });

    test('se nomme dans le bandeau et sous le champ du jeton', async ({ page }) => {
        await page.goto(`/${day(13)}`);

        await expect(page.getByRole('alert')).toContainText(
            'Jira refuse le jeton enregistré, il lui manque le périmètre read:jira-user.',
        );

        await page.getByRole('button', { name: 'Mettre à jour le jeton' }).click();
        await expect(page.getByLabel("Jeton d'API")).toHaveAccessibleDescription(
            'Il manque à ce jeton un périmètre dont DayTrack a besoin. Créez-en un nouveau avec read:jira-work, write:jira-work et read:jira-user.',
        );
        // Dans les réglages, l'aide est fermée.
        await expect(page.getByRole('button', { name: 'Comment créer un jeton' })).toHaveAttribute(
            'aria-expanded',
            'false',
        );
    });
});

test.describe('les réglages', () => {
    test('s’ouvrent par l’engrenage, montrent le compte, jamais le jeton, et se quittent par Échap', async ({
        page,
    }) => {
        const date = day(20);
        await page.goto(`/${date}`);

        await page.getByRole('button', { name: 'Réglages' }).click();

        await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
        await expect(connectedLine(page)).toHaveText(`Connecté à Jira en tant que ${JIRA_ACCOUNT.name}.`);
        await expect(page.getByLabel('Adresse de Jira')).toHaveValue(JIRA_ACCOUNT.site);
        await expect(page.getByLabel('Adresse e-mail')).toHaveValue(JIRA_ACCOUNT.email);
        const token = page.getByLabel("Jeton d'API");
        await expect(token).toHaveAttribute('type', 'password');
        expect(await token.inputValue()).toHaveLength(16);
        expect(await token.inputValue()).not.toBe(JIRA_ACCOUNT.token);
        const save = page.getByRole('button', { name: 'Enregistrer' });
        await expect(save).toHaveAttribute('aria-disabled', 'true');
        await expectAccessible(page);

        // Le fond des réglages couvre toute la fenêtre, même quand la page est courte.
        expect(
            await page
                .getByRole('main')
                .locator('..')
                .evaluate((node) => node.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(page.viewportSize()?.height ?? 0);

        // Au focus, tout est sélectionné : un collage remplace le jeton.
        await token.focus();
        expect(await token.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([
            0, 16,
        ]);
        await page.keyboard.type('nouveau-jeton');
        await expect(save).not.toHaveAttribute('aria-disabled', 'true');
        await token.fill('');

        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();

        // Les flèches du navigateur y retournent et en reviennent.
        await page.goBack();
        await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();
    });

    test('montrent le survol de « Retour à la journée », comme un bouton discret', async ({ page }) => {
        await page.goto(`/${day(23)}`);
        await page.getByRole('button', { name: 'Réglages' }).click();
        const back = page.getByRole('link', { name: 'Retour à la journée' });
        const background = () => back.evaluate((node) => getComputedStyle(node).backgroundColor);

        expect(await background()).toBe('rgba(0, 0, 0, 0)');
        await back.hover();
        // --bg-hover, du thème clair.
        await expect.poll(background).toBe('rgb(241, 242, 244)');
    });

    test('rechargés, ramènent au jour d’où l’on venait', async ({ page }) => {
        const date = day(21);
        await page.goto(`/${date}`);
        await page.getByRole('button', { name: 'Réglages' }).click();
        await expect(page).toHaveURL(/\/reglages$/);

        await page.reload();
        await page.getByRole('link', { name: 'Retour à la journée' }).click();

        await expect(page).toHaveURL(new RegExp(`/${date}$`));
    });

    test('montrent la connexion sans attendre Jira, et gardent ce qu’on a tapé quand il répond', async ({ page }) => {
        await page.route('**/api/jira/check', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await route.fallback();
        });
        await page.goto(`/${day(22)}`);
        await page.getByRole('button', { name: 'Réglages' }).click();
        const checked = page.waitForResponse('**/api/jira/check');

        await expect(page.getByLabel('Adresse de Jira')).toHaveValue(JIRA_ACCOUNT.site);
        await expect(connectedLine(page)).toHaveCount(0);
        // La ligne d'état est déjà là, vide : le lecteur d'écran la lira quand Jira répondra.
        await expect(page.getByRole('form', { name: 'Connexion à Jira' }).getByRole('status')).toHaveText(['', '']);
        await page.getByLabel('Adresse e-mail').fill('autre@daytrack.test');
        await checked;

        await expect(page.getByLabel('Adresse e-mail')).toHaveValue('autre@daytrack.test');
        await expect(page.getByRole('button', { name: 'Enregistrer' })).not.toHaveAttribute('aria-disabled', 'true');
        await expect(connectedLine(page)).toHaveCount(0);
    });

    test('enregistrent une connexion testée, et repartent d’elle', async ({ page }) => {
        const sent: unknown[] = [];
        await page.route('**/api/jira', async (route) => {
            if (route.request().method() !== 'PUT') {
                await route.fallback();

                return;
            }
            sent.push(route.request().postDataJSON());
            await route.fulfill({ json: { ...connection({ state: 'connected' }), account: 'Camille Martin' } });
        });
        await page.goto('/reglages');
        await expect(connectedLine(page)).toBeVisible();
        // La ligne d'état reste en place : le lecteur d'écran la lit quand elle change, et
        // chaque enregistrement réussi y entre de nouveau, même au même compte.
        const announced = await connectedLine(page).evaluate((line) => {
            const added: string[] = [];
            new MutationObserver((records) => {
                for (const record of records) {
                    added.push(...[...record.addedNodes].map((node) => node.textContent ?? ''));
                }
            }).observe(line, { childList: true, subtree: true, characterData: true });
            Object.assign(window, { announced: added });

            return line.isConnected;
        });
        expect(announced).toBe(true);
        const save = page.getByRole('button', { name: 'Enregistrer' });

        await page.getByLabel('Adresse de Jira').fill('https://exemple.atlassian.net');
        await save.click();

        await expect(connectedLine(page)).toHaveText('Connecté à Jira en tant que Camille Martin.');
        // Il repasse grisé, le focus restant dessus : « disabled » le lui ferait perdre.
        await expect(save).toHaveAttribute('aria-disabled', 'true');
        await expect(save).not.toHaveAttribute('disabled');
        await expect(save).toBeFocused();
        // Le jeton n'a pas été recollé : il ne part pas, l'enregistré sert.
        expect(sent).toEqual([{ site: 'https://exemple.atlassian.net', email: JIRA_ACCOUNT.email }]);

        // Au même compte, la ligne se redit.
        await page.getByLabel('Adresse de Jira').fill('https://autre.atlassian.net');
        await page.keyboard.press('Enter');
        await expect.poll(() => sent).toHaveLength(2);
        await expect(save).toHaveAttribute('aria-disabled', 'true');
        await expect
            .poll(() => page.evaluate(() => (window as unknown as { announced: string[] }).announced))
            .toEqual(['Connecté à Jira en tant que Camille Martin.', 'Connecté à Jira en tant que Camille Martin.']);
        // La ligne d'état et le message d'une section qu'on quitte : deux régions, jamais plus.
        await expect(page.getByRole('form', { name: 'Connexion à Jira' }).getByRole('status')).toHaveCount(2);
    });

    test('ne laissent pas la vérification de l’ancien jeton, arrivée après un enregistrement, ramener le bandeau', async ({
        page,
    }) => {
        // Jira tarde à vérifier le jeton enregistré, et le refuse.
        await page.route('**/api/jira/check', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await route.fulfill({ json: { status: 'refused', account: null, missingScopes: [] } });
        });
        await page.route('**/api/jira', async (route) => {
            if (route.request().method() !== 'PUT') {
                await route.fallback();

                return;
            }
            await route.fulfill({ json: { ...connection({ state: 'connected' }), account: 'Camille Martin' } });
        });
        // Le bandeau paru, même un instant : la journée relit ses tickets en s'ouvrant, et
        // leur réponse l'effacerait aussitôt.
        await page.addInitScript(() => {
            Object.assign(window, { bannerSeen: false });
            new MutationObserver(() => {
                if (document.documentElement.textContent.includes('Mettre à jour le jeton')) {
                    Object.assign(window, { bannerSeen: true });
                }
            }).observe(document, { childList: true, subtree: true, characterData: true });
        });
        // Ouverts par leur adresse : seuls les réglages vérifient le jeton, pas la journée.
        const checked = page.waitForResponse('**/api/jira/check');
        await page.goto('/reglages');

        // Un nouveau jeton, enregistré avant la réponse.
        const token = page.getByLabel("Jeton d'API");
        await token.focus();
        await page.keyboard.type('nouveau-jeton');
        await page.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(connectedLine(page)).toHaveText('Connecté à Jira en tant que Camille Martin.');
        await checked;
        await page.waitForTimeout(200);

        await expect(connectedLine(page)).toHaveText('Connecté à Jira en tant que Camille Martin.');
        await expect(token).not.toHaveAttribute('aria-invalid', 'true');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => (window as unknown as { bannerSeen: boolean }).bannerSeen)).toBe(false);
    });

    test.describe('refusés', () => {
        test.use({ expectedErrors: [refusedWith(422)] });

        test('gardent l’ancienne connexion et disent le refus sous le jeton', async ({ page }) => {
            await page.goto('/reglages');
            const token = page.getByLabel("Jeton d'API");
            await token.focus();
            await page.keyboard.type('jeton-expire');

            await page.getByRole('button', { name: 'Enregistrer' }).click();

            await expect(token).toHaveAccessibleDescription(
                'Jira refuse cette adresse e-mail ou ce jeton. Vérifiez-les, ou créez un nouveau jeton.',
            );
            await expect(token).toBeFocused();
            await expect(token).toHaveValue('jeton-expire');
            await expect(page.getByText('Connecté à Jira en tant que')).toHaveCount(0);
        });

        test('ramènent la ligne d’état quand on retape l’adresse enregistrée', async ({ page }) => {
            await page.goto('/reglages');
            await expect(connectedLine(page)).toBeVisible();
            const site = page.getByLabel('Adresse de Jira');
            await site.fill('pas-une-adresse');
            await page.getByRole('button', { name: 'Enregistrer' }).click();
            const token = page.getByLabel("Jeton d'API");
            await expect(page.getByText('Connecté à Jira en tant que')).toHaveCount(0);
            await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);

            await site.fill(JIRA_ACCOUNT.site);

            await expect(connectedLine(page)).toHaveText(`Connecté à Jira en tant que ${JIRA_ACCOUNT.name}.`);
            await expect(site).not.toHaveAttribute('aria-invalid', 'true');
            await expect(token).not.toHaveAttribute('aria-invalid', 'true');
            await expect(page.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('aria-disabled', 'true');
        });

        for (const [gesture, leave] of [
            ['Échap', (page: Page) => page.keyboard.press('Escape')],
            [
                '« Retour à la journée »',
                (page: Page) => page.getByRole('link', { name: 'Retour à la journée' }).click(),
            ],
            ['le logo', (page: Page) => page.getByRole('link', { name: 'DayTrack' }).click()],
            ['la flèche du navigateur', (page: Page) => page.goBack()],
        ] as const) {
            test(`restent sur la page quand Jira refuse pendant qu’on part par ${gesture}`, async ({ page }) => {
                await page.route('**/api/jira', async (route) => {
                    if (route.request().method() === 'PUT') {
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    }
                    await route.fallback();
                });
                await page.goto(`/${day(24)}`);
                await page.getByRole('button', { name: 'Réglages' }).click();
                await expect(connectedLine(page)).toBeVisible();
                const token = page.getByLabel("Jeton d'API");
                await token.focus();
                await page.keyboard.type('jeton-expire');

                await page.getByRole('button', { name: 'Enregistrer' }).click();
                await leave(page);

                await expect(token).toHaveAccessibleDescription(
                    'Jira refuse cette adresse e-mail ou ce jeton. Vérifiez-les, ou créez un nouveau jeton.',
                );
                await expect(token).toBeFocused();
                await expect(token).toHaveValue('jeton-expire');
                await expect(page).toHaveURL(/\/reglages$/);
                await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
                // La section reste modifiée : elle le dit, en plus du refus.
                await expect(page.getByText(LEAVE_MESSAGE)).toBeVisible();
                await expect(page.getByRole('button', { name: 'Annuler' })).toBeVisible();
            });
        }

        test('gardent le message quand un enregistrement est refusé, le refus sous son champ', async ({ page }) => {
            await page.goto('/reglages');
            await expect(connectedLine(page)).toBeVisible();
            const token = page.getByLabel("Jeton d'API");
            await pasteToken(page, 'jeton-expire');
            await page.keyboard.press('Escape');
            await expect(page.getByText(LEAVE_MESSAGE)).toBeVisible();

            await page.getByRole('button', { name: 'Enregistrer' }).click();

            await expect(token).toHaveAccessibleDescription(/Jira refuse cette adresse e-mail ou ce jeton/);
            await expect(page.getByText(LEAVE_MESSAGE)).toBeVisible();
            await expect(page.getByRole('button', { name: 'Annuler' })).toBeVisible();

            // « Annuler » reprend tout : le refus part, la ligne d'état et les seize points reviennent.
            await page.getByRole('button', { name: 'Annuler' }).click();
            await expect(token).not.toHaveAttribute('aria-invalid', 'true');
            await expect(connectedLine(page)).toBeVisible();
            expect(await token.inputValue()).toHaveLength(16);
        });
    });

    test.describe('modifiés, qu’on quitte', () => {
        for (const [gesture, leave] of [
            ['Échap', (page: Page) => page.keyboard.press('Escape')],
            [
                '« Retour à la journée »',
                (page: Page) => page.getByRole('link', { name: 'Retour à la journée' }).click(),
            ],
            ['le logo', (page: Page) => page.getByRole('link', { name: 'DayTrack' }).click()],
            ['la flèche du navigateur', (page: Page) => page.goBack()],
        ] as const) {
            test(`retiennent sur la page par ${gesture}, et gardent le jeton collé`, async ({ page }) => {
                await page.goto(`/${day(26)}`);
                await page.getByRole('button', { name: 'Réglages' }).click();
                await expect(connectedLine(page)).toBeVisible();
                await pasteToken(page, 'nouveau-jeton');
                await expect(page.getByRole('button', { name: 'Annuler' })).toHaveCount(0);

                await leave(page);

                await expect(page.getByText(LEAVE_MESSAGE)).toBeVisible();
                await expect(page).toHaveURL(/\/reglages$/);
                await expect(page.getByLabel("Jeton d'API")).toHaveValue('nouveau-jeton');
                const save = page.getByRole('button', { name: 'Enregistrer' });
                await expect(save).toBeFocused();
                await expect(save).toHaveAccessibleDescription(LEAVE_MESSAGE);
                await expect(connectedLine(page)).toBeVisible();
                await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
            });
        }

        test('se défont par « Annuler », sans quitter la page, puis se quittent', async ({ page }) => {
            const date = day(27);
            await page.goto(`/${date}`);
            await page.getByRole('button', { name: 'Réglages' }).click();
            await expect(connectedLine(page)).toBeVisible();
            await page.getByLabel('Adresse de Jira').fill('https://exemple.atlassian.net');
            await pasteToken(page, 'nouveau-jeton');
            await page.keyboard.press('Escape');
            await expectAccessible(page);

            await page.getByRole('button', { name: 'Annuler' }).click();

            await expect(page.getByText(LEAVE_MESSAGE)).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Annuler' })).toHaveCount(0);
            await expect(page).toHaveURL(/\/reglages$/);
            await expect(page.getByLabel('Adresse de Jira')).toHaveValue(JIRA_ACCOUNT.site);
            expect(await page.getByLabel("Jeton d'API").inputValue()).toHaveLength(16);
            await expect(connectedLine(page)).toBeVisible();
            const save = page.getByRole('button', { name: 'Enregistrer' });
            await expect(save).toHaveAttribute('aria-disabled', 'true');
            await expect(save).toBeFocused();
            await expect(save).not.toHaveAttribute('aria-describedby');

            await page.keyboard.press('Escape');
            await expect(page).toHaveURL(new RegExp(`/${date}$`));
        });

        test('gardent le message tant qu’on modifie, le retirent revenus à la main, et le redisent', async ({
            page,
        }) => {
            await page.goto('/reglages');
            await expect(connectedLine(page)).toBeVisible();
            const email = page.getByLabel('Adresse e-mail');
            await email.fill('autre@daytrack.test');
            await page.keyboard.press('Escape');
            await expect(page.getByText(LEAVE_MESSAGE)).toBeVisible();

            await email.fill('encore-autre@daytrack.test');
            await expect(page.getByText(LEAVE_MESSAGE)).toBeVisible();

            await email.fill(JIRA_ACCOUNT.email);
            await expect(page.getByText(LEAVE_MESSAGE)).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Annuler' })).toHaveCount(0);

            // Modifier de nouveau ne dit rien : c'est quitter qui le dit.
            await email.fill('autre@daytrack.test');
            await expect(page.getByText(LEAVE_MESSAGE)).toHaveCount(0);

            await email.press('Escape');
            await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeFocused();
            await email.focus();
            await page.keyboard.press('Escape');
            await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeFocused();
        });

        test('retirent le message d’un jeton vidé, qui ne change plus rien', async ({ page }) => {
            const date = day(28);
            await page.goto(`/${date}`);
            await page.getByRole('button', { name: 'Réglages' }).click();
            await expect(connectedLine(page)).toBeVisible();
            await pasteToken(page, 'nouveau-jeton');
            await page.keyboard.press('Escape');
            await expect(page.getByText(LEAVE_MESSAGE)).toBeVisible();

            await page.getByLabel("Jeton d'API").fill('');

            await expect(page.getByText(LEAVE_MESSAGE)).toHaveCount(0);
            await page.keyboard.press('Escape');
            await expect(page).toHaveURL(new RegExp(`/${date}$`));
        });

        test('retirent le message une fois enregistrés, sans quitter la page', async ({ page }) => {
            await page.route('**/api/jira', async (route) => {
                if (route.request().method() !== 'PUT') {
                    await route.fallback();

                    return;
                }
                await route.fulfill({ json: connection({ state: 'connected' }) });
            });
            await page.goto('/reglages');
            await expect(connectedLine(page)).toBeVisible();
            await pasteToken(page, 'nouveau-jeton');
            await page.keyboard.press('Escape');
            const save = page.getByRole('button', { name: 'Enregistrer' });
            await expect(save).toBeFocused();

            await page.keyboard.press('Enter');

            await expect(page.getByText(LEAVE_MESSAGE)).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Annuler' })).toHaveCount(0);
            await expect(save).toHaveAttribute('aria-disabled', 'true');
            await expect(save).toBeFocused();
            await expect(page).toHaveURL(/\/reglages$/);
        });

        test('se montrent sous la barre quand la page a défilé loin d’eux', async ({ page }) => {
            await page.setViewportSize({ width: 1024, height: 720 });
            await page.goto('/reglages');
            await expect(connectedLine(page)).toBeVisible();
            await pasteToken(page, 'nouveau-jeton');
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await page.getByRole('heading', { name: 'Apparence' }).click();

            await page.keyboard.press('Escape');

            const message = await page.getByText(LEAVE_MESSAGE).boundingBox();
            const save = await page.getByRole('button', { name: 'Enregistrer' }).boundingBox();
            const bar = await page.getByRole('banner').boundingBox();
            if (message === null || save === null || bar === null) {
                throw new Error('Le message ne se mesure pas.');
            }
            expect(message.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
            // Juste assez : le message arrive contre la barre, pas au milieu de la fenêtre.
            expect(message.y).toBeLessThan(bar.y + bar.height + 8);
            expect(save.y + save.height).toBeLessThanOrEqual(720);
        });

        test('font demander au navigateur s’il faut partir, sans rien faire tant que rien n’a changé', async ({
            page,
        }) => {
            const asked: string[] = [];
            page.on('dialog', (dialog) => {
                asked.push(dialog.type());
                void dialog.accept();
            });
            await page.goto('/reglages');
            await expect(connectedLine(page)).toBeVisible();
            await page.getByLabel('Adresse de Jira').click();
            await page.reload();
            await expect(connectedLine(page)).toBeVisible();
            expect(asked).toEqual([]);

            await pasteToken(page, 'nouveau-jeton');
            await page.reload();

            expect(asked).toEqual(['beforeunload']);
            await expect(connectedLine(page)).toBeVisible();
            expect(await page.getByLabel("Jeton d'API").inputValue()).toHaveLength(16);
        });

        test('avec un objectif habituel refusé seul, retiennent aussi par la flèche du navigateur', async ({
            page,
        }) => {
            await page.goto(`/${day(30)}`);
            await page.getByRole('button', { name: 'Réglages' }).click();
            await expect(connectedLine(page)).toBeVisible();
            const objective = page.getByRole('textbox', { name: 'Objectif habituel' });
            await objective.fill('8h10');

            await page.goBack();

            await expect(objective).toHaveAttribute('aria-invalid', 'true');
            await expect(objective).toHaveValue('8h10');
            await expect(objective).toBeFocused();
            await expect(page).toHaveURL(/\/reglages$/);
        });

        test('avec un objectif habituel refusé, disent les deux et posent le curseur sur la section Jira', async ({
            page,
        }) => {
            await page.goto('/reglages');
            await expect(connectedLine(page)).toBeVisible();
            await pasteToken(page, 'nouveau-jeton');
            const objective = page.getByRole('textbox', { name: 'Objectif habituel' });
            await objective.fill('8h10');

            await page.keyboard.press('Escape');

            await expect(page.getByText(LEAVE_MESSAGE)).toBeVisible();
            await expect(objective).toHaveAttribute('aria-invalid', 'true');
            await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeFocused();
            await expect(page).toHaveURL(/\/reglages$/);

            // Jira annulé, c'est l'objectif qui retient encore, le curseur sur lui.
            await page.getByRole('button', { name: 'Annuler' }).click();
            await page.keyboard.press('Escape');
            await expect(objective).toBeFocused();
            await expect(page).toHaveURL(/\/reglages$/);
        });
    });

    test('montrent l’attente de Jira quand on part par la flèche du navigateur', async ({ page }) => {
        await page.route('**/api/jira', async (route) => {
            if (route.request().method() !== 'PUT') {
                await route.fallback();

                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
            await route.fulfill({ json: connection({ state: 'connected' }) });
        });
        const date = day(29);
        await page.goto(`/${date}`);
        await page.getByRole('button', { name: 'Réglages' }).click();
        await expect(connectedLine(page)).toBeVisible();
        await page.getByLabel('Adresse de Jira').fill('https://exemple.atlassian.net');

        await page.getByRole('button', { name: 'Enregistrer' }).click();
        await page.goBack();

        await expect(page.getByRole('link', { name: 'Retour à la journée' })).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/${date}$`));
    });

    for (const [gesture, leave] of [
        ['Échap', (page: Page) => page.keyboard.press('Escape')],
        ['« Retour à la journée »', (page: Page) => page.getByRole('link', { name: 'Retour à la journée' }).click()],
        ['le logo', (page: Page) => page.getByRole('link', { name: 'DayTrack' }).click()],
    ] as const) {
        test(`attendent que Jira accepte avant de quitter la page par ${gesture}, sans rien demander`, async ({
            page,
        }) => {
            const asked: string[] = [];
            page.on('dialog', (dialog) => {
                asked.push(dialog.type());
                void dialog.dismiss();
            });
            await page.route('**/api/jira', async (route) => {
                if (route.request().method() !== 'PUT') {
                    await route.fallback();

                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
                await route.fulfill({ json: connection({ state: 'connected' }) });
            });
            await page.goto(`/${day(25)}`);
            await page.getByRole('button', { name: 'Réglages' }).click();
            await expect(connectedLine(page)).toBeVisible();
            await page.getByLabel('Adresse de Jira').fill('https://exemple.atlassian.net');

            await page.getByRole('button', { name: 'Enregistrer' }).click();
            await leave(page);

            // Il attend sa réponse, le lien le dit, et rien n'est quitté d'ici là.
            await expect(page.getByRole('link', { name: 'Retour à la journée' })).toHaveAttribute('aria-busy', 'true');
            await expect(page).toHaveURL(/\/reglages$/);
            await expect(page.getByRole('region', { name: 'Grille de la journée' })).toBeVisible();
            expect(asked).toEqual([]);
        });
    }

    test('laissent coller dans un champ de jeton vidé pendant que Jira vérifie l’ancien', async ({ page }) => {
        await page.route('**/api/jira/check', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await route.fallback();
        });
        const checked = page.waitForResponse('**/api/jira/check');
        await page.goto('/reglages');
        const token = page.getByLabel("Jeton d'API");
        await token.focus();
        await page.keyboard.press('Delete');
        await expect(token).toHaveValue('');
        await checked;
        await expect(connectedLine(page)).toBeVisible();

        await page.keyboard.type('nouveau-jeton');

        await expect(token).toHaveValue('nouveau-jeton');
    });

    test('remettent les points dans un champ de jeton vidé, sans toucher à l’ancien', async ({ page }) => {
        const sent: unknown[] = [];
        await page.route('**/api/jira', async (route) => {
            if (route.request().method() === 'PUT') {
                sent.push(route.request().postDataJSON());
            }
            await route.fallback();
        });
        await page.goto('/reglages');
        await expect(connectedLine(page)).toBeVisible();
        const token = page.getByLabel("Jeton d'API");
        const save = page.getByRole('button', { name: 'Enregistrer' });

        await token.focus();
        await page.keyboard.type('debut-de-jeton');
        await expect(save).not.toHaveAttribute('aria-disabled', 'true');
        await token.fill('');
        await expect(save).toHaveAttribute('aria-disabled', 'true');
        await page.getByLabel('Adresse e-mail').focus();

        expect(await token.inputValue()).toHaveLength(16);
        await expect(connectedLine(page)).toBeVisible();
        await expect(save).toHaveAttribute('aria-disabled', 'true');
        expect(sent).toEqual([]);

        // Au focus suivant, tout est de nouveau sélectionné : un collage remplace le jeton.
        await token.focus();
        expect(await token.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([
            0, 16,
        ]);
    });

    test('disent la vérification arrivée pendant qu’on tapait, une fois revenus à ce qui est enregistré', async ({
        page,
    }) => {
        await page.route('**/api/jira/check', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await route.fallback();
        });
        const checked = page.waitForResponse('**/api/jira/check');
        await page.goto('/reglages');
        const email = page.getByLabel('Adresse e-mail');
        await email.fill('autre@daytrack.test');
        await checked;
        await expect(connectedLine(page)).toHaveCount(0);

        await email.fill(JIRA_ACCOUNT.email);

        await expect(connectedLine(page)).toHaveText(`Connecté à Jira en tant que ${JIRA_ACCOUNT.name}.`);
    });

    test.describe('au jeton déjà refusé', () => {
        test.use({ jira: { state: 'refused' } });

        test('redisent le refus quand on revient à ce qui est enregistré', async ({ page }) => {
            await page.goto('/reglages');
            const token = page.getByLabel("Jeton d'API");
            const refusal =
                'Jira refuse le jeton enregistré, il a sans doute expiré. Créez-en un nouveau, puis collez-le ici.';
            await expect(token).toHaveAccessibleDescription(refusal);

            await token.fill('nouveau-jeton');
            await expect(token).not.toHaveAttribute('aria-invalid', 'true');
            await token.fill('');
            await page.getByLabel('Adresse e-mail').focus();

            await expect(token).toHaveAccessibleDescription(refusal);
            expect(await token.inputValue()).toHaveLength(16);
        });
    });
});

test.describe('la fenêtre Nouveau ticket', () => {
    test.use({ jira: { state: 'connected', unknown: 'not_found' } });

    test('cherche le ticket tapé dans Jira, et montre son titre à côté du champ', async ({ page, request }) => {
        const date = day(30);
        await clearDay(request, date);
        await page.route('**/api/tickets/SHOP-498/lookup', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            await route.fallback();
        });
        await page.goto(`/${date}`);
        await doubleClickSlot(page, '15:15');
        const window = ticketWindow(page);
        const ticket = window.getByLabel('Ticket');

        await ticket.fill('SHOP-498');

        await expect(window.getByText('Recherche dans Jira…')).toBeVisible();
        await expect(window.getByText(FILTRE?.title ?? '')).toBeVisible();
        await expect(ticket).toHaveAccessibleDescription(FILTRE?.title ?? '');
        await window.getByText(FILTRE?.title ?? '').hover();
        await expect(page.getByRole('tooltip')).toHaveText(`Story, ${FILTRE?.title ?? ''}`);
        await page.mouse.move(0, 0, { steps: 5 });
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await expectAccessible(page);

        await window.getByRole('button', { name: 'Enregistrer' }).click();
        await expect(window).toHaveCount(0);
        // Le bloc porte le titre que Jira a donné.
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText(FILTRE?.title ?? '');
        await clearDay(request, date);
    });

    test('refuse un ticket que Jira ne connaît pas, même au clic à côté', async ({ page, request }) => {
        const date = day(31);
        await clearDay(request, date);
        await page.goto(`/${date}`);
        await doubleClickSlot(page, '10:00');
        const window = ticketWindow(page);
        const ticket = window.getByLabel('Ticket');

        await ticket.fill('SHOP-999');

        await expect(ticket).toHaveAccessibleDescription("Ticket introuvable dans Jira. Vérifiez l'identifiant.");
        await expect(ticket).toHaveAttribute('aria-invalid', 'true');
        await expect(window.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('aria-disabled', 'true');
        await clickSlot(page, '16:00');
        await expect(window).toBeVisible();
        await ticket.press('Enter');
        await expect(window).toBeVisible();

        await ticket.fill('SHOP-482');
        await expect(ticket).not.toHaveAttribute('aria-invalid', 'true');
        await page.keyboard.press('Escape');
        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([]);
    });

    test('attend la réponse de Jira avant d’enregistrer', async ({ page, request }) => {
        const date = day(32);
        await clearDay(request, date);
        await page.route('**/api/tickets/*/lookup', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 800));
            await route.fallback();
        });
        await page.goto(`/${date}`);
        await doubleClickSlot(page, '11:00');
        const window = ticketWindow(page);
        const ticket = window.getByLabel('Ticket');

        // Introuvable : Entrée attend la réponse, puis montre le refus, sans rien écrire.
        await ticket.fill('SHOP-999');
        await ticket.press('Enter');
        await expect(window.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('aria-busy', 'true');
        await expect(ticket).toHaveAccessibleDescription("Ticket introuvable dans Jira. Vérifiez l'identifiant.");
        await expect(window).toBeVisible();

        // Trouvé : Entrée attend, puis enregistre, une fois. Un ticket qu'aucun favori des
        // parcours ne porte, pour que la page ne le connaisse pas d'avance.
        await ticket.fill('SHOP-519');
        await ticket.press('Enter');
        await ticket.press('Enter');
        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([
            { start: '11:00', end: '11:15', kind: 'work', ticket: 'SHOP-519', comment: null },
        ]);
        await expect(page.getByRole('list', { name: 'Saisies du jour' })).toContainText(
            JIRA_TICKETS['SHOP-519']?.title ?? '',
        );
        await clearDay(request, date);
    });

    test.describe('qui attend Jira', () => {
        test.use({ jira: { state: 'connected', unknown: 'not_found', lookupDelay: 1500 } });

        test('se tient comme pendant un envoi : rien ne s’y tape, rien ne la ferme ni n’en ouvre une autre', async ({
            page,
            request,
        }) => {
            const date = day(34);
            await writeDay(request, date, [
                { start: '09:00', end: '09:30', ticket: 'SHOP-519', comment: 'Reproduction' },
            ]);
            await page.goto(`/${date}`);

            // Chaque ticket tapé est inconnu de la page, ni favori ni de la journée : il se
            // cherche dans Jira. Une touche, Échap : ce qui part est ce que la fenêtre
            // montrait à l'Entrée.
            await doubleClickSlot(page, '11:00');
            let window = ticketWindow(page);
            await window.getByLabel('Ticket').fill('SHOP-530');
            await window.getByLabel('Ticket').press('Enter');
            await expect(window).toHaveAttribute('data-sending', '');
            await page.keyboard.press('2');
            await page.keyboard.press('Escape');
            await expect(window.getByLabel('Ticket')).toHaveValue('SHOP-530');
            await expect(window).toHaveCount(0);

            // La corbeille, la pause : le ticket changé s'enregistre, le bloc reste.
            await doubleClickSlot(page, '09:15');
            window = ticketWindow(page, 'Modifier le ticket');
            await window.getByLabel('Ticket').fill('SHOP-512');
            await window.getByLabel('Ticket').press('Enter');
            await window.getByRole('button', { name: 'Supprimer' }).click();
            await window.getByRole('button', { name: 'Convertir en pause' }).click();
            await expect(window).toHaveCount(0);

            // Un autre créneau : la fenêtre s'enregistre d'abord, puis l'autre s'ouvre, vide.
            await doubleClickSlot(page, '14:00');
            window = ticketWindow(page);
            await window.getByLabel('Ticket').fill('SHOP-531');
            await window.getByLabel('Ticket').press('Enter');
            await doubleClickSlot(page, '16:00', NEAR_LEFT);
            await expect(window).toContainText('de 16:00 à 16:15');
            await expect(window.getByLabel('Ticket')).toHaveValue('');
            await window.getByLabel('Ticket').fill('OPS-21');
            await window.getByLabel('Ticket').press('Enter');
            await expect(window).toHaveCount(0);

            expect(await savedDay(request, date)).toEqual([
                { start: '09:00', end: '09:30', kind: 'work', ticket: 'SHOP-512', comment: 'Reproduction' },
                { start: '11:00', end: '11:15', kind: 'work', ticket: 'SHOP-530', comment: null },
                { start: '14:00', end: '14:15', kind: 'work', ticket: 'SHOP-531', comment: null },
                { start: '16:00', end: '16:15', kind: 'work', ticket: 'OPS-21', comment: null },
            ]);
            await expectGridMatchesBase(page, request, date);
            await clearDay(request, date);
        });
    });
});

test.describe('Jira injoignable', () => {
    test.use({ jira: { state: 'connected', lookup: 'unreachable' } });

    test('laisse enregistrer le ticket, sans titre, avec un avertissement', async ({ page, request }) => {
        const date = day(24);
        await clearDay(request, date);
        await page.goto(`/${date}`);
        await doubleClickSlot(page, '09:30');
        const window = ticketWindow(page);
        const ticket = window.getByLabel('Ticket');

        await ticket.fill('PROJ-7');

        await expect(ticket).toHaveAccessibleDescription("Jira ne répond pas. Le ticket sera vérifié à l'envoi.");
        await expect(ticket).not.toHaveAttribute('aria-invalid', 'true');
        await ticket.press('Enter');
        await expect(window).toHaveCount(0);
        expect(await savedDay(request, date)).toEqual([
            { start: '09:30', end: '09:45', kind: 'work', ticket: 'PROJ-7', comment: null },
        ]);
        await clearDay(request, date);
    });
});

test.describe('les titres', () => {
    test('se lisent dans les blocs, les favoris et le récapitulatif', async ({ page, request }) => {
        const date = day(40);
        await writeDay(request, date, [
            { start: '09:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
            { start: '11:15', end: '11:30', ticket: 'SHOP-519', comment: 'Reproduction' },
        ]);
        await freezeTime(page, date, '15:20');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/${date}`);

        const blocks = page.getByRole('list', { name: 'Saisies du jour' });
        await expect(blocks.getByRole('listitem').first()).toContainText(EXPORT?.title ?? '');
        await expect(page.locator('[data-favorite]').first()).toContainText(EXPORT?.title ?? '');
        const recap = page.getByRole('region', { name: 'Tickets du jour' });
        await expect(recap).toContainText(`SHOP-482, Story`);
        await expect(recap).toContainText(EXPORT?.title ?? '');

        // Un bloc n'a pas d'infobulle : le récapitulatif écrit le titre coupé en entier,
        // et le lecteur d'écran lit le type et le titre dans le bloc.
        await page.clock.resume();
        const bug = blocks.getByRole('listitem').nth(1);
        await bug.hover();
        // Plus que le délai d'une infobulle, le pointeur toujours sur le bloc.
        await page.waitForTimeout(800);
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await expect(bug).toContainText('SHOP-519, Bug');
        await expect(bug).toContainText(JIRA_TICKETS['SHOP-519']?.title ?? '');
        await expect(recap).toContainText(JIRA_TICKETS['SHOP-519']?.title ?? '');
        await clearDay(request, date);
    });

    test('du favori qu’on ajoute se montre sous son champ', async ({ page }) => {
        await page.goto(`/${day(41)}`);
        await page
            .getByRole('complementary', { name: 'Favoris et calendrier' })
            .getByRole('button', { name: 'Ajouter un favori' })
            .click();

        await page.getByRole('textbox', { name: 'Nouveau favori' }).fill('SHOP-498');

        await expect(page.getByRole('group', { name: 'Nouveau favori' })).toContainText(
            JIRA_TICKETS['SHOP-498']?.title ?? '',
        );
    });

    test('du favori qu’on renomme est son texte indicatif', async ({ page }) => {
        await page.goto(`/${day(42)}`);
        const card = page.locator('[data-favorite]').filter({ hasText: 'SHOP-482' });

        await card.dblclick();

        await expect(page.getByRole('textbox', { name: 'Nom' })).toHaveAttribute('placeholder', EXPORT?.title ?? '');
    });
});

test('une page relue n’apprend jamais le jeton', async ({ page }) => {
    const bodies: string[] = [];
    page.on('response', (response) => {
        if (new URL(response.url()).pathname.startsWith('/api/')) {
            void response.text().then(
                (text) => bodies.push(text),
                () => undefined,
            );
        }
    });

    await page.goto('/reglages');
    await expect(connectedLine(page)).toBeVisible();

    expect(await page.content()).not.toContain(JIRA_ACCOUNT.token);
    for (const body of bodies) {
        expect(body).not.toContain(JIRA_ACCOUNT.token);
    }
});
