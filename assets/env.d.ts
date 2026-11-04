// Les feuilles de style s'importent pour leur effet : Encore les extrait du paquet.
declare module '*.css';

// Posées à la construction (webpack.config.js) : la version installée et son année.
declare const DAYTRACK_VERSION: string;
declare const DAYTRACK_BUILD_YEAR: number;
