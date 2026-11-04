import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Button, type ButtonSize, type ButtonVariant } from '../../assets/components/Button';
import { expect, expectScreen, test, THEMES } from './fixtures';

/**
 * Les boutons de l'application, tous sur une page ; ses captures les gardent.
 */
const BUTTONS: { variant: ButtonVariant; size: ButtonSize }[] = [
    { variant: 'primary', size: 'md' },
    { variant: 'secondary', size: 'md' },
    { variant: 'ghost', size: 'md' },
    { variant: 'danger', size: 'md' },
    { variant: 'primary', size: 'sm' },
    { variant: 'secondary', size: 'sm' },
];

const ICON_BUTTONS: { variant: ButtonVariant; size: ButtonSize; token: string }[] = [
    { variant: 'ghost', size: 'md', token: '--h-ctl' },
    { variant: 'secondary', size: 'sm', token: '--h-ctl-sm' },
];

// L'icône des boutons qui n'en portent qu'une : un carré de 16 px.
const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"></svg>';

const LABEL = 'Envoyer sur Jira';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];

// La mise en page de la page des boutons, en style et non en classes : Tailwind ne lit que
// assets/ (app.css), et une classe écrite seulement ici ne se générerait pas.
const SHEET = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--s-4)',
    padding: 'var(--s-6)',
} as const;

for (const { variant, size, token } of ICON_BUTTONS) {
    test(`le bouton d’icône ${variant} ${size} est un carré de ${token}, l’icône entière`, async ({ page }) => {
        await page.goto('/');
        await page.evaluate(
            ([html, icon]) => {
                document.body.innerHTML = html;
                document.querySelector('button')?.insertAdjacentHTML('beforeend', icon);
            },
            [
                renderToStaticMarkup(
                    createElement(Button, { variant, size, iconOnly: true, 'aria-label': 'Jour suivant' }),
                ),
                ICON,
            ] as const,
        );
        const button = page.locator('button');
        const side = await page.evaluate(
            (name) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)),
            token,
        );

        // La marge d'un bouton à libellé écraserait l'icône.
        expect(await button.evaluate((element) => element.getBoundingClientRect().width)).toBe(side);
        expect(await button.evaluate((element) => element.getBoundingClientRect().height)).toBe(side);
        expect(await button.locator('svg').evaluate((element) => element.getBoundingClientRect().width)).toBe(16);
    });
}

for (const { scheme, name } of THEMES) {
    test(`la page des boutons, en ${name}`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('/');
        await page.evaluate(
            (html) => {
                document.body.innerHTML = html;
            },
            renderToStaticMarkup(
                createElement(
                    'main',
                    { style: SHEET },
                    // Les boutons à libellé : ceux d'icône sont gardés par leurs mesures, plus haut.
                    ...BUTTONS.map(({ variant, size }) =>
                        createElement(Button, { key: `${variant}-${size}`, variant, size }, LABEL),
                    ),
                    createElement(Button, { key: 'disabled', variant: 'primary', disabled: true }, LABEL),
                    createElement(
                        Button,
                        { key: 'pressed', variant: 'secondary', 'aria-pressed': true },
                        'Récapitulatif',
                    ),
                ),
            ),
        );

        await expectScreen(page, testInfo, `boutons-${name}.png`);
    });
}

for (const { scheme, name } of THEMES) {
    test(`le bouton principal survolé prend --btn-hover, en ${name}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('/');
        await page.evaluate(
            (html) => {
                document.body.innerHTML = html;
            },
            renderToStaticMarkup(createElement(Button, { variant: 'primary' }, LABEL)),
        );
        const button = page.getByRole('button', { name: LABEL });
        const colors = () =>
            button.evaluate((element) => {
                const style = getComputedStyle(element);

                return [style.backgroundColor, style.borderTopColor];
            });
        const token = await page.evaluate(() => {
            const probe = document.createElement('i');
            probe.style.color = 'var(--btn-hover)';
            document.body.append(probe);

            return getComputedStyle(probe).color;
        });

        const atRest = await colors();
        await button.hover();

        await expect.poll(colors).toEqual([token, token]);
        expect(atRest).not.toContain(token);
    });

    // Désactivé, ou indisponible mais encore focalisable (« aria-disabled ») : le survol
    // ne change rien. Chaque variante a son témoin actif, survolé juste avant : sans
    // animation, sa couleur change aussitôt, et l'inactif est lu dans les mêmes conditions.
    for (const [state, attributes] of [
        ['désactivé', { disabled: true }],
        ['indisponible', { 'aria-disabled': true }],
    ] as const) {
        test(`un bouton ${state} ne change pas au survol, en ${name}`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
            await page.goto('/');
            await page.evaluate(
                (html) => {
                    document.body.innerHTML = html;
                },
                renderToStaticMarkup(
                    createElement(
                        'main',
                        { style: SHEET },
                        ...VARIANTS.flatMap((variant) => [
                            createElement(
                                Button,
                                { key: `${variant}-actif`, variant, id: `${variant}-actif` },
                                variant,
                            ),
                            createElement(Button, { key: variant, variant, id: variant, ...attributes }, variant),
                        ]),
                    ),
                ),
            );
            const colors = (id: string) =>
                page.locator(`#${id}`).evaluate((element) => {
                    const style = getComputedStyle(element);

                    return [style.backgroundColor, style.borderTopColor];
                });

            for (const variant of VARIANTS) {
                const activeAtRest = await colors(`${variant}-actif`);
                await page.locator(`#${variant}-actif`).hover();
                expect(await colors(`${variant}-actif`), `${variant} actif`).not.toEqual(activeAtRest);

                const atRest = await colors(variant);
                // « force » : Playwright refuse de survoler un bouton désactivé.
                await page.locator(`#${variant}`).hover({ force: true });
                expect(await colors(variant), variant).toEqual(atRest);
            }
        });
    }
}
