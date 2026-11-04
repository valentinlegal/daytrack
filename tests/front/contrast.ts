/**
 * Le contraste de deux couleurs, selon WCAG 2.2 : de 1 (aucun) à 21 (noir sur blanc).
 */
export function contrastRatio(foreground: string, background: string): number {
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];

    return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);

    if (match === null) {
        throw new Error(`Couleur illisible : ${hex}`);
    }

    const [red, green, blue] = match.slice(1).map((channel) => {
        const value = parseInt(channel, 16) / 255;

        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
