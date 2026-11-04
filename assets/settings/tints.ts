/**
 * Les douze teintes d'un type de ticket, dans l'ordre de la palette : leur nom est celui
 * de data-color, comme le serveur les écrit (src/Settings/Tint.php).
 */
export const TINTS = [
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
] as const;

export type Tint = (typeof TINTS)[number];

/** Le nom d'une teinte, tel que l'écran l'écrit. */
export const TINT_NAMES: Readonly<Record<Tint, string>> = {
    rouge: 'Rouge',
    orange: 'Orange',
    ambre: 'Ambre',
    olive: 'Olive',
    vert: 'Vert',
    sarcelle: 'Sarcelle',
    cyan: 'Cyan',
    bleu: 'Bleu',
    violet: 'Violet',
    magenta: 'Magenta',
    rose: 'Rose',
    gris: 'Gris',
};

/** Celle d'un type qui n'en a pas encore : un ticket sans type, ou que Jira n'a pas décrit. */
export const NO_TINT: Tint = 'gris';

export function isTint(value: unknown): value is Tint {
    return typeof value === 'string' && (TINTS as readonly string[]).includes(value);
}
