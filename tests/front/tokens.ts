import { readFileSync } from 'node:fs';

export type Theme = 'light' | 'dark';

/**
 * Les valeurs de tokens.css, thème par thème. Le sombre reprend le clair pour ce
 * qu'il ne redéfinit pas, comme dans le navigateur.
 */
export function readTokens(): Record<Theme, Map<string, string>> {
    const css = readFileSync(new URL('../../assets/styles/tokens.css', import.meta.url), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        '',
    );
    const light = declarations(block(css, ':root'));
    const dark = new Map([...light, ...declarations(block(css, '[data-theme="dark"]'))]);

    return { light, dark };
}

function block(css: string, selector: string): string {
    const start = css.indexOf(`${selector} {`);

    if (start === -1) {
        throw new Error(`Bloc absent de tokens.css : ${selector}`);
    }

    return css.slice(start, css.indexOf('}', start));
}

function declarations(css: string): Map<string, string> {
    return new Map(
        [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [name, value.trim()]),
    );
}
