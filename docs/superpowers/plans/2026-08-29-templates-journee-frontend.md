# Templates de journée — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire la vue « Modèles » — une grille dédiée à 7 colonnes génériques Lundi→Dimanche qui édite les `TemplateRule` du backend (créer / éditer / récurrence / alternance / objectif du jour), visuellement distincte du mode jour réel.

**Architecture:** Une nouvelle route SPA `/modeles` monte `TemplatesPage`, qui charge `GET /api/template-rules` une fois et pilote 7 `TemplateColumn`. Chaque colonne dérive sa vue de la liste plate de règles via des helpers purs (`assets/utils/templateGrid.ts`), rend les blocs avec les composants visuels extraits de la timeline (`assets/components/timeline/blocks.tsx`), et réutilise **tel quel** le `EditPopover` existant pour la saisie ticket + autocomplete Jira + conversion en pause. Toute mutation appelle `assets/services/templateRuleService.ts` puis recharge la liste (volume faible, pas d'optimistic update). Undo/redo et copier/coller ne sont **pas** repris (hors scope V1).

**Tech Stack:** React 19 + TypeScript, react-router-dom v7, Tailwind v4, composants shadcn/ui (new-york-v4) déjà présents dans `assets/components/ui/`, build via Symfony Encore (`npm run dev` / `npm run watch` sur l'hôte).

Ce plan couvre uniquement le **frontend**. Le backend (entité `TemplateRule`, `TemplateRuleMatcher`, `DayMaterializer`, `TemplateRuleController`, endpoint `materialize`) est déjà livré et vérifié — voir `docs/superpowers/plans/2026-08-16-templates-journee-backend.md`. Le design validé est dans `docs/superpowers/specs/2026-08-16-templates-journee-design.md`.

**Pas de tests automatisés dans ce plan** (décision explicite, cohérente avec le plan backend : le projet n'a aujourd'hui aucune infrastructure de test front — ni Vitest, ni Jest, ni Testing Library). Chaque tâche se termine par une vérification manuelle : compilation (`npm run dev` ou `npx tsc --noEmit`), requêtes `curl` pour confirmer la forme des appels API, et clic dans le navigateur sur `https://daytrack.localhost/modeles`. La mise en place d'un runner de tests front est un choix à faire séparément.

## Global Constraints

- Tout le code frontend est en **TypeScript** (`.ts` / `.tsx`). Fichiers React → `.tsx`.
- Tous les messages visibles passent par `assets/i18n/fr.ts` via `t('clé.pointée')` — **jamais** de chaîne en dur dans un composant. Interpolation : `t('clé').replace('{n}', String(x))` (pattern existant, voir `assets/hooks/useJiraSync.ts:91`).
- Les dates locales ne sont **jamais** formatées via `toISOString()` (UTC) — utiliser `assets/utils/timeline.ts` (`today()`, `shiftDate()`, `formatLocalDate()`).
- **`sessionStorage`** préféré à `localStorage` pour l'état UI.
- Handlers clavier via `addEventListener` → **pattern `useRef`** (handler affecté à `ref.current` à chaque render, wrapper stable enregistré une fois avec `[]`).
- **Tailwind v4 — classes dynamiques interdites** : toute classe utilisée doit apparaître en dur dans un fichier source. Pour les couleurs de type de ticket, passer par `assets/config/ticketTypeColors.ts` (`getBlockColors`, `getTicketTypeStyle`) — jamais de `bg-${x}-50` construit.
- Config serveur lue via `data-*` sur `#app` (`assets/services/jiraService.ts:isJiraConfigured()`), jamais `window.*`.
- Imports via l'alias `@/` (= `assets/`), configuré dans `tsconfig.json` et `webpack.config.js`.
- Ne pas ajouter `"use client"`.
- Toutes les commandes backend s'exécutent dans le conteneur : `docker compose exec php <cmd>`. Le fichier SQLite de dev est `db/data_dev.db`. L'environnement doit tourner (`docker compose up --wait`).
- `npm` tourne sur l'**hôte** (Node 20, hors conteneur). `npm run dev` compile une fois ; `npm run watch` recompile en continu. Les artefacts (`public/build/`) sont gitignorés.
- Convention d'identifiants ISO-8601 pour les jours de semaine : **1 = lundi … 7 = dimanche** (comme `TemplateRule.weekday`). Attention : `Date.prototype.getDay()` renvoie **0 = dimanche** — toujours convertir (`js === 0 ? 7 : js`).

---

## Task 1: Types, i18n et client API `templateRuleService`

**Files:**
- Modify: `assets/types/api.ts` (ajout à la fin)
- Modify: `assets/i18n/fr.ts` (ajout d'une section `templates`)
- Create: `assets/services/templateRuleService.ts`

**Interfaces:**
- Consumes: rien (première tâche front).
- Produces :
  - `TemplateRuleType` (objet `const` + type), `TemplateRule`, `CreateTemplateRulePayload`, `UpdateTemplateRulePayload` dans `@/types/api`.
  - `listTemplateRules(): Promise<TemplateRule[]>`, `createTemplateRule(payload: CreateTemplateRulePayload): Promise<TemplateRule>`, `updateTemplateRule(id: string, payload: UpdateTemplateRulePayload): Promise<TemplateRule>`, `deleteTemplateRule(id: string): Promise<void>` dans `@/services/templateRuleService`.
  - Clés i18n sous `templates.*` (toutes définies ici, consommées par les tâches suivantes).

- [ ] **Step 1: Ajouter les types dans `assets/types/api.ts`**

Ajouter à la fin du fichier (après `VersionInfo`) :

```ts
// ── Templates de journée (règles récurrentes) ──────────────────────────────

export const TemplateRuleType = {
    WORK: 'work',
    BREAK: 'break',
    TARGET_OVERRIDE: 'target_override',
} as const;

export type TemplateRuleType = typeof TemplateRuleType[keyof typeof TemplateRuleType];

export interface TemplateRule {
    id: string;
    ruleType: TemplateRuleType;
    weekday: number;            // 1 = lundi … 7 = dimanche (ISO-8601)
    startTime: string | null;   // "HH:mm" — null pour TARGET_OVERRIDE
    durationMinutes: number | null; // null pour TARGET_OVERRIDE
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    targetMinutes: number | null; // uniquement TARGET_OVERRIDE
    intervalWeeks: number;      // 1 = toutes les semaines
    anchorDate: string;         // "YYYY-MM-DD"
    activeFrom: string;         // "YYYY-MM-DD" — figé à la création côté serveur
    activeUntil: string | null; // "YYYY-MM-DD"
    enabled: boolean;
    rotationGroupId: string | null;
    position: number;
}

export interface CreateTemplateRulePayload {
    ruleType: TemplateRuleType;
    weekday: number;
    startTime?: string | null;
    durationMinutes?: number | null;
    ticketKey?: string | null;
    ticketSummary?: string | null;
    ticketType?: string | null;
    comment?: string | null;
    targetMinutes?: number | null;
    intervalWeeks?: number;
    anchorDate?: string | null;
    activeUntil?: string | null;
    enabled?: boolean;
    rotationGroupId?: string | null;
}

// Le PUT backend est un patch partiel ; ruleType et rotationGroupId ne sont pas modifiables
// (voir src/Dto/Input/UpdateTemplateRuleInput.php). Pour changer l'un ou l'autre, supprimer +
// recréer la règle (fait dans les tâches 7 et 8).
export interface UpdateTemplateRulePayload {
    startTime?: string | null;
    durationMinutes?: number | null;
    ticketKey?: string | null;
    ticketSummary?: string | null;
    ticketType?: string | null;
    comment?: string | null;
    targetMinutes?: number | null;
    weekday?: number;
    intervalWeeks?: number;
    anchorDate?: string;
    activeUntil?: string | null;
    enabled?: boolean;
}
```

- [ ] **Step 2: Ajouter la section `templates` dans `assets/i18n/fr.ts`**

Dans l'objet `fr`, après la section `favorites: { … },` et avant `jira: {`, insérer :

```ts
    templates: {
        nav: "Modèles",
        banner: "Semaine type — s'applique aux futurs jours vides",
        back_to_day: "Retour au jour",
        loading: "Chargement des modèles…",
        weekday: {
            "1": "Lundi",
            "2": "Mardi",
            "3": "Mercredi",
            "4": "Jeudi",
            "5": "Vendredi",
            "6": "Samedi",
            "7": "Dimanche",
        },
        target: {
            placeholder: "Défaut",
            hint: "Objectif du jour — vide = 7h30 par défaut",
            invalid: "Format invalide (ex : 6h30)",
        },
        block: {
            edit: "Éditer le ticket",
            convert_to_break: "Convertir en pause",
            convert_to_work: "Convertir en travail",
            disable: "Désactiver la règle",
            enable: "Activer la règle",
            delete: "Supprimer la règle",
            disabled_badge: "Désactivée",
        },
        recurrence: {
            menu: "Récurrence",
            every_week: "Toutes les semaines",
            every_n_weeks: "Une semaine sur {n}",
            set_end_date: "Ajouter une date de fin…",
            clear_end_date: "Retirer la date de fin",
            end_date_title: "Dernière semaine d'application",
            end_date_confirm: "Appliquer",
            cadence_tooltip: "Une semaine sur {n} — bloc {pos}/{size}",
        },
        stack: {
            title: "Ce créneau est déjà occupé",
            replace: "Remplacer le bloc existant",
            alternate: "Alterner une semaine sur deux",
            cancel: "Annuler",
            rotation_exists: "Ce créneau contient déjà une alternance. Supprimez d'abord l'un des deux blocs.",
            start_date_title: "À partir de quelle semaine démarre l'alternance ?",
            start_date_hint: "Jamais dans le passé — aujourd'hui par défaut.",
            confirm_alternate: "Créer l'alternance",
        },
        error: {
            load: "Impossible de charger les modèles",
            save: "Impossible d'enregistrer la règle",
            delete: "Impossible de supprimer la règle",
        },
    },
```

- [ ] **Step 3: Créer `assets/services/templateRuleService.ts`**

```ts
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
```

- [ ] **Step 4: Vérifier la compilation TypeScript**

Run (sur l'hôte, à la racine du projet) :
```bash
npx tsc --noEmit
```
Expected : aucune erreur (exit 0). Si `npx tsc` télécharge une version, laisser faire — `typescript` est en devDependency.

- [ ] **Step 5: Vérifier la forme de l'API réellement servie**

Prérequis : `docker compose up --wait`.

```bash
curl -sk https://daytrack.localhost/api/template-rules
```
Expected : `[]` (ou un tableau d'objets dont les clés correspondent **exactement** à l'interface `TemplateRule` de l'étape 1 : `id, ruleType, weekday, startTime, durationMinutes, ticketKey, ticketSummary, ticketType, comment, targetMinutes, intervalWeeks, anchorDate, activeFrom, activeUntil, enabled, rotationGroupId, position`).

```bash
curl -sk -X POST https://daytrack.localhost/api/template-rules \
  -H 'Content-Type: application/json' \
  -d '{"ruleType":"work","weekday":1,"startTime":"09:00","durationMinutes":15,"ticketKey":"DAILY"}'
```
Expected : `201`, JSON conforme à `TemplateRule`. Nettoyer ensuite :
```bash
curl -sk https://daytrack.localhost/api/template-rules | \
  docker compose exec -T php php -r '$r=json_decode(stream_get_contents(STDIN),true); foreach($r as $x){echo $x["id"],"\n";}' | \
  while read id; do curl -sk -X DELETE "https://daytrack.localhost/api/template-rules/$id"; done
curl -sk https://daytrack.localhost/api/template-rules   # -> []
```

- [ ] **Step 6: Commit**

```bash
git add assets/types/api.ts assets/i18n/fr.ts assets/services/templateRuleService.ts
git commit -m "feat: types, i18n et client API des règles récurrentes (front)"
```

---

## Task 2: Extraire les composants visuels de bloc de la timeline

**Files:**
- Create: `assets/components/timeline/blocks.tsx`
- Modify: `assets/components/timeline/Timeline.tsx`
- Modify: `assets/utils/timeline.ts` (ajout d'une constante exportée)

**Interfaces:**
- Consumes: rien.
- Produces :
  - `SLOT_PX: number` (= 36) exporté depuis `@/utils/timeline`.
  - `WorkBlock`, `PauseBlock` (composants) + `WorkBlockProps`, `PauseBlockProps` exportés depuis `@/components/timeline/blocks`. Signatures **identiques** à l'implémentation actuelle inline dans `Timeline.tsx` (la vue Modèles les réutilise pour dessiner les blocs de règle).

- [ ] **Step 1: Ajouter `SLOT_PX` dans `assets/utils/timeline.ts`**

Après la ligne `export const MAX_DAYS_AHEAD = 30;` ajouter :

```ts
/** Hauteur en pixels d'un créneau de 15 min dans les grilles (timeline jour + grille Modèles) */
export const SLOT_PX = 36;
```

- [ ] **Step 2: Créer `assets/components/timeline/blocks.tsx`**

Déplacer **verbatim** depuis `Timeline.tsx` : l'interface `WorkBlockProps`, la fonction `WorkBlock`, l'interface `PauseBlockProps`, la fonction `PauseBlock`. Remplacer les usages de la constante locale `SLOT_HEIGHT` par `SLOT_PX` importé. Le fichier complet :

```tsx
import { Coffee } from 'lucide-react';
import { formatMinutes, SLOT_PX } from '@/utils/timeline';
import { t } from '@/i18n/fr';

// Composants purement visuels d'un bloc de la grille (timeline jour + grille Modèles).
// Aucune logique d'interaction : positionnés en absolu par le parent via top/height.

export interface WorkBlockProps {
    top: number;
    height: number;
    slotCount: number;
    ticket: string;
    summary: string | null;
    comment: string | null;
    colors: { bg: string; bar: string; text: string; border: string; ring: string };
    runDurationMinutes: number;
    isSelected: boolean;
}

export function WorkBlock({ top, height, slotCount, ticket, summary, comment, colors, runDurationMinutes }: WorkBlockProps) {
    const single = slotCount === 1;
    const dur = formatMinutes(runDurationMinutes);

    return (
        <div
            className="absolute left-1 right-1 rounded-lg overflow-hidden flex"
            style={{
                top: top + 1,
                height: height - 1,
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                zIndex: 2,
            }}
        >
            {/* Barre colorée gauche */}
            <div className="w-1 shrink-0 self-stretch" style={{ background: colors.bar }} />

            {/* Corps */}
            <div className="relative flex flex-col flex-1 min-w-0 overflow-hidden px-3">
                {single ? (
                    /* Créneau unique — 3 colonnes : ID | [titre commentaire] | durée */
                    <div
                        className="grid items-center h-full min-w-0"
                        style={{ gridTemplateColumns: '80px minmax(0,1fr) auto', gap: '10px' }}
                    >
                        <span
                            className="font-mono text-[12.5px] font-semibold tabular-nums tracking-wide truncate"
                            style={{ color: colors.text }}
                        >
                            {ticket}
                        </span>
                        {/* Titre collé au commentaire — gap identique au gap externe ; titre coupé à 50% si commentaire */}
                        <div className="flex items-center min-w-0 overflow-hidden" style={{ gap: '16px' }}>
                            {(summary || !comment) && (
                                <span
                                    className="text-[12.5px] font-medium text-gray-800 truncate shrink-0"
                                    style={comment ? { maxWidth: '50%' } : undefined}
                                >
                                    {summary ?? ''}
                                </span>
                            )}
                            {comment && (
                                <span className="text-[12px] text-muted-foreground truncate flex-1 min-w-0">
                                    {comment}
                                </span>
                            )}
                        </div>
                        <span className="font-mono text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: 'oklch(0.556 0 0)' }}>
                            {dur}
                        </span>
                    </div>
                ) : (
                    /* Bloc multi-créneaux */
                    <>
                        <div
                            className="flex min-w-0"
                            style={{ gap: '10px', minHeight: SLOT_PX - 2 }}
                        >
                            <span
                                className="font-mono text-[12.5px] font-semibold tabular-nums tracking-wide truncate shrink-0"
                                style={{ color: colors.text, width: 80, paddingTop: 4 }}
                            >
                                {ticket}
                            </span>
                            <div className="flex flex-col min-w-0 overflow-hidden gap-px py-1">
                                {summary && (
                                    <span
                                        className="text-[13px] font-medium text-gray-800 leading-snug overflow-hidden"
                                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflowWrap: 'anywhere' }}
                                    >
                                        {summary}
                                    </span>
                                )}
                                {comment && (
                                    <span
                                        className="text-[12.5px] leading-snug overflow-hidden"
                                        style={{ color: 'oklch(0.556 0 0)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflowWrap: 'anywhere' }}
                                    >
                                        {comment}
                                    </span>
                                )}
                            </div>
                        </div>
                        {/* Durée absolue en bas à droite */}
                        <div className="absolute bottom-1 right-2 pointer-events-none">
                            <span
                                className="font-mono text-[11.5px] font-medium tabular-nums pl-1"
                                style={{ color: 'oklch(0.556 0 0)', background: colors.bg }}
                            >
                                {dur}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export interface PauseBlockProps {
    top: number;
    height: number;
    slotCount: number;
    runDurationMinutes: number;
}

export function PauseBlock({ top, height, runDurationMinutes }: PauseBlockProps) {
    const dur = formatMinutes(runDurationMinutes);
    const showDur = runDurationMinutes > 15;

    return (
        <div
            className="absolute left-1 right-1 rounded-lg overflow-hidden flex items-center justify-center"
            style={{
                top: top + 1,
                height: height - 1,
                background: 'repeating-linear-gradient(135deg,oklch(0.96 0 0) 0px,oklch(0.96 0 0) 6px,oklch(0.93 0 0) 6px,oklch(0.93 0 0) 7px)',
                border: '1px solid oklch(0.92 0 0)',
                zIndex: 2,
            }}
        >
            {/* Badge pill centré verticalement */}
            <div
                className="inline-flex items-center gap-2 bg-white rounded-full border border-gray-200"
                style={{ padding: '4px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', fontSize: 12 }}
            >
                <Coffee className="w-3.5 h-3.5 shrink-0" style={{ color: 'oklch(0.556 0 0)' }} />
                <span className="font-medium" style={{ color: 'oklch(0.145 0 0)' }}>{t('timeline.break_label')}</span>
                {showDur && (
                    <span className="font-mono tabular-nums" style={{ fontSize: 11.5, color: 'oklch(0.556 0 0)' }}>{dur}</span>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Réécrire `Timeline.tsx` pour importer depuis `blocks.tsx`**

Dans `assets/components/timeline/Timeline.tsx` :

1. Ajouter aux imports (près des autres imports `@/`) :
   ```ts
   import { SLOT_PX } from '@/utils/timeline';
   import { WorkBlock, PauseBlock } from './blocks';
   ```
   (garder l'import existant `import { … } from '@/utils/timeline';` et y ajouter `SLOT_PX`, ou ajouter une ligne séparée — au choix, l'important est que `SLOT_PX` soit importé une fois.)

2. Remplacer la ligne :
   ```ts
   const SLOT_HEIGHT = 36;
   ```
   par :
   ```ts
   const SLOT_HEIGHT = SLOT_PX;
   ```
   (on garde le nom local `SLOT_HEIGHT` pour ne pas toucher aux ~20 usages plus bas dans le fichier.)

3. **Supprimer** du bas du fichier : l'interface `WorkBlockProps`, la fonction `WorkBlock`, l'interface `PauseBlockProps`, la fonction `PauseBlock` (désormais dans `blocks.tsx`). **Garder** `NowIndicator` (spécifique à la timeline jour, non réutilisé).

4. Vérifier qu'il ne reste plus aucune référence à `WorkBlockProps` / `PauseBlockProps` non importée dans `Timeline.tsx` (les usages JSX `<WorkBlock … />` et `<PauseBlock … />` sont maintenant satisfaits par l'import de l'étape 1).

- [ ] **Step 4: Vérifier — compilation + non-régression de la vue jour**

Run :
```bash
npx tsc --noEmit
npm run dev
```
Expected : compilation sans erreur.

Dans le navigateur, ouvrir `https://daytrack.localhost/` (redirige vers aujourd'hui) :
- La timeline s'affiche normalement.
- Créer un bloc par clic-glisser sur 2-3 créneaux, saisir un ticket → le `WorkBlock` s'affiche à l'identique (barre colorée gauche, ID, durée).
- Clic droit sur le bloc → « Convertir en pause » → le `PauseBlock` hachuré avec le badge « Pause » s'affiche à l'identique.
- Supprimer le bloc de test (clic droit → Effacer).

- [ ] **Step 5: Commit**

```bash
git add assets/components/timeline/blocks.tsx assets/components/timeline/Timeline.tsx assets/utils/timeline.ts
git commit -m "refactor: extraire WorkBlock/PauseBlock de Timeline vers blocks.tsx"
```

---

## Task 3: Helpers purs de la grille Modèles (`templateGrid.ts`)

**Files:**
- Create: `assets/utils/templateGrid.ts`

**Interfaces:**
- Consumes: `TemplateRule`, `TemplateRuleType` (`@/types/api`) ; `generateTimeSlots`, `SLOT_MINUTES`, `shiftDate` (`@/utils/timeline`).
- Produces (tous purs, sans effet de bord) :
  - `GRID_SLOTS: string[]` — créneaux visibles de la grille (identiques à la timeline jour : `generateTimeSlots()`).
  - `WEEKDAYS: number[]` — `[1,2,3,4,5,6,7]`.
  - `weekdayLabel(iso: number): string`.
  - `timeToMinutes(hhmm: string): number` / `minutesToTime(min: number): string`.
  - `nextOccurrenceOnOrAfter(dateStr: string, iso: number): string` — première date `YYYY-MM-DD` tombant sur le jour `iso` à partir de `dateStr` (incluse).
  - `interface TemplateBlock { rule: TemplateRule; startSlotIndex: number; slotCount: number; rotationSize: number; rotationIndex: number; }`
  - `entryRulesForWeekday(rules: TemplateRule[], iso: number): TemplateRule[]` — règles WORK/BREAK **activées et désactivées** de ce jour, triées par `startTime` puis `position`.
  - `targetRuleForWeekday(rules: TemplateRule[], iso: number): TemplateRule | null`.
  - `buildColumnBlocks(rules: TemplateRule[], iso: number): TemplateBlock[]` — un `TemplateBlock` par règle WORK/BREAK du jour, positionné dans `GRID_SLOTS` ; les membres d'un même `rotationGroupId` reçoivent `rotationSize > 1` et `rotationIndex` (0-based, ordonné par `anchorDate`).
  - `findColumnOverlap(rules: TemplateRule[], iso: number, startMin: number, durMin: number, excludeId?: string): TemplateRule | null` — première règle WORK/BREAK **activée** du jour dont la plage `[startTime, startTime+durationMinutes)` recoupe `[startMin, startMin+durMin)` (bornes en minutes depuis 00:00), en ignorant `excludeId`.

- [ ] **Step 1: Créer `assets/utils/templateGrid.ts`**

```ts
import { TemplateRuleType } from '@/types/api';
import type { TemplateRule } from '@/types/api';
import { generateTimeSlots, SLOT_MINUTES, shiftDate } from '@/utils/timeline';
import { t } from '@/i18n/fr';

/** Créneaux visibles de la grille Modèles — mêmes bornes que la timeline jour (07:00 → 19:45). */
export const GRID_SLOTS: string[] = generateTimeSlots();

/** Jours de semaine ISO-8601 : 1 = lundi … 7 = dimanche. */
export const WEEKDAYS: number[] = [1, 2, 3, 4, 5, 6, 7];

export function weekdayLabel(iso: number): string {
    return t(`templates.weekday.${iso}`);
}

/** "HH:mm" → minutes depuis 00:00. */
export function timeToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/** minutes depuis 00:00 → "HH:mm" (borné 00:00–23:59). */
export function minutesToTime(min: number): string {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Jour ISO (1–7) d'une date "YYYY-MM-DD" — convertit le 0=dimanche de JS en 7. */
function isoWeekday(dateStr: string): number {
    const js = new Date(dateStr + 'T00:00:00').getDay();
    return js === 0 ? 7 : js;
}

/** Première date "YYYY-MM-DD" tombant sur le jour `iso` à partir de `dateStr` (incluse). */
export function nextOccurrenceOnOrAfter(dateStr: string, iso: number): string {
    const diff = (iso - isoWeekday(dateStr) + 7) % 7;
    return shiftDate(dateStr, diff);
}

export interface TemplateBlock {
    rule: TemplateRule;
    startSlotIndex: number; // index dans GRID_SLOTS
    slotCount: number;      // nombre de créneaux de 15 min couverts
    rotationSize: number;   // 1 si règle simple, N si membre d'une alternance
    rotationIndex: number;  // 0-based, ordonné par anchorDate ; 0 si règle simple
}

const GRID_START_MIN = timeToMinutes(GRID_SLOTS[0]!);
const GRID_END_MIN = timeToMinutes(GRID_SLOTS[GRID_SLOTS.length - 1]!) + SLOT_MINUTES;

/** Règles WORK/BREAK d'un jour (activées ou non), triées par startTime puis position. */
export function entryRulesForWeekday(rules: TemplateRule[], iso: number): TemplateRule[] {
    return rules
        .filter((r) => r.weekday === iso && r.ruleType !== TemplateRuleType.TARGET_OVERRIDE)
        .sort((a, b) => {
            const byTime = (a.startTime ?? '').localeCompare(b.startTime ?? '');
            return byTime !== 0 ? byTime : a.position - b.position;
        });
}

/** Règle TARGET_OVERRIDE d'un jour, ou null. */
export function targetRuleForWeekday(rules: TemplateRule[], iso: number): TemplateRule | null {
    return rules.find(
        (r) => r.weekday === iso && r.ruleType === TemplateRuleType.TARGET_OVERRIDE,
    ) ?? null;
}

/** Membres d'un groupe d'alternance, ordonnés par anchorDate croissant. */
function rotationMembers(rules: TemplateRule[], groupId: string): TemplateRule[] {
    return rules
        .filter((r) => r.rotationGroupId === groupId)
        .sort((a, b) => a.anchorDate.localeCompare(b.anchorDate));
}

/**
 * Un TemplateBlock par règle WORK/BREAK du jour, clampé dans GRID_SLOTS.
 * Les règles entièrement hors de la fenêtre visible (créées via l'API avec un
 * startTime avant 07:00 ou après 19:45) sont omises — cas limite, non atteignable
 * via l'UI de création qui ne laisse déposer que dans la grille.
 */
export function buildColumnBlocks(rules: TemplateRule[], iso: number): TemplateBlock[] {
    const blocks: TemplateBlock[] = [];

    for (const rule of entryRulesForWeekday(rules, iso)) {
        if (rule.startTime === null || rule.durationMinutes === null) continue;

        const startMin = timeToMinutes(rule.startTime);
        const endMin = startMin + rule.durationMinutes;
        if (endMin <= GRID_START_MIN || startMin >= GRID_END_MIN) continue; // hors fenêtre

        const clampedStart = Math.max(startMin, GRID_START_MIN);
        const clampedEnd = Math.min(endMin, GRID_END_MIN);
        const startSlotIndex = Math.round((clampedStart - GRID_START_MIN) / SLOT_MINUTES);
        const slotCount = Math.max(1, Math.round((clampedEnd - clampedStart) / SLOT_MINUTES));

        let rotationSize = 1;
        let rotationIndex = 0;
        if (rule.rotationGroupId !== null) {
            const members = rotationMembers(rules, rule.rotationGroupId);
            rotationSize = members.length;
            rotationIndex = Math.max(0, members.findIndex((m) => m.id === rule.id));
        }

        blocks.push({ rule, startSlotIndex, slotCount, rotationSize, rotationIndex });
    }

    return blocks;
}

/**
 * Première règle WORK/BREAK activée du jour dont la plage horaire recoupe
 * [startMin, startMin + durMin), en ignorant `excludeId`. null si le créneau est libre.
 */
export function findColumnOverlap(
    rules: TemplateRule[],
    iso: number,
    startMin: number,
    durMin: number,
    excludeId?: string,
): TemplateRule | null {
    const endMin = startMin + durMin;
    for (const rule of entryRulesForWeekday(rules, iso)) {
        if (!rule.enabled || rule.id === excludeId) continue;
        if (rule.startTime === null || rule.durationMinutes === null) continue;
        const s = timeToMinutes(rule.startTime);
        const e = s + rule.durationMinutes;
        if (startMin < e && s < endMin) return rule;
    }
    return null;
}
```

- [ ] **Step 2: Vérifier la compilation**

Run :
```bash
npx tsc --noEmit
```
Expected : exit 0.

- [ ] **Step 3: Vérifier le comportement des helpers par revue (aucun runner de test disponible)**

Relire `templateGrid.ts` et confirmer, table en main (grille = `07:00, 07:15, …, 19:45`, soit 52 créneaux, index 0 → `07:00`) :

| Appel | Attendu |
|---|---|
| `timeToMinutes('09:15')` | `555` |
| `minutesToTime(555)` | `'09:15'` |
| `nextOccurrenceOnOrAfter('2026-08-31', 3)` (lundi → mercredi) | `'2026-09-02'` |
| `nextOccurrenceOnOrAfter('2026-09-02', 3)` (mercredi, inclus) | `'2026-09-02'` |
| `buildColumnBlocks` avec 1 règle `{weekday:1,startTime:'09:00',durationMinutes:30}` | `[{ startSlotIndex: 8, slotCount: 2, rotationSize: 1, rotationIndex: 0 }]` (09:00 = 120 min après 07:00 = 8 créneaux) |
| `buildColumnBlocks` avec 2 règles même `rotationGroupId`, anchorDates `2026-09-02` et `2026-09-09` | 2 blocs, `rotationSize: 2`, `rotationIndex` `0` et `1` dans l'ordre des anchorDates |
| `findColumnOverlap(rules, 1, 540, 30)` avec une règle activée `09:00`–`09:15` | retourne cette règle (`540 < 555 && 540 < 570`) |
| `findColumnOverlap(rules, 1, 600, 30)` avec la même règle | `null` |

Ces helpers sont exercés visuellement en Task 4 (positionnement des blocs) et fonctionnellement en Tasks 6–8.

- [ ] **Step 4: Commit**

```bash
git add assets/utils/templateGrid.ts
git commit -m "feat: helpers purs de la grille Modèles"
```

---

## Task 4: Route `/modeles`, entrée de navigation, page Modèles en lecture seule

**Files:**
- Modify: `assets/components/App.tsx` (nouvelle route)
- Modify: `assets/components/layout/AppHeader.tsx` (icône d'accès)
- Create: `assets/components/templates/TemplatesPage.tsx`
- Create: `assets/components/templates/TemplateColumn.tsx`

**Interfaces:**
- Consumes: `listTemplateRules` (`@/services/templateRuleService`) ; `GRID_SLOTS`, `WEEKDAYS`, `weekdayLabel`, `buildColumnBlocks`, `targetRuleForWeekday` (`@/utils/templateGrid`) ; `WorkBlock`, `PauseBlock` (`@/components/timeline/blocks`) ; `SLOT_PX` (`@/utils/timeline`) ; `getBlockColors` (`@/config/ticketTypeColors`).
- Produces :
  - Route `/modeles` montant `TemplatesPage`.
  - `TemplatesPage` : charge les règles, affiche bandeau + fond teinté + 7 colonnes + gouttière d'heures. Expose `reload()` aux colonnes (consommé par les tâches 5–8).
  - `TemplateColumn` props : `{ iso: number; rules: TemplateRule[]; knownTickets: Record<string, JiraTicketInfo>; onChanged: () => void; }`. En Task 4, ne rend que l'en-tête (libellé jour) + le layer de blocs en lecture seule. `onChanged` est câblé mais inutilisé jusqu'à la Task 5.

- [ ] **Step 1: Ajouter la route dans `assets/components/App.tsx`**

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { today } from '@/utils/timeline';
import TimelinePage from './TimelinePage';
import TemplatesPage from './templates/TemplatesPage';

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to={`/${today()}`} replace />} />
            <Route path="/modeles" element={<TemplatesPage />} />
            <Route path="/:date" element={<TimelinePage />} />
        </Routes>
    );
}
```

(Le contrôleur backend `AppController` sert déjà la SPA pour tout chemin non `api/…` — `src/Controller/AppController.php`, requirement `^(?!api/).*` — aucune modification serveur nécessaire. `TimelinePage` rejette déjà `"modeles"` comme date invalide, mais la route explicite ci-dessus prime.)

- [ ] **Step 2: Ajouter l'icône d'accès dans `assets/components/layout/AppHeader.tsx`**

1. Ajouter aux imports :
   ```ts
   import { Link } from 'react-router-dom';
   import { CalendarClock, ChevronLeft, ChevronRight, FileText, LayoutGrid } from 'lucide-react';
   ```
   (remplacer la ligne d'import `lucide-react` existante pour y ajouter `LayoutGrid` ; si `LayoutGrid` n'existe pas dans la version installée, utiliser `CalendarRange` ou `Rows3` — vérifié au `npm run dev`.)

2. Dans le bloc `{/* ── Actions ── */}`, juste avant le bouton « rapport » (`onOpenReport`), insérer :
   ```tsx
   <Tooltip>
       <TooltipTrigger asChild>
           <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
               <Link to="/modeles" aria-label={t('templates.nav')}>
                   <LayoutGrid className="h-4 w-4" />
               </Link>
           </Button>
       </TooltipTrigger>
       <TooltipContent>{t('templates.nav')}</TooltipContent>
   </Tooltip>
   ```

- [ ] **Step 3: Créer `assets/components/templates/TemplateColumn.tsx`**

```tsx
import { useMemo } from 'react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { TemplateRuleType } from '@/types/api';
import { SLOT_PX } from '@/utils/timeline';
import { GRID_SLOTS, buildColumnBlocks, weekdayLabel } from '@/utils/templateGrid';
import { getBlockColors } from '@/config/ticketTypeColors';
import { WorkBlock, PauseBlock } from '@/components/timeline/blocks';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';

interface TemplateColumnProps {
    iso: number;
    rules: TemplateRule[];
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
}

/** Une colonne de la grille Modèles : en-tête (jour) + layer de blocs des règles. */
export default function TemplateColumn({ iso, rules }: TemplateColumnProps) {
    const blocks = useMemo(() => buildColumnBlocks(rules, iso), [rules, iso]);
    const gridHeight = GRID_SLOTS.length * SLOT_PX;

    return (
        <div className="flex flex-col min-w-[150px] flex-1 border-r border-amber-200/70 last:border-r-0">
            {/* En-tête de colonne */}
            <div className="h-9 flex items-center justify-center shrink-0 border-b border-amber-200/70">
                <span className="text-[13px] font-semibold text-amber-900/80">{weekdayLabel(iso)}</span>
            </div>

            {/* Corps : lignes de grille + blocs (positionnés en absolu) */}
            <div className="relative" style={{ height: gridHeight }}>
                {/* Lignes de grille */}
                {GRID_SLOTS.map((slot, idx) => (
                    <div
                        key={slot}
                        className="absolute left-0 right-0"
                        style={{
                            top: idx * SLOT_PX,
                            height: 1,
                            background: slot.endsWith(':00') ? 'oklch(0.88 0.03 90)' : 'oklch(0.93 0.02 90)',
                        }}
                    />
                ))}

                {/* Layer des blocs de règle */}
                {blocks.map(({ rule, startSlotIndex, slotCount, rotationSize, rotationIndex }) => {
                    const top = startSlotIndex * SLOT_PX;
                    const height = slotCount * SLOT_PX;
                    const runDurationMinutes = slotCount * 15;
                    const isBreak = rule.ruleType === TemplateRuleType.BREAK;

                    // Alternance : chaque membre occupe une moitié de la largeur, côte à côte.
                    const widthPct = 100 / rotationSize;
                    const leftPct = rotationIndex * widthPct;

                    return (
                        <div
                            key={rule.id}
                            className={cn('absolute', !rule.enabled && 'opacity-40 grayscale')}
                            style={{ top: 0, left: `${leftPct}%`, width: `${widthPct}%`, height: '100%' }}
                            title={
                                rotationSize > 1
                                    ? t('templates.recurrence.cadence_tooltip')
                                          .replace('{n}', String(rule.intervalWeeks))
                                          .replace('{pos}', String(rotationIndex + 1))
                                          .replace('{size}', String(rotationSize))
                                    : undefined
                            }
                        >
                            {isBreak ? (
                                <PauseBlock top={top} height={height} slotCount={slotCount} runDurationMinutes={runDurationMinutes} />
                            ) : (
                                <WorkBlock
                                    top={top}
                                    height={height}
                                    slotCount={slotCount}
                                    ticket={rule.ticketKey ?? ''}
                                    summary={rule.ticketSummary}
                                    comment={rule.comment}
                                    colors={getBlockColors(rule.ticketType)}
                                    runDurationMinutes={runDurationMinutes}
                                    isSelected={false}
                                />
                            )}

                            {rotationSize > 1 && (
                                <span
                                    className="absolute z-10 rounded bg-amber-900/80 px-1 text-[10px] font-semibold text-white"
                                    style={{ top: top + 3, right: 5 }}
                                >
                                    {rotationIndex + 1}/{rotationSize}
                                </span>
                            )}

                            {!rule.enabled && (
                                <span
                                    className="absolute z-10 left-2 rounded bg-gray-700/80 px-1 text-[10px] font-medium text-white"
                                    style={{ top: top + 3 }}
                                >
                                    {t('templates.block.disabled_badge')}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Créer `assets/components/templates/TemplatesPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { listTemplateRules } from '@/services/templateRuleService';
import { GRID_SLOTS, WEEKDAYS } from '@/utils/templateGrid';
import { SLOT_PX, today } from '@/utils/timeline';
import { TooltipProvider } from '@/components/ui/tooltip';
import { t } from '@/i18n/fr';
import TemplateColumn from './TemplateColumn';

export default function TemplatesPage() {
    const [rules, setRules] = useState<TemplateRule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function reload() {
        try {
            setRules(await listTemplateRules());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('templates.error.load'));
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        void reload();
    }, []);

    // Tickets déjà connus (titre + type) pour l'autocomplete du EditPopover, comme Timeline.
    const knownTickets = useMemo<Record<string, JiraTicketInfo>>(() => {
        const map: Record<string, JiraTicketInfo> = {};
        for (const r of rules) {
            if (r.ticketKey && r.ticketSummary && r.ticketType) {
                map[r.ticketKey] = { summary: r.ticketSummary, type: r.ticketType };
            }
        }
        return map;
    }, [rules]);

    const gridHeight = GRID_SLOTS.length * SLOT_PX;

    return (
        <TooltipProvider delayDuration={400}>
            <div className="h-screen flex flex-col overflow-hidden bg-amber-50">
                {/* En-tête dédié — distinct du header du mode jour */}
                <header className="shrink-0 h-14 flex items-center gap-4 px-5 border-b border-amber-200 bg-amber-100/60">
                    <Link
                        to={`/${today()}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 hover:text-amber-950"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        {t('templates.back_to_day')}
                    </Link>
                    <div className="h-5 w-px bg-amber-300" />
                    <span className="text-sm font-semibold text-amber-950">{t('templates.nav')}</span>
                </header>

                {/* Bandeau permanent */}
                <div className="shrink-0 px-5 py-2 text-[13px] text-amber-900 bg-amber-100/40 border-b border-amber-200">
                    {t('templates.banner')}
                </div>

                {/* Corps : gouttière d'heures + 7 colonnes, scroll vertical commun */}
                <div className="flex-1 overflow-auto">
                    {isLoading ? (
                        <div className="p-10 text-center text-sm text-amber-800/70">{t('templates.loading')}</div>
                    ) : error !== null ? (
                        <div className="p-10 text-center text-sm text-red-600">{error}</div>
                    ) : (
                        <div className="flex min-w-[1100px]">
                            {/* Gouttière d'heures */}
                            <div className="w-14 shrink-0 relative" style={{ height: gridHeight, marginTop: 36 }}>
                                {GRID_SLOTS.map((slot, idx) =>
                                    slot.endsWith(':00') ? (
                                        <span
                                            key={slot}
                                            className="absolute right-2 font-mono text-[11px] text-amber-900/60 select-none"
                                            style={{ top: idx * SLOT_PX - 6 }}
                                        >
                                            {slot.split(':')[0]}
                                        </span>
                                    ) : null,
                                )}
                            </div>

                            {WEEKDAYS.map((iso) => (
                                <TemplateColumn
                                    key={iso}
                                    iso={iso}
                                    rules={rules}
                                    knownTickets={knownTickets}
                                    onChanged={() => void reload()}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </TooltipProvider>
    );
}
```

(Note : `ArrowLeft` et `LayoutGrid` sont des icônes lucide standard ; si l'une manque dans la version `lucide-react` installée, la remplacer par n'importe quelle icône équivalente — l'échec est visible immédiatement au `npm run dev`.)

- [ ] **Step 5: Vérifier — compilation + affichage lecture seule**

Run :
```bash
npx tsc --noEmit
npm run dev
```

Créer un jeu de règles via l'API (aujourd'hui = un samedi dans l'exemple ; adapter les `weekday` librement) :
```bash
# WORK lundi 09:00 (+15 min)
curl -sk -X POST https://daytrack.localhost/api/template-rules -H 'Content-Type: application/json' \
  -d '{"ruleType":"work","weekday":1,"startTime":"09:00","durationMinutes":15,"ticketKey":"DAILY"}'
# BREAK mardi 12:00 (+60 min)
curl -sk -X POST https://daytrack.localhost/api/template-rules -H 'Content-Type: application/json' \
  -d '{"ruleType":"break","weekday":2,"startTime":"12:00","durationMinutes":60}'
# Règle désactivée : jeudi 15:00 (+30 min)
curl -sk -X POST https://daytrack.localhost/api/template-rules -H 'Content-Type: application/json' \
  -d '{"ruleType":"work","weekday":4,"startTime":"15:00","durationMinutes":30,"ticketKey":"REVIEW","enabled":false}'
```

Dans le navigateur :
- Depuis `https://daytrack.localhost/<aujourd'hui>`, cliquer l'icône « Modèles » du header → arrive sur `/modeles`.
- Fond ambré, bandeau « Semaine type — s'applique aux futurs jours vides », 7 colonnes Lundi→Dimanche, gouttière d'heures 07→19.
- Bloc `DAILY` en colonne Lundi à 09:00 (1 créneau) ; bloc « Pause » hachuré en colonne Mardi à 12:00 (4 créneaux) ; bloc `REVIEW` en colonne Jeudi grisé avec badge « Désactivée ».
- Le lien « Retour au jour » revient sur la timeline du jour.

Nettoyer :
```bash
curl -sk https://daytrack.localhost/api/template-rules | \
  docker compose exec -T php php -r '$r=json_decode(stream_get_contents(STDIN),true); foreach($r as $x){echo $x["id"],"\n";}' | \
  while read id; do curl -sk -X DELETE "https://daytrack.localhost/api/template-rules/$id"; done
```

- [ ] **Step 6: Commit**

```bash
git add assets/components/App.tsx assets/components/layout/AppHeader.tsx \
        assets/components/templates/TemplatesPage.tsx assets/components/templates/TemplateColumn.tsx
git commit -m "feat: vue Modèles en lecture seule (route, navigation, grille 7 jours)"
```

---

## Task 5: Objectif du jour éditable par colonne (`TARGET_OVERRIDE`)

**Files:**
- Modify: `assets/components/templates/TemplateColumn.tsx`

**Interfaces:**
- Consumes: `targetRuleForWeekday` (`@/utils/templateGrid`) ; `parseTarget`, `formatMinutes` (`@/utils/timeline`) ; `createTemplateRule`, `updateTemplateRule`, `deleteTemplateRule` (`@/services/templateRuleService`) ; `TemplateRuleType` (`@/types/api`).
- Produces: en-tête de colonne enrichi d'un champ objectif éditable. Vide = objectif par défaut (aucune règle `TARGET_OVERRIDE`). Saisir une valeur → `POST` (si aucune règle) ou `PUT` (si règle existante) ; vider → `DELETE`. Appelle `onChanged()` après chaque mutation.

- [ ] **Step 1: Ajouter le champ objectif dans `TemplateColumn.tsx`**

Remplacer l'intégralité du fichier `assets/components/templates/TemplateColumn.tsx` par :

```tsx
import { useMemo, useRef, useState } from 'react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { TemplateRuleType } from '@/types/api';
import { SLOT_PX, formatMinutes, parseTarget } from '@/utils/timeline';
import { GRID_SLOTS, buildColumnBlocks, targetRuleForWeekday, weekdayLabel } from '@/utils/templateGrid';
import { getBlockColors } from '@/config/ticketTypeColors';
import {
    createTemplateRule,
    deleteTemplateRule,
    updateTemplateRule,
} from '@/services/templateRuleService';
import { WorkBlock, PauseBlock } from '@/components/timeline/blocks';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';

interface TemplateColumnProps {
    iso: number;
    rules: TemplateRule[];
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
}

export default function TemplateColumn({ iso, rules, onChanged }: TemplateColumnProps) {
    const blocks = useMemo(() => buildColumnBlocks(rules, iso), [rules, iso]);
    const targetRule = useMemo(() => targetRuleForWeekday(rules, iso), [rules, iso]);
    const gridHeight = GRID_SLOTS.length * SLOT_PX;

    // ── Objectif du jour ──────────────────────────────────────────────────
    const [editingTarget, setEditingTarget] = useState(false);
    const [targetInput, setTargetInput] = useState('');
    const [targetError, setTargetError] = useState(false);
    const targetInputRef = useRef<HTMLInputElement>(null);

    function startEditingTarget() {
        setTargetInput(targetRule?.targetMinutes != null ? formatMinutes(targetRule.targetMinutes) : '');
        setTargetError(false);
        setEditingTarget(true);
        setTimeout(() => targetInputRef.current?.select(), 0);
    }

    async function saveTarget() {
        const raw = targetInput.trim();

        // Vidé → supprimer la règle TARGET_OVERRIDE si elle existe
        if (raw === '') {
            setEditingTarget(false);
            if (targetRule) {
                try {
                    await deleteTemplateRule(targetRule.id);
                    onChanged();
                } catch { /* service gère le message */ }
            }
            return;
        }

        const minutes = parseTarget(raw);
        if (minutes === null) { setTargetError(true); return; }
        setEditingTarget(false);
        if (targetRule && targetRule.targetMinutes === minutes) return;

        try {
            if (targetRule) {
                await updateTemplateRule(targetRule.id, { targetMinutes: minutes });
            } else {
                await createTemplateRule({
                    ruleType: TemplateRuleType.TARGET_OVERRIDE,
                    weekday: iso,
                    targetMinutes: minutes,
                });
            }
            onChanged();
        } catch { /* service gère le message */ }
    }

    function handleTargetKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') void saveTarget();
        else if (e.key === 'Escape') setEditingTarget(false);
    }

    return (
        <div className="flex flex-col min-w-[150px] flex-1 border-r border-amber-200/70 last:border-r-0">
            {/* En-tête : libellé jour + objectif */}
            <div className="h-9 flex items-center justify-between px-2 shrink-0 border-b border-amber-200/70">
                <span className="text-[13px] font-semibold text-amber-900/80">{weekdayLabel(iso)}</span>
                {editingTarget ? (
                    <input
                        ref={targetInputRef}
                        value={targetInput}
                        onChange={(e) => { setTargetInput(e.target.value); setTargetError(false); }}
                        onKeyDown={handleTargetKeyDown}
                        onBlur={() => void saveTarget()}
                        placeholder={t('templates.target.placeholder')}
                        className={cn(
                            'w-16 text-right text-[12px] font-medium outline-none border-b bg-transparent',
                            targetError ? 'border-destructive text-destructive' : 'border-amber-500 text-amber-950',
                        )}
                    />
                ) : (
                    <button
                        onClick={startEditingTarget}
                        title={t('templates.target.hint')}
                        className="text-[12px] font-medium text-amber-900/70 hover:text-amber-950 border-b border-dashed border-amber-400/50"
                    >
                        {targetRule?.targetMinutes != null
                            ? formatMinutes(targetRule.targetMinutes)
                            : t('templates.target.placeholder')}
                    </button>
                )}
            </div>

            {/* Corps : lignes de grille + blocs */}
            <div className="relative" style={{ height: gridHeight }}>
                {GRID_SLOTS.map((slot, idx) => (
                    <div
                        key={slot}
                        className="absolute left-0 right-0"
                        style={{
                            top: idx * SLOT_PX,
                            height: 1,
                            background: slot.endsWith(':00') ? 'oklch(0.88 0.03 90)' : 'oklch(0.93 0.02 90)',
                        }}
                    />
                ))}

                {blocks.map(({ rule, startSlotIndex, slotCount, rotationSize, rotationIndex }) => {
                    const top = startSlotIndex * SLOT_PX;
                    const height = slotCount * SLOT_PX;
                    const runDurationMinutes = slotCount * 15;
                    const isBreak = rule.ruleType === TemplateRuleType.BREAK;
                    const widthPct = 100 / rotationSize;
                    const leftPct = rotationIndex * widthPct;

                    return (
                        <div
                            key={rule.id}
                            className={cn('absolute', !rule.enabled && 'opacity-40 grayscale')}
                            style={{ top: 0, left: `${leftPct}%`, width: `${widthPct}%`, height: '100%' }}
                            title={
                                rotationSize > 1
                                    ? t('templates.recurrence.cadence_tooltip')
                                          .replace('{n}', String(rule.intervalWeeks))
                                          .replace('{pos}', String(rotationIndex + 1))
                                          .replace('{size}', String(rotationSize))
                                    : undefined
                            }
                        >
                            {isBreak ? (
                                <PauseBlock top={top} height={height} slotCount={slotCount} runDurationMinutes={runDurationMinutes} />
                            ) : (
                                <WorkBlock
                                    top={top}
                                    height={height}
                                    slotCount={slotCount}
                                    ticket={rule.ticketKey ?? ''}
                                    summary={rule.ticketSummary}
                                    comment={rule.comment}
                                    colors={getBlockColors(rule.ticketType)}
                                    runDurationMinutes={runDurationMinutes}
                                    isSelected={false}
                                />
                            )}

                            {rotationSize > 1 && (
                                <span
                                    className="absolute z-10 rounded bg-amber-900/80 px-1 text-[10px] font-semibold text-white"
                                    style={{ top: top + 3, right: 5 }}
                                >
                                    {rotationIndex + 1}/{rotationSize}
                                </span>
                            )}
                            {!rule.enabled && (
                                <span
                                    className="absolute z-10 left-2 rounded bg-gray-700/80 px-1 text-[10px] font-medium text-white"
                                    style={{ top: top + 3 }}
                                >
                                    {t('templates.block.disabled_badge')}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Vérifier — compilation + cycle objectif**

Run :
```bash
npx tsc --noEmit
npm run dev
```

Navigateur, sur `/modeles` :
- Dans l'en-tête de la colonne **Vendredi**, cliquer sur « Défaut », saisir `6h30`, Entrée.
- L'en-tête affiche `6h30`.

```bash
curl -sk https://daytrack.localhost/api/template-rules
```
Expected : une règle `"ruleType":"target_override"`, `"weekday":5`, `"targetMinutes":390`.

- Recliquer sur `6h30`, tout effacer, Entrée → l'en-tête réaffiche « Défaut ».
```bash
curl -sk https://daytrack.localhost/api/template-rules   # -> []
```
- Ressaisir une valeur invalide (`abc`) → bordure rouge, pas d'appel réseau (vérifier l'onglet Réseau).

- [ ] **Step 3: Commit**

```bash
git add assets/components/templates/TemplateColumn.tsx
git commit -m "feat: objectif du jour éditable par colonne dans la vue Modèles"
```

---

## Task 6: Créer un bloc WORK/BREAK par clic-glisser

**Files:**
- Create: `assets/components/templates/TemplateCell.tsx`
- Modify: `assets/components/templates/TemplateColumn.tsx`

**Interfaces:**
- Consumes: `EditPopover` (`@/components/timeline/EditPopover`, réutilisé tel quel) ; `GRID_SLOTS`, `timeToMinutes`, `findColumnOverlap` (`@/utils/templateGrid`) ; `SLOT_MINUTES` (`@/utils/timeline`) ; `createTemplateRule` (`@/services/templateRuleService`) ; `EntryType`, `TemplateRuleType` (`@/types/api`).
- Produces :
  - `TemplateCell` : cellule transparente par créneau, gère le clic-glisser de sélection d'une plage contiguë dans **une** colonne. Props `{ slotIndex: number; isInDragRange: boolean; onDragStart: (i: number) => void; onDragEnter: (i: number) => void; }`.
  - `TemplateColumn` : sur fin de glisser (ou double-clic sur une cellule), ouvre `EditPopover` près du curseur ; à la sauvegarde, si le créneau est libre (`findColumnOverlap` → null), `POST` une règle `work`/`break` `intervalWeeks: 1` sans `anchorDate` (le backend calcule la prochaine occurrence). Si le créneau est occupé, ne fait rien en Task 6 (le prompt d'empilement arrive en Task 8 — laisser un `// TODO(task 8)` explicite).

- [ ] **Step 1: Créer `assets/components/templates/TemplateCell.tsx`**

```tsx
import { cn } from '@/lib/utils';
import { SLOT_PX } from '@/utils/timeline';

interface TemplateCellProps {
    slotIndex: number;
    isInDragRange: boolean;
    onDragStart: (slotIndex: number) => void;
    onDragEnter: (slotIndex: number) => void;
}

/**
 * Cellule d'interaction transparente d'un créneau de la grille Modèles.
 * Posée au-dessus du layer de blocs (pointer-events actifs) : gère le clic-glisser
 * de sélection d'une plage contiguë. Pas de multi-sélection ni de copier/coller
 * (hors scope V1 de la vue Modèles).
 */
export default function TemplateCell({ slotIndex, isInDragRange, onDragStart, onDragEnter }: TemplateCellProps) {
    return (
        <div
            className={cn(
                'absolute left-0 right-0 cursor-pointer',
                isInDragRange ? 'bg-amber-400/25' : 'hover:bg-amber-400/10',
            )}
            style={{ top: slotIndex * SLOT_PX, height: SLOT_PX }}
            onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                onDragStart(slotIndex);
            }}
            onMouseEnter={() => onDragEnter(slotIndex)}
        />
    );
}
```

- [ ] **Step 2: Brancher la création dans `TemplateColumn.tsx`**

Dans `assets/components/templates/TemplateColumn.tsx` :

1. Ajouter / compléter les imports (⚠️ `TemplateRuleType` est déjà importé depuis la Task 5 — ne pas le réimporter ; ajouter seulement `EntryType`, qui vient du callback `onSave` du `EditPopover`) :
   ```ts
   import { useEffect } from 'react';           // fusionner avec l'import react existant (useMemo, useRef, useState)
   import { EntryType } from '@/types/api';
   import { SLOT_MINUTES } from '@/utils/timeline'; // fusionner avec l'import '@/utils/timeline' existant
   import { timeToMinutes, findColumnOverlap } from '@/utils/templateGrid'; // fusionner avec l'import templateGrid existant
   import EditPopover from '@/components/timeline/EditPopover';
   import TemplateCell from './TemplateCell';
   ```

2. Après les états de l'objectif, ajouter l'état du glisser + du popover :
   ```ts
   // ── Création par clic-glisser ─────────────────────────────────────────
   const [dragAnchor, setDragAnchor] = useState<number | null>(null);
   const [dragCursor, setDragCursor] = useState<number | null>(null);
   const [pendingRange, setPendingRange] = useState<{ startIndex: number; count: number } | null>(null);
   const [popoverMouse, setPopoverMouse] = useState<{ x: number; y: number } | null>(null);

   const dragRange =
       dragAnchor !== null && dragCursor !== null
           ? { lo: Math.min(dragAnchor, dragCursor), hi: Math.max(dragAnchor, dragCursor) }
           : null;

   // Fin du glisser (mouseup n'importe où) → ouvre le popover sur la plage sélectionnée.
   useEffect(() => {
       if (dragAnchor === null) return;
       function onUp(e: MouseEvent) {
           const a = dragAnchor as number;
           const c = dragCursor ?? a;
           const lo = Math.min(a, c);
           const hi = Math.max(a, c);
           setPendingRange({ startIndex: lo, count: hi - lo + 1 });
           setPopoverMouse({ x: e.clientX, y: e.clientY });
           setDragAnchor(null);
           setDragCursor(null);
       }
       document.addEventListener('mouseup', onUp);
       return () => document.removeEventListener('mouseup', onUp);
   }, [dragAnchor, dragCursor]);

   function closePopover() {
       setPendingRange(null);
       setPopoverMouse(null);
   }

   async function handleCreateFromPopover(
       ticketKey: string | null,
       type: EntryType,
       comment: string | null,
       ticketSummary: string | null,
       ticketType: string | null,
   ) {
       if (pendingRange === null) return;
       const startTime = GRID_SLOTS[pendingRange.startIndex]!;
       const startMin = timeToMinutes(startTime);
       const durMin = pendingRange.count * SLOT_MINUTES;

       const overlap = findColumnOverlap(rules, iso, startMin, durMin);
       if (overlap !== null) {
           // TODO(task 8) : ouvrir le prompt d'empilement (Remplacer / Alterner / Annuler).
           closePopover();
           return;
       }

       const isBreak = type === EntryType.BREAK;
       try {
           await createTemplateRule({
               ruleType: isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
               weekday: iso,
               startTime,
               durationMinutes: durMin,
               intervalWeeks: 1,
               ...(isBreak ? {} : { ticketKey, ticketSummary, ticketType, comment }),
           });
           onChanged();
       } catch { /* service gère le message */ } finally {
           closePopover();
       }
   }
   ```

3. Dans le corps de la colonne (`<div className="relative" style={{ height: gridHeight }}>`), **après** le layer de blocs, ajouter le layer de cellules puis le popover :
   ```tsx
   {/* Layer de cellules d'interaction (au-dessus des blocs) */}
   <div className="absolute inset-0" style={{ zIndex: 5 }}>
       {GRID_SLOTS.map((_, idx) => (
           <TemplateCell
               key={idx}
               slotIndex={idx}
               isInDragRange={dragRange !== null && idx >= dragRange.lo && idx <= dragRange.hi}
               onDragStart={(i) => { setDragAnchor(i); setDragCursor(i); }}
               onDragEnter={(i) => setDragCursor((prev) => (dragAnchor === null ? prev : i))}
           />
       ))}
   </div>

   {pendingRange !== null && (
       <EditPopover
           slot={GRID_SLOTS[pendingRange.startIndex]!}
           entry={null}
           anchorTop={pendingRange.startIndex * SLOT_PX}
           scrollContainer={null}
           mousePos={popoverMouse}
           knownTickets={knownTickets}
           onSave={(ticketKey, type, comment, ticketSummary, ticketType) =>
               void handleCreateFromPopover(ticketKey, type, comment, ticketSummary, ticketType)
           }
           onCancel={closePopover}
           onClear={closePopover}
       />
   )}
   ```
   (`knownTickets` est déjà dans les props ; le retirer de la déstructuration `{ iso, rules, onChanged }` → `{ iso, rules, knownTickets, onChanged }`.)

- [ ] **Step 3: Vérifier — compilation + création WORK et BREAK**

Run :
```bash
npx tsc --noEmit
npm run dev
```

Navigateur, sur `/modeles` (partir d'une base vide : `curl` de nettoyage de la Task 4) :
- Colonne **Lundi** : cliquer-glisser de 09:00 à 09:30 (3 créneaux surlignés), relâcher → `EditPopover` s'ouvre près du curseur.
- Saisir `DAILY`, Entrée.
- Un `WorkBlock` `DAILY` apparaît en Lundi de 09:00 à 09:45 (3 créneaux).

```bash
curl -sk https://daytrack.localhost/api/template-rules
```
Expected : 1 règle `"ruleType":"work"`, `"weekday":1`, `"startTime":"09:00"`, `"durationMinutes":45`, `"intervalWeeks":1`, `"anchorDate"` sur un lundi, `"ticketKey":"DAILY"`.

- Colonne **Mardi** : glisser de 12:00 à 13:00, dans le popover cliquer « Convertir en pause » → un `PauseBlock` apparaît.
```bash
curl -sk https://daytrack.localhost/api/template-rules
```
Expected : une 2ᵉ règle `"ruleType":"break"`, `"weekday":2`, `"startTime":"12:00"`, `"durationMinutes":60`.

- Glisser sur un créneau **déjà occupé** (ex. Lundi 09:15) → le popover s'ouvre ; saisir un ticket → rien ne se crée (comportement Task 8 à venir), le popover se ferme.

- [ ] **Step 4: Commit**

```bash
git add assets/components/templates/TemplateCell.tsx assets/components/templates/TemplateColumn.tsx
git commit -m "feat: créer une règle par clic-glisser dans la vue Modèles"
```

---

## Task 7: Éditer un bloc — contenu, récurrence, activation, suppression

**Files:**
- Create: `assets/components/templates/TemplateBlockMenu.tsx`
- Modify: `assets/components/templates/TemplateColumn.tsx`

**Interfaces:**
- Consumes: composants `ContextMenu*` (`@/components/ui/context-menu`) ; `updateTemplateRule`, `deleteTemplateRule`, `createTemplateRule` (`@/services/templateRuleService`) ; `EditPopover` (réutilisé) ; `today`, `shiftDate` (`@/utils/timeline`) ; `TemplateRule`, `EntryType` (`@/types/api`).
- Produces :
  - `TemplateBlockMenu` : contenu de menu contextuel pour un bloc. Props `{ rule: TemplateRule; onEdit: () => void; onToggleType: () => void; onSetInterval: (n: number) => void; onSetEndDate: () => void; onClearEndDate: () => void; onToggleEnabled: () => void; onDelete: () => void; }`.
  - `TemplateColumn` : chaque bloc est enveloppé d'un `ContextMenu` déclenchant `TemplateBlockMenu`. Actions câblées :
    - Éditer → rouvre `EditPopover` pré-rempli ; sauvegarde → `PUT` `{ ticketKey, ticketSummary, ticketType, comment }` (ou `{}` → pas d'appel si BREAK inchangé).
    - Convertir en pause/travail → **supprimer + recréer** (le `PUT` ne change pas `ruleType`), en conservant `weekday/startTime/durationMinutes/intervalWeeks/anchorDate/activeUntil/enabled/rotationGroupId`.
    - Récurrence → « Toutes les semaines » = `PUT { intervalWeeks: 1 }` ; « Une semaine sur N » (N ∈ {2,3,4}) = `PUT { intervalWeeks: N }`.
    - Date de fin → mini-popover date (min = `today()`) → `PUT { activeUntil }` ; « Retirer la date de fin » = **supprimer + recréer** sans `activeUntil` (le `PUT` n'efface pas `activeUntil`).
    - Activer/Désactiver → `PUT { enabled: !rule.enabled }`.
    - Supprimer → `deleteTemplateRule(rule.id)` (le backend re-bascule automatiquement un éventuel dernier membre d'alternance en `intervalWeeks: 1`).

- [ ] **Step 1: Créer `assets/components/templates/TemplateBlockMenu.tsx`**

```tsx
import type { TemplateRule } from '@/types/api';
import { TemplateRuleType } from '@/types/api';
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { t } from '@/i18n/fr';

interface TemplateBlockMenuProps {
    rule: TemplateRule;
    onEdit: () => void;
    onToggleType: () => void;
    onSetInterval: (n: number) => void;
    onSetEndDate: () => void;
    onClearEndDate: () => void;
    onToggleEnabled: () => void;
    onDelete: () => void;
}

const INTERVAL_CHOICES = [1, 2, 3, 4];

export default function TemplateBlockMenu({
    rule,
    onEdit,
    onToggleType,
    onSetInterval,
    onSetEndDate,
    onClearEndDate,
    onToggleEnabled,
    onDelete,
}: TemplateBlockMenuProps) {
    const isBreak = rule.ruleType === TemplateRuleType.BREAK;

    return (
        <ContextMenuContent className="min-w-[220px]">
            {!isBreak && (
                <ContextMenuItem className="text-sm" onClick={onEdit}>
                    {t('templates.block.edit')}
                </ContextMenuItem>
            )}
            <ContextMenuItem className="text-sm" onClick={onToggleType}>
                {isBreak ? t('templates.block.convert_to_work') : t('templates.block.convert_to_break')}
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuSub>
                <ContextMenuSubTrigger className="text-sm">
                    {t('templates.recurrence.menu')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                    <ContextMenuRadioGroup value={String(rule.intervalWeeks)}>
                        {INTERVAL_CHOICES.map((n) => (
                            <ContextMenuRadioItem
                                key={n}
                                value={String(n)}
                                className="text-sm"
                                onClick={() => onSetInterval(n)}
                            >
                                {n === 1
                                    ? t('templates.recurrence.every_week')
                                    : t('templates.recurrence.every_n_weeks').replace('{n}', String(n))}
                            </ContextMenuRadioItem>
                        ))}
                    </ContextMenuRadioGroup>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-sm" onClick={onSetEndDate}>
                        {t('templates.recurrence.set_end_date')}
                    </ContextMenuItem>
                    {rule.activeUntil !== null && (
                        <ContextMenuItem className="text-sm" onClick={onClearEndDate}>
                            {t('templates.recurrence.clear_end_date')}
                        </ContextMenuItem>
                    )}
                </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuItem className="text-sm" onClick={onToggleEnabled}>
                {rule.enabled ? t('templates.block.disable') : t('templates.block.enable')}
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem variant="destructive" className="text-sm" onClick={onDelete}>
                {t('templates.block.delete')}
            </ContextMenuItem>
        </ContextMenuContent>
    );
}
```

(Vérifier que `ContextMenuRadioGroup` est bien exporté par `@/components/ui/context-menu` — sinon retirer le wrapper `ContextMenuRadioGroup` et garder les `ContextMenuRadioItem` seuls, ou utiliser `ContextMenuCheckboxItem checked={rule.intervalWeeks === n}`.)

- [ ] **Step 2: Câbler le menu et l'édition dans `TemplateColumn.tsx`**

Dans `assets/components/templates/TemplateColumn.tsx` :

1. Imports :
   ```ts
   import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
   import { today, shiftDate } from '@/utils/timeline';
   import TemplateBlockMenu from './TemplateBlockMenu';
   ```

2. État d'édition d'un bloc existant + mini-prompt de date de fin :
   ```ts
   // ── Édition d'un bloc existant ────────────────────────────────────────
   const [editingRule, setEditingRule] = useState<TemplateRule | null>(null);
   const [editMouse, setEditMouse] = useState<{ x: number; y: number } | null>(null);
   const [endDateRuleId, setEndDateRuleId] = useState<string | null>(null);
   const [endDateValue, setEndDateValue] = useState('');

   function openEdit(rule: TemplateRule, e: React.MouseEvent) {
       setEditMouse({ x: e.clientX, y: e.clientY });
       setEditingRule(rule);
   }

   async function saveEdit(
       ticketKey: string | null,
       type: EntryType,
       comment: string | null,
       ticketSummary: string | null,
       ticketType: string | null,
   ) {
       const rule = editingRule;
       setEditingRule(null);
       if (rule === null) return;
       try {
           // Le EditPopover ne renvoie WORK que pour un ticket saisi ; la conversion
           // en pause depuis ce bouton passe par recreateWithType (PUT ne change pas ruleType).
           if (type === EntryType.BREAK && rule.ruleType !== EntryType.BREAK) {
               await recreateWithType(rule, EntryType.BREAK);
           } else {
               await updateTemplateRule(rule.id, { ticketKey, ticketSummary, ticketType, comment });
           }
           onChanged();
       } catch { /* service gère */ }
   }

   /** Supprime puis recrée une règle avec un ruleType différent (PUT ne le modifie pas). */
   async function recreateWithType(rule: TemplateRule, nextType: EntryType) {
       const isBreak = nextType === EntryType.BREAK;
       await deleteTemplateRule(rule.id);
       await createTemplateRule({
           ruleType: isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
           weekday: rule.weekday,
           startTime: rule.startTime,
           durationMinutes: rule.durationMinutes,
           intervalWeeks: rule.intervalWeeks,
           anchorDate: rule.anchorDate,
           activeUntil: rule.activeUntil,
           enabled: rule.enabled,
           rotationGroupId: rule.rotationGroupId,
           ...(isBreak ? {} : { ticketKey: rule.ticketKey, ticketSummary: rule.ticketSummary, ticketType: rule.ticketType, comment: rule.comment }),
       });
   }

   async function setInterval(rule: TemplateRule, n: number) {
       try { await updateTemplateRule(rule.id, { intervalWeeks: n }); onChanged(); } catch { /* */ }
   }

   async function toggleEnabled(rule: TemplateRule) {
       try { await updateTemplateRule(rule.id, { enabled: !rule.enabled }); onChanged(); } catch { /* */ }
   }

   async function clearEndDate(rule: TemplateRule) {
       try {
           // PUT n'efface pas activeUntil → supprimer + recréer sans la borne.
           await deleteTemplateRule(rule.id);
           await createTemplateRule({
               ruleType: rule.ruleType,
               weekday: rule.weekday,
               startTime: rule.startTime,
               durationMinutes: rule.durationMinutes,
               targetMinutes: rule.targetMinutes,
               intervalWeeks: rule.intervalWeeks,
               anchorDate: rule.anchorDate,
               enabled: rule.enabled,
               rotationGroupId: rule.rotationGroupId,
               ticketKey: rule.ticketKey,
               ticketSummary: rule.ticketSummary,
               ticketType: rule.ticketType,
               comment: rule.comment,
           });
           onChanged();
       } catch { /* */ }
   }

   async function submitEndDate() {
       const id = endDateRuleId;
       const value = endDateValue;
       setEndDateRuleId(null);
       if (id === null || value === '') return;
       try { await updateTemplateRule(id, { activeUntil: value }); onChanged(); } catch { /* */ }
   }

   async function removeRule(rule: TemplateRule) {
       try { await deleteTemplateRule(rule.id); onChanged(); } catch { /* */ }
   }
   ```

3. Remplacer **intégralement** le corps du `blocks.map((...) => { … })` de la Task 5 par la version ci-dessous (chaque bloc est enveloppé d'un `ContextMenu` ; `zIndex: 6` pour passer au-dessus des cellules d'interaction ; `onDoubleClick` ouvre l'édition) :

   ```tsx
   {blocks.map(({ rule, startSlotIndex, slotCount, rotationSize, rotationIndex }) => {
       const top = startSlotIndex * SLOT_PX;
       const height = slotCount * SLOT_PX;
       const runDurationMinutes = slotCount * 15;
       const isBreak = rule.ruleType === TemplateRuleType.BREAK;
       const widthPct = 100 / rotationSize;
       const leftPct = rotationIndex * widthPct;
       const rotationTitle =
           rotationSize > 1
               ? t('templates.recurrence.cadence_tooltip')
                     .replace('{n}', String(rule.intervalWeeks))
                     .replace('{pos}', String(rotationIndex + 1))
                     .replace('{size}', String(rotationSize))
               : undefined;

       return (
           <ContextMenu key={rule.id}>
               <ContextMenuTrigger asChild>
                   <div
                       className={cn('absolute', !rule.enabled && 'opacity-40 grayscale')}
                       style={{ top: 0, left: `${leftPct}%`, width: `${widthPct}%`, height: '100%', zIndex: 6 }}
                       title={rotationTitle}
                       onDoubleClick={(e) => { if (!isBreak) openEdit(rule, e); }}
                   >
                       {isBreak ? (
                           <PauseBlock top={top} height={height} slotCount={slotCount} runDurationMinutes={runDurationMinutes} />
                       ) : (
                           <WorkBlock
                               top={top}
                               height={height}
                               slotCount={slotCount}
                               ticket={rule.ticketKey ?? ''}
                               summary={rule.ticketSummary}
                               comment={rule.comment}
                               colors={getBlockColors(rule.ticketType)}
                               runDurationMinutes={runDurationMinutes}
                               isSelected={false}
                           />
                       )}
                       {rotationSize > 1 && (
                           <span
                               className="absolute z-10 rounded bg-amber-900/80 px-1 text-[10px] font-semibold text-white"
                               style={{ top: top + 3, right: 5 }}
                           >
                               {rotationIndex + 1}/{rotationSize}
                           </span>
                       )}
                       {!rule.enabled && (
                           <span
                               className="absolute z-10 left-2 rounded bg-gray-700/80 px-1 text-[10px] font-medium text-white"
                               style={{ top: top + 3 }}
                           >
                               {t('templates.block.disabled_badge')}
                           </span>
                       )}
                   </div>
               </ContextMenuTrigger>
               <TemplateBlockMenu
                   rule={rule}
                   onEdit={() => openEdit(rule, { clientX: window.innerWidth / 2, clientY: 200 } as React.MouseEvent)}
                   onToggleType={() => void recreateWithType(rule, isBreak ? EntryType.WORK : EntryType.BREAK).then(onChanged)}
                   onSetInterval={(n) => void setInterval(rule, n)}
                   onSetEndDate={() => { setEndDateValue(rule.activeUntil ?? today()); setEndDateRuleId(rule.id); }}
                   onClearEndDate={() => void clearEndDate(rule)}
                   onToggleEnabled={() => void toggleEnabled(rule)}
                   onDelete={() => void removeRule(rule)}
               />
           </ContextMenu>
       );
   })}
   ```

   Notes :
   - Le layer de cellules d'interaction (`TemplateCell`, `zIndex: 5`) passe **sous** les blocs (`zIndex: 6`) pour que le clic droit vise le bloc.
   - ⚠️ Conséquence assumée V1 : le clic-glisser **démarré sur** un créneau occupé n'est plus capté par `TemplateCell` (le bloc est au-dessus). Pour empiler, glisser depuis un créneau libre chevauchant (géré en Task 8). Ajouter ce commentaire dans le code.
   - `openEdit` accepte un objet compatible `React.MouseEvent` minimal (`{ clientX, clientY }`) pour l'entrée « Éditer le ticket » du menu, qui n'a pas d'événement souris réel.

4. Ajouter le mini-popover de date de fin, à côté du `EditPopover` de création :
   ```tsx
   {editingRule !== null && (
       <EditPopover
           slot={editingRule.startTime ?? ''}
           entry={{
               id: editingRule.id,
               ticketKey: editingRule.ticketKey,
               ticketSummary: editingRule.ticketSummary,
               ticketType: editingRule.ticketType,
               comment: editingRule.comment,
               startedAt: editingRule.startTime ?? '',
               endedAt: null,
               type: editingRule.ruleType === EntryType.BREAK ? EntryType.BREAK : EntryType.WORK,
               durationMinutes: editingRule.durationMinutes,
           }}
           anchorTop={0}
           scrollContainer={null}
           mousePos={editMouse}
           knownTickets={knownTickets}
           onSave={(k, ty, c, s, tt) => void saveEdit(k, ty, c, s, tt)}
           onCancel={() => setEditingRule(null)}
           onClear={() => { const r = editingRule; setEditingRule(null); if (r) void removeRule(r); }}
       />
   )}

   {endDateRuleId !== null && (
       <div
           className="fixed z-50 flex flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg"
           style={{ top: 120, left: '50%', transform: 'translateX(-50%)' }}
           onMouseDown={(e) => e.stopPropagation()}
       >
           <span className="text-[12px] font-medium">{t('templates.recurrence.end_date_title')}</span>
           <input
               type="date"
               min={today()}
               value={endDateValue}
               onChange={(e) => setEndDateValue(e.target.value)}
               className="h-8 rounded-md border border-input px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
           />
           <div className="flex justify-end gap-1.5">
               <button
                   onClick={() => setEndDateRuleId(null)}
                   className="h-7 rounded-md px-3 text-[12.5px] hover:bg-accent"
               >
                   {t('templates.stack.cancel')}
               </button>
               <button
                   onClick={() => void submitEndDate()}
                   className="h-7 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground enabled:hover:bg-primary/90"
               >
                   {t('templates.recurrence.end_date_confirm')}
               </button>
           </div>
       </div>
   )}
   ```

- [ ] **Step 3: Vérifier — compilation + cycle d'édition complet**

Run :
```bash
npx tsc --noEmit
npm run dev
```

Navigateur, base vide, sur `/modeles` :
- Créer un `WorkBlock` `DAILY` en Lundi 09:00–09:15 (Task 6).
- **Double-clic** dessus → `EditPopover` pré-rempli `DAILY` → changer en `PROJ-42`, ajouter un commentaire, Entrée.
  ```bash
  curl -sk https://daytrack.localhost/api/template-rules   # ticketKey -> "PROJ-42", comment renseigné, même id
  ```
- **Clic droit** → Récurrence ▸ « Une semaine sur 2 ».
  ```bash
  curl -sk https://daytrack.localhost/api/template-rules   # "intervalWeeks":2
  ```
- Clic droit → Récurrence ▸ « Ajouter une date de fin… » → choisir une date → Appliquer.
  ```bash
  curl -sk https://daytrack.localhost/api/template-rules   # "activeUntil":"YYYY-MM-DD"
  ```
- Clic droit → Récurrence ▸ « Retirer la date de fin » → `curl` : `"activeUntil":null` (l'`id` a changé — suppression + recréation, attendu).
- Clic droit → « Désactiver la règle » → bloc grisé + badge « Désactivée ».
  ```bash
  curl -sk https://daytrack.localhost/api/template-rules   # "enabled":false
  ```
- Clic droit → « Convertir en pause » → devient un `PauseBlock` (`curl` : `"ruleType":"break"`, `ticketKey:null`).
- Clic droit → « Supprimer la règle » → le bloc disparaît (`curl` : `[]`).

- [ ] **Step 4: Commit**

```bash
git add assets/components/templates/TemplateBlockMenu.tsx assets/components/templates/TemplateColumn.tsx
git commit -m "feat: éditer un bloc Modèles (contenu, récurrence, activation, suppression)"
```

---

## Task 8: Empilement — prompt « Remplacer / Alterner / Annuler » et alternance

**Files:**
- Create: `assets/components/templates/StackPrompt.tsx`
- Modify: `assets/components/templates/TemplateColumn.tsx`

**Interfaces:**
- Consumes: `Dialog`, `DialogContent`, `DialogFooter`, `DialogHeader`, `DialogTitle` (`@/components/ui/dialog`) ; `Button` (`@/components/ui/button`) ; `nextOccurrenceOnOrAfter` (`@/utils/templateGrid`) ; `today`, `shiftDate` (`@/utils/timeline`) ; `createTemplateRule`, `updateTemplateRule`, `deleteTemplateRule` (`@/services/templateRuleService`).
- Produces :
  - `StackPrompt` : dialogue à deux étapes. Props `{ existing: TemplateRule; open: boolean; onCancel: () => void; onReplace: () => void; onAlternate: (startDate: string) => void; }`. Étape 1 : Remplacer / Alterner / Annuler (Alterner masqué si `existing.rotationGroupId !== null` → message `rotation_exists`). Étape 2 (après clic Alterner) : champ date (`min = today()`, défaut `today()`) + bouton `confirm_alternate`.
  - `TemplateColumn::handleCreateFromPopover` : quand `findColumnOverlap` renvoie une règle, ouvre `StackPrompt` au lieu de ne rien faire (remplace le `// TODO(task 8)`).
    - **Remplacer** : si même `ruleType` → `PUT` `{ startTime, durationMinutes, ticketKey, ticketSummary, ticketType, comment }` sur la règle existante (on garde son créneau d'origine : on réutilise `existing.startTime`/`existing.durationMinutes`). Si `ruleType` différent → supprimer la règle existante + créer la nouvelle sur le créneau d'origine.
    - **Alterner** : `deleteTemplateRule(existing.id)` ; `groupId = crypto.randomUUID()` ; `anchor0 = nextOccurrenceOnOrAfter(startDate, iso)` ; `anchor1 = shiftDate(anchor0, 7)` ; `createTemplateRule(member0)` avec le contenu de l'ancienne règle, `intervalWeeks: 2`, `anchorDate: anchor0`, `rotationGroupId: groupId` ; `createTemplateRule(member1)` avec le contenu du **nouveau** bloc, même créneau (`existing.startTime` / `existing.durationMinutes`), `intervalWeeks: 2`, `anchorDate: anchor1`, `rotationGroupId: groupId`.

- [ ] **Step 1: Créer `assets/components/templates/StackPrompt.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { TemplateRule } from '@/types/api';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { today } from '@/utils/timeline';
import { t } from '@/i18n/fr';

interface StackPromptProps {
    existing: TemplateRule;
    open: boolean;
    onCancel: () => void;
    onReplace: () => void;
    onAlternate: (startDate: string) => void;
}

export default function StackPrompt({ existing, open, onCancel, onReplace, onAlternate }: StackPromptProps) {
    const [step, setStep] = useState<'choice' | 'date'>('choice');
    const [startDate, setStartDate] = useState(today());

    // Réinitialise à chaque ouverture
    useEffect(() => {
        if (open) { setStep('choice'); setStartDate(today()); }
    }, [open]);

    const alreadyRotation = existing.rotationGroupId !== null;

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-base">{t('templates.stack.title')}</DialogTitle>
                </DialogHeader>

                {alreadyRotation ? (
                    <>
                        <p className="text-sm text-muted-foreground">{t('templates.stack.rotation_exists')}</p>
                        <DialogFooter>
                            <Button size="sm" variant="outline" onClick={onCancel}>
                                {t('templates.stack.cancel')}
                            </Button>
                        </DialogFooter>
                    </>
                ) : step === 'choice' ? (
                    <div className="flex flex-col gap-2">
                        <Button size="sm" onClick={onReplace}>{t('templates.stack.replace')}</Button>
                        <Button size="sm" variant="secondary" onClick={() => setStep('date')}>
                            {t('templates.stack.alternate')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={onCancel}>
                            {t('templates.stack.cancel')}
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium">{t('templates.stack.start_date_title')}</label>
                        <input
                            type="date"
                            min={today()}
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="h-8 rounded-md border border-input px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        />
                        <p className="text-[12px] text-muted-foreground">{t('templates.stack.start_date_hint')}</p>
                        <DialogFooter>
                            <Button size="sm" variant="outline" onClick={onCancel}>
                                {t('templates.stack.cancel')}
                            </Button>
                            <Button size="sm" onClick={() => onAlternate(startDate)}>
                                {t('templates.stack.confirm_alternate')}
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
```

- [ ] **Step 2: Brancher `StackPrompt` dans `TemplateColumn.tsx`**

1. Import : `import StackPrompt from './StackPrompt';`

2. État :
   ```ts
   // ── Empilement / alternance ──────────────────────────────────────────
   const [stack, setStack] = useState<{
       existing: TemplateRule;
       next: { ticketKey: string | null; ticketSummary: string | null; ticketType: string | null; comment: string | null; isBreak: boolean };
   } | null>(null);
   ```

3. Dans `handleCreateFromPopover`, remplacer le bloc `if (overlap !== null) { … }` par :
   ```ts
   if (overlap !== null) {
       setStack({
           existing: overlap,
           next: {
               ticketKey,
               ticketSummary,
               ticketType,
               comment,
               isBreak: type === EntryType.BREAK,
           },
       });
       setPendingRange(null);
       setPopoverMouse(null);
       return;
   }
   ```
   (On garde `pendingRange` fermé : le créneau retenu pour l'alternance est celui de la règle **existante**, pas la plage dessinée.)

4. Handlers de résolution :
   ```ts
   function closeStack() { setStack(null); }

   async function resolveReplace() {
       if (stack === null) return;
       const { existing, next } = stack;
       closeStack();
       try {
           const sameType = next.isBreak === (existing.ruleType === EntryType.BREAK);
           if (sameType) {
               await updateTemplateRule(existing.id, {
                   startTime: existing.startTime ?? undefined,
                   durationMinutes: existing.durationMinutes ?? undefined,
                   ticketKey: next.isBreak ? null : next.ticketKey,
                   ticketSummary: next.isBreak ? null : next.ticketSummary,
                   ticketType: next.isBreak ? null : next.ticketType,
                   comment: next.isBreak ? null : next.comment,
               });
           } else {
               await deleteTemplateRule(existing.id);
               await createTemplateRule({
                   ruleType: next.isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                   weekday: existing.weekday,
                   startTime: existing.startTime,
                   durationMinutes: existing.durationMinutes,
                   intervalWeeks: existing.intervalWeeks,
                   anchorDate: existing.anchorDate,
                   activeUntil: existing.activeUntil,
                   enabled: existing.enabled,
                   ...(next.isBreak ? {} : { ticketKey: next.ticketKey, ticketSummary: next.ticketSummary, ticketType: next.ticketType, comment: next.comment }),
               });
           }
           onChanged();
       } catch { /* service gère */ }
   }

   async function resolveAlternate(startDate: string) {
       if (stack === null) return;
       const { existing, next } = stack;
       closeStack();
       const groupId = crypto.randomUUID();
       const anchor0 = nextOccurrenceOnOrAfter(startDate, iso);
       const anchor1 = shiftDate(anchor0, 7);
       const wasBreak = existing.ruleType === EntryType.BREAK;
       try {
           await deleteTemplateRule(existing.id);
           // Membre 0 : l'ancienne règle
           await createTemplateRule({
               ruleType: wasBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
               weekday: iso,
               startTime: existing.startTime,
               durationMinutes: existing.durationMinutes,
               intervalWeeks: 2,
               anchorDate: anchor0,
               rotationGroupId: groupId,
               ...(wasBreak ? {} : { ticketKey: existing.ticketKey, ticketSummary: existing.ticketSummary, ticketType: existing.ticketType, comment: existing.comment }),
           });
           // Membre 1 : le nouveau bloc, sur le même créneau
           await createTemplateRule({
               ruleType: next.isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
               weekday: iso,
               startTime: existing.startTime,
               durationMinutes: existing.durationMinutes,
               intervalWeeks: 2,
               anchorDate: anchor1,
               rotationGroupId: groupId,
               ...(next.isBreak ? {} : { ticketKey: next.ticketKey, ticketSummary: next.ticketSummary, ticketType: next.ticketType, comment: next.comment }),
           });
           onChanged();
       } catch { /* service gère */ }
   }
   ```

5. Rendu du prompt (à côté des popovers) :
   ```tsx
   {stack !== null && (
       <StackPrompt
           existing={stack.existing}
           open
           onCancel={closeStack}
           onReplace={() => void resolveReplace()}
           onAlternate={(d) => void resolveAlternate(d)}
       />
   )}
   ```

- [ ] **Step 3: Vérifier — compilation + Remplacer + Alterner**

Run :
```bash
npx tsc --noEmit
npm run dev
```

Navigateur, base vide, sur `/modeles` :

**Remplacer :**
- Lundi : créer `DAILY` 09:00–09:15.
- Glisser depuis 09:00 (ou un créneau libre chevauchant, ex. 08:45–09:15) → popover → saisir `OTHER-1` → le prompt s'ouvre → « Remplacer le bloc existant ».
  ```bash
  curl -sk https://daytrack.localhost/api/template-rules
  ```
  Expected : toujours 1 règle Lundi, `"ticketKey":"OTHER-1"`, créneau `09:00`/`15`.

**Alterner :**
- Glisser à nouveau sur le créneau de `OTHER-1` → popover → saisir `POKER` → prompt → « Alterner une semaine sur deux » → laisser la date par défaut (aujourd'hui) → « Créer l'alternance ».
  ```bash
  curl -sk https://daytrack.localhost/api/template-rules
  ```
  Expected : **2 règles**, mêmes `weekday`/`startTime`/`durationMinutes`, `"intervalWeeks":2`, `rotationGroupId` **identique** sur les deux, `anchorDate` distants de 7 jours, l'une `OTHER-1` l'autre `POKER`.
- La colonne Lundi affiche les **deux blocs côte à côte** avec badges « 1/2 » et « 2/2 » ; survol → infobulle « Une semaine sur 2 — bloc 1/2 ».

**Collapse automatique :**
- Clic droit sur le bloc `POKER` → « Supprimer la règle ».
  ```bash
  curl -sk https://daytrack.localhost/api/template-rules
  ```
  Expected : 1 seule règle restante (`OTHER-1`), repassée en `"intervalWeeks":1` et `"rotationGroupId":null` (collapse fait par le backend).

**Créneau déjà en alternance :**
- Recréer une alternance (2 blocs). Glisser sur leur créneau → popover → saisir un ticket → le prompt affiche « Ce créneau contient déjà une alternance… » avec seulement « Annuler ».

Nettoyer :
```bash
curl -sk https://daytrack.localhost/api/template-rules | \
  docker compose exec -T php php -r '$r=json_decode(stream_get_contents(STDIN),true); foreach($r as $x){echo $x["id"],"\n";}' | \
  while read id; do curl -sk -X DELETE "https://daytrack.localhost/api/template-rules/$id"; done
```

- [ ] **Step 4: Revue finale + build de production**

Run :
```bash
npx tsc --noEmit
npm run build
```
Expected : build Encore de production **sans erreur** ni warning TypeScript.

Check-list navigateur (base vide au départ) :
- [ ] `/modeles` accessible depuis l'icône du header jour ; « Retour au jour » fonctionne.
- [ ] Fond ambré + bandeau permanent visibles ; grille 7 colonnes Lundi→Dimanche + gouttière d'heures.
- [ ] Créer WORK (glisser + ticket) et BREAK (glisser + « Convertir en pause »).
- [ ] Objectif du jour : définir `6h30` sous Vendredi, puis l'effacer.
- [ ] Double-clic → édition ticket/commentaire.
- [ ] Menu contextuel : récurrence 1/2/3/4 semaines, date de fin + retrait, activer/désactiver, convertir, supprimer.
- [ ] Empilement : Remplacer, Alterner (badges 1/2 · 2/2, infobulle cadence), suppression d'un membre → l'autre repasse hebdomadaire.
- [ ] Aucune chaîne en dur (tout via `t(...)`), aucune classe Tailwind dynamique.
- [ ] `git status` : seuls les fichiers attendus sont modifiés.

- [ ] **Step 5: Commit**

```bash
git add assets/components/templates/StackPrompt.tsx assets/components/templates/TemplateColumn.tsx
git commit -m "feat: empilement et alternance dans la vue Modèles"
```

---

## Récapitulatif

À l'issue de ce plan :
- Route `/modeles` accessible depuis une icône dédiée du header jour ; en-tête propre + bandeau permanent + fond teinté distinct du mode jour.
- Grille à 7 colonnes génériques Lundi→Dimanche réutilisant les blocs visuels de la timeline (`blocks.tsx`) et le `EditPopover` existant (saisie ticket + autocomplete Jira + conversion en pause).
- Création de règles WORK/BREAK par clic-glisser ; objectif du jour éditable par colonne (`TARGET_OVERRIDE`).
- Édition par bloc via menu contextuel : contenu, récurrence (toutes les semaines / une semaine sur N), date de fin (ajout + retrait), activation/désactivation, conversion travail↔pause, suppression.
- Empilement géré par un prompt Remplacer / Alterner / Annuler ; l'alternance crée 2 règles `intervalWeeks: 2` partageant un `rotationGroupId`, ancrées à 7 jours d'écart, rendues côte à côte avec badges de position ; la suppression d'un membre laisse le backend re-basculer l'autre en hebdomadaire.
- Undo/redo et copier/coller volontairement absents de cette vue (hors scope V1).
- Contournements documentés des limites du `PUT` backend (pas de changement de `ruleType`, pas d'effacement d'`activeUntil`, pas de `rotationGroupId`) : suppression + recréation ciblée.

### Écarts connus vs. design (assumés pour V1)

- **Rotation à ≥ 3 éléments** : hors scope (déjà acté dans le design). Un créneau déjà en alternance n'accepte que « Annuler ».
- **Créer en glissant depuis un créneau occupé** : les blocs captent le clic (menu contextuel) ; pour empiler, glisser depuis un créneau libre chevauchant. Comportement acceptable au vu du volume.
- **Règles hors fenêtre 07:00–19:45** (créées via l'API) : non affichées dans la grille. Non atteignable via l'UI de création.
- **Créer une pause sur un créneau vide** : via le bouton « Convertir en pause » du `EditPopover` (sous-composant timeline réutilisé) après le clic-glisser, plutôt qu'un clic droit « marquer comme pause » dédié sur cellule vide. Même résultat (règle `break`), un chemin d'interaction de moins à maintenir.
- **Tests automatisés front** : absents (aucun runner dans le projet) — vérification manuelle à chaque tâche, comme le plan backend.
