import type { Entry } from './day';

/**
 * Les journées d'exemple, saisie pour saisie : chaque scénario de l'écran Journée
 * s'y rejoue.
 */
const BASE: Entry[] = [
    { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
    { start: '09:30', end: '11:15', ticket: 'SHOP-482', comment: 'Mapping des colonnes' },
    { start: '11:15', end: '11:45', ticket: 'SHOP-519', comment: 'Reproduction' },
    { start: '11:45', end: '12:30', ticket: 'SHOP-482', comment: 'Tests' },
    { start: '12:30', end: '13:30' },
    { start: '13:30', end: '14:00', ticket: 'OPS-12', comment: 'Poker planning' },
    { start: '14:00', end: '15:15', ticket: 'SHOP-501' },
];

const FULL: Entry[] = [
    ...BASE.slice(0, 6),
    { start: '14:00', end: '16:15', ticket: 'SHOP-501' },
    { start: '16:15', end: '17:00', ticket: 'SHOP-377', comment: 'Revue de code' },
];

const ATTEINT: Entry[] = [...FULL, { start: '17:00', end: '17:45', ticket: 'SHOP-519', comment: 'Correctif' }];

const DEPASSE: Entry[] = [...ATTEINT, { start: '17:45', end: '18:30', ticket: 'OPS-7', comment: 'Astreinte' }];

const REMPLIE: Entry[] = [
    { start: '08:30', end: '08:45', ticket: 'OPS-21', comment: 'Alertes de la nuit' },
    { start: '08:45', end: '09:15', ticket: 'SHOP-530', comment: 'Analyse des logs' },
    { start: '09:15', end: '09:30', ticket: 'OPS-12', comment: 'Daily' },
    { start: '09:30', end: '09:45', ticket: 'SHOP-530', comment: 'Correctif' },
    { start: '09:45', end: '10:15', ticket: 'SHOP-482', comment: 'Revue de code' },
    { start: '10:15', end: '10:30', ticket: 'OPS-7', comment: 'Question client' },
    { start: '10:30', end: '11:00', ticket: 'SHOP-498', comment: 'Maquette du filtre' },
    { start: '11:00', end: '11:15', ticket: 'SHOP-519', comment: 'Reproduction' },
    { start: '11:15', end: '11:45', ticket: 'SHOP-498', comment: 'Requête de recherche' },
    { start: '11:45', end: '12:00', ticket: 'OPS-7', comment: 'Astreinte' },
    { start: '12:00', end: '12:30', ticket: 'SHOP-512', comment: 'Mise à jour de Vite' },
    { start: '12:30', end: '13:15' },
    { start: '13:15', end: '13:30', ticket: 'OPS-21', comment: 'Alerte disque' },
    { start: '13:30', end: '14:00', ticket: 'OPS-12', comment: 'Poker planning' },
    { start: '14:00', end: '14:15', ticket: 'SHOP-530', comment: 'Déploiement en recette' },
    { start: '14:15', end: '14:45', ticket: 'SHOP-498', comment: 'Tests unitaires' },
    { start: '14:45', end: '15:00', ticket: 'SHOP-519', comment: 'Correctif' },
    { start: '15:00', end: '15:15', ticket: 'OPS-7', comment: 'Question client' },
    { start: '15:15', end: '15:45', ticket: 'SHOP-482', comment: 'Tests' },
    { start: '15:45', end: '16:00', ticket: 'SHOP-512', comment: 'Revue' },
    { start: '16:00', end: '16:30', ticket: 'SHOP-377', comment: 'Revue de code' },
    { start: '16:30', end: '16:45', ticket: 'OPS-21', comment: 'Point sécurité' },
    { start: '16:45', end: '17:15', ticket: 'SHOP-498', comment: 'Corrections après revue' },
    { start: '17:15', end: '17:30', ticket: 'SHOP-519', comment: 'Vérification' },
];

export interface Scenario {
    /** Le nom de l'état de l'écran, celui de sa capture. */
    readonly name: string;
    readonly entries: readonly Entry[];
    /** L'heure qu'il est, le jour même ; null quand on regarde un jour passé. */
    readonly now: string | null;
    readonly recap: 'open' | 'closed';
    /** Un jour non travaillé — un samedi —, et non un jour de semaine. */
    readonly offDay?: true;
    /** Un jour de semaine mis à 0h00 dans la fenêtre Objectif du jour : un congé déclaré. */
    readonly declared?: true;
    /** Un jour à venir, regardé trois jours de semaine plus tôt. */
    readonly future?: true;
    /**
     * Le geste qui amène l'état, la journée ouverte : l'infobulle de « Jour suivant » sur
     * un vendredi, qui mène au lundi ; le calendrier passé au mois suivant, le dernier qui
     * s'ouvre, l'infobulle de « Mois précédent » ouverte ; la fenêtre Objectif du jour
     * ouverte, à 0h00.
     */
    readonly gesture?: 'next-day-tip' | 'month-limit' | 'objective-zero';
}

export const SCENARIOS: readonly Scenario[] = [
    { name: 'en-cours', entries: BASE, now: '15:20', recap: 'open' },
    { name: 'recap-ferme', entries: BASE, now: '15:20', recap: 'closed' },
    { name: 'vide', entries: [], now: '18:20', recap: 'open' },
    { name: 'remplie', entries: REMPLIE, now: '17:40', recap: 'open' },
    { name: 'atteint', entries: ATTEINT, now: '17:50', recap: 'open' },
    { name: 'depasse', entries: DEPASSE, now: '18:40', recap: 'open' },
    { name: 'passe', entries: FULL, now: null, recap: 'open' },
    { name: 'non-travaille', entries: [], now: null, recap: 'open', offDay: true },
    { name: 'fleche-jour', entries: FULL, now: null, recap: 'open', gesture: 'next-day-tip' },
    { name: 'calendrier-limite', entries: BASE, now: '15:20', recap: 'open', gesture: 'month-limit' },
    { name: 'objectif-zero', entries: [], now: null, recap: 'open', future: true, gesture: 'objective-zero' },
    { name: 'non-travaille-objectif', entries: [], now: null, recap: 'open', future: true, declared: true },
    {
        name: 'non-travaille-objectif-saisi',
        entries: [{ start: '09:00', end: '10:30', ticket: 'OPS-7', comment: 'Astreinte' }],
        now: null,
        recap: 'open',
        declared: true,
    },
];
