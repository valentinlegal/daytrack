import { readFileSync } from 'node:fs';

import Encore from '@symfony/webpack-encore';

// Les outils qui lisent ce fichier sans passer par la commande « encore ».
if (!Encore.isRuntimeEnvironmentConfigured()) {
    Encore.configureRuntimeEnvironment(process.env.NODE_ENV ?? 'dev');
}

Encore.setOutputPath('public/build/')
    .setPublicPath('/build')
    .addEntry('app', './assets/main.tsx')
    .splitEntryChunks()
    .enableSingleRuntimeChunk()
    .cleanupOutputBeforeBuild()
    .enableSourceMaps(!Encore.isProduction())
    .enableVersioning(Encore.isProduction())
    // Babel enlève les types ; c'est « tsc --noEmit », dans « npm run lint », qui
    // les vérifie. Une seule passe de compilation, la plus rapide.
    //
    // « development » dit à Babel pour quoi il compile : Encore ne le lui dit pas, et
    // Babel 8 se croit alors en développement. Il écrit des appels au JSX de mise au
    // point (jsxDEV), absent du React de production : la page ne se montait plus.
    .enableReactPreset((options) => {
        options.development = !Encore.isProduction();
    })
    .enableBabelTypeScriptPreset()
    // Tailwind, réduit aux tokens (assets/styles/app.css).
    .enablePostCssLoader()
    // Le dossier de sortie n'est jamais surveillé : il se réécrirait en boucle.
    .configureWatchOptions((options) => {
        options.ignored = /public[\\/]build|node_modules/;
    })
    // La version installée, tenue dans version.txt, et l'année où elle a été construite :
    // le pied des réglages les écrit, jamais d'après l'horloge du navigateur.
    .configureDefinePlugin((options) => {
        options.DAYTRACK_VERSION = JSON.stringify(
            readFileSync(new URL('./version.txt', import.meta.url), 'utf8').trim(),
        );
        options.DAYTRACK_BUILD_YEAR = JSON.stringify(new Date().getFullYear());
    });

export default Encore.getWebpackConfig();
