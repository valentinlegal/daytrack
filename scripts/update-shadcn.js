#!/usr/bin/env node
/**
 * Met à jour les composants shadcn/ui depuis le registre officiel (new-york-v4).
 *
 * Usage :
 *   node scripts/update-shadcn.js           — met à jour tous les composants
 *   node scripts/update-shadcn.js button    — met à jour seulement button
 *
 * Le script :
 *   1. Récupère le JSON depuis https://ui.shadcn.com/r/styles/new-york-v4/<component>.json
 *   2. Extrait le contenu TypeScript (files[].type === "registry:ui")
 *   3. Adapte les imports pour le projet (supprime "use client", corrige les chemins)
 *   4. Écrit le fichier dans assets/components/ui/<component>.tsx
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const REGISTRY_BASE = 'https://ui.shadcn.com/r/styles/new-york-v4';
const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'components', 'ui');

/** Liste des composants gérés par ce projet */
const COMPONENTS = [
    'badge',
    'button',
    'collapsible',
    'context-menu',
    'dialog',
    'input',
    'scroll-area',
    'separator',
    'sheet',
    'tooltip',
];

/** Adaptations appliquées au code source récupéré depuis le registre */
function adapt(source) {
    return source
        // Supprime la directive Next.js (inutile hors Next)
        .replace(/^"use client"\s*\n/m, '')
        // Corrige l'import du composant Button interne (chemin registre → chemin projet)
        .replace(/@\/registry\/new-york-v4\/ui\//g, '@/components/ui/')
        // Normalise les guillemets doubles → simples pour cohérence avec le reste du projet
        // (conserve les guillemets dans les template literals et les JSX string attrs)
        .replace(/^(import .+) from "(.+)"/gm, (_, imp, mod) => `${imp} from '${mod}'`);
}

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                } else {
                    resolve(data);
                }
            });
        }).on('error', reject);
    });
}

async function updateComponent(name) {
    const url = `${REGISTRY_BASE}/${name}.json`;
    console.log(`  Fetching ${url}…`);

    const raw = await fetch(url);
    const json = JSON.parse(raw);

    const uiFile = json.files?.find((f) => f.type === 'registry:ui');
    if (!uiFile) {
        console.warn(`  ⚠ Aucun fichier registry:ui trouvé pour "${name}", ignoré.`);
        return;
    }

    const adapted = adapt(uiFile.content);
    const dest = path.join(OUTPUT_DIR, `${name}.tsx`);
    fs.writeFileSync(dest, adapted, 'utf8');
    console.log(`  ✓ ${path.relative(process.cwd(), dest)}`);
}

async function main() {
    const targets = process.argv.slice(2);
    const list = targets.length > 0 ? targets : COMPONENTS;

    console.log(`\nMise à jour de ${list.length} composant(s) shadcn/ui (new-york-v4)\n`);

    let ok = 0;
    let ko = 0;
    for (const name of list) {
        try {
            await updateComponent(name);
            ok++;
        } catch (err) {
            console.error(`  ✗ ${name}: ${err.message}`);
            ko++;
        }
    }

    console.log(`\nTerminé : ${ok} mis à jour${ko > 0 ? `, ${ko} erreur(s)` : ''}\n`);

    if (ko > 0) {
        console.warn(
            'Rappel : après mise à jour, vérifier les adaptations manuelles\n' +
            '(dirty detection JIRA, showCloseButton, imports project-specific).\n',
        );
        process.exit(1);
    }
}

main();
