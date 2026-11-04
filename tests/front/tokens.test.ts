import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast';
import { readTokens, type Theme } from './tokens';

/**
 * Le contraste des tokens, vérifié par un test plutôt qu'à la main : un texte à 4,5:1 au
 * moins, un élément graphique qui porte une information à 3:1, dans les deux thèmes.
 * Chaque couple est un endroit où le design pose ce texte sur ce fond.
 */
const SURFACES = ['bg', 'bg-side', 'bg-raise', 'bg-hover', 'bg-press', 'bg-sel'];
const TINTS = [
    'rouge',
    'orange',
    'ambre',
    'olive',
    'vert',
    'sarcelle',
    'cyan',
    'bleu',
    'violet',
    'magenta',
    'rose',
    'gris',
];

const TEXT: [string, string][] = [
    ...['ink', 'ink-2', 'ink-3'].flatMap((ink) => SURFACES.map((surface): [string, string] => [ink, surface])),
    // Un bloc : titre, durée, commentaire, sur la teinte de son ticket.
    ...['ink', 'ink-2', 'ink-3'].flatMap((ink) => TINTS.map((tint): [string, string] => [ink, `c-${tint}-bg`])),
    ['on-btn', 'btn'],
    ['on-btn', 'btn-hover'],
    ['toast-ink-2', 'btn'],
    ['pause-ink', 'pause-bg'],
    ['ink', 'inc-bg'],
    // « Supprimer », un message d'erreur sous son champ, « Non envoyé » dans le récapitulatif.
    ['inc', 'bg'],
    ['inc', 'bg-side'],
    ['inc', 'bg-raise'],
];

const GRAPHICS: [string, string][] = [
    ['line-field', 'bg'],
    ['line-field', 'bg-raise'],
    ['now', 'bg'],
    ...['bg', 'bg-side', 'bg-raise'].map((surface): [string, string] => ['focus', surface]),
    // Les marques du calendrier et les pastilles du bouton Jira.
    ...['ok', 'warn', 'inc'].flatMap((mark) => ['bg', 'bg-side'].map((surface): [string, string] => [mark, surface])),
    // Le trait d'un ticket porte sa teinte : contre son fond et la grille, et en carré de
    // teinte dans les réglages, sur le bouton et dans la grille des teintes survolée.
    ...TINTS.flatMap((tint) =>
        [`c-${tint}-bg`, 'bg', 'bg-raise', 'bg-hover'].map((surface): [string, string] => [`c-${tint}-bar`, surface]),
    ),
];

const tokens = readTokens();

function token(theme: Theme, name: string): string {
    const found = tokens[theme].get(`--${name}`);

    if (found === undefined) {
        throw new Error(`Token absent : --${name}`);
    }

    return found;
}

function ratio(theme: Theme, foreground: string, background: string): number {
    return contrastRatio(token(theme, foreground), token(theme, background));
}

/**
 * Une couleur sous le voile d'une sélection, posé par-dessus les blocs, texte compris :
 * --sel-fill mêle un token à la transparence, et le navigateur le compose canal par canal.
 */
function underSelection(theme: Theme, name: string): string {
    const fill = token(theme, 'sel-fill');
    const veil = /var\(--([\w-]+)\)\s+([\d.]+)%/.exec(fill);

    if (veil === null) {
        throw new Error(`--sel-fill illisible : ${fill}`);
    }

    const [, over = '', percent = ''] = veil;
    const alpha = Number(percent) / 100;
    const channels = (hex: string): number[] => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
    const veiled = channels(token(theme, over));

    return `#${channels(token(theme, name))
        .map((channel, index) =>
            Math.round(channel * (1 - alpha) + (veiled[index] ?? 0) * alpha)
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`;
}

describe.each<Theme>(['light', 'dark'])('thème %s', (theme) => {
    it.each(TEXT)('texte --%s sur --%s : 4,5:1 au moins', (foreground, background) => {
        expect(ratio(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(GRAPHICS)('élément graphique --%s sur --%s : 3:1 au moins', (foreground, background) => {
        expect(ratio(theme, foreground, background)).toBeGreaterThanOrEqual(3);
    });

    // Un bloc sélectionné : le titre, la durée et le commentaire sous le voile de la sélection.
    it.each(TINTS.flatMap((tint) => ['ink', 'ink-2', 'ink-3'].map((ink): [string, string] => [ink, tint])))(
        'texte --%s sur la teinte %s sélectionnée : 4,5:1 au moins',
        (ink, tint) => {
            expect(
                contrastRatio(underSelection(theme, ink), underSelection(theme, `c-${tint}-bg`)),
            ).toBeGreaterThanOrEqual(4.5);
        },
    );

    // L'identifiant d'un ticket sur sa teinte : 5,6:1 en clair, 7,8:1 en sombre.
    it.each(TINTS)('identifiant sur la teinte %s', (tint) => {
        expect(ratio(theme, `c-${tint}-id`, `c-${tint}-bg`)).toBeGreaterThanOrEqual(theme === 'light' ? 5.6 : 7.8);
    });
});
