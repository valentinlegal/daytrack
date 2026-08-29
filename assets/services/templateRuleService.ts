import { t } from '@/i18n/fr';
import type {
    CreateTemplateRulePayload,
    TemplateRule,
    UpdateTemplateRulePayload,
} from '@/types/api';

const BASE = '/api/template-rules';

/** Extrait le message d'erreur du corps JSON `{ "error": "…" }`, avec repli i18n. */
async function readError(res: Response, fallbackKey: string): Promise<string> {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? t(fallbackKey);
}

/** Retourne toutes les règles (activées et désactivées), triées par position. */
export async function listTemplateRules(): Promise<TemplateRule[]> {
    const res = await fetch(BASE);
    if (!res.ok) throw new Error(t('templates.error.load'));
    return res.json() as Promise<TemplateRule[]>;
}

/** Crée une règle. Lève une Error avec le message serveur en cas d'échec (409 chevauchement, 422 ancrage…). */
export async function createTemplateRule(payload: CreateTemplateRulePayload): Promise<TemplateRule> {
    const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await readError(res, 'templates.error.save'));
    return res.json() as Promise<TemplateRule>;
}

/** Met à jour une règle (patch partiel — voir UpdateTemplateRulePayload). */
export async function updateTemplateRule(
    id: string,
    payload: UpdateTemplateRulePayload,
): Promise<TemplateRule> {
    const res = await fetch(`${BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await readError(res, 'templates.error.save'));
    return res.json() as Promise<TemplateRule>;
}

/** Supprime une règle. Tolère un 404 (déjà supprimée). */
export async function deleteTemplateRule(id: string): Promise<void> {
    const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
        throw new Error(await readError(res, 'templates.error.delete'));
    }
}
