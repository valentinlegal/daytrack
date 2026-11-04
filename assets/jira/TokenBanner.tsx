import { AlertBanner } from '../components/AlertBanner';
import type { JiraStatusSnapshot } from './jiraStatus';

/**
 * Le bandeau du jeton refusé : tout en haut de la fenêtre, sur toute sa largeur, tant que
 * Jira refuse le jeton. Il ne se ferme pas. Il tient sur une ligne : sous 1280 px, sa
 * seconde phrase s'efface.
 */
export function TokenBanner({ status, onUpdate }: { status: JiraStatusSnapshot; onUpdate: () => void }) {
    return (
        <AlertBanner
            action="Mettre à jour le jeton"
            detail="En attendant, DayTrack ne peut ni vérifier vos tickets ni envoyer vos heures."
            onAction={onUpdate}
        >
            {refusalSentence(status)}
        </AlertBanner>
    );
}

export function isTokenRefused({ state }: JiraStatusSnapshot): boolean {
    return state === 'refused' || state === 'missing_scope';
}

/**
 * Ce que Jira reproche au jeton : « Jira refuse le jeton enregistré, il a sans doute
 * expiré. », ou ce qui lui manque, quand on le sait.
 */
export function refusalSentence({ state, missingScopes }: JiraStatusSnapshot): string {
    if (state !== 'missing_scope') {
        return 'Jira refuse le jeton enregistré, il a sans doute expiré.';
    }
    const [last, ...others] = [...missingScopes].reverse();
    if (last === undefined) {
        return 'Jira refuse le jeton enregistré, il lui manque un périmètre.';
    }
    if (others.length === 0) {
        return `Jira refuse le jeton enregistré, il lui manque le périmètre ${last}.`;
    }

    return `Jira refuse le jeton enregistré, il lui manque les périmètres ${others.reverse().join(', ')} et ${last}.`;
}
