# Vue Modèles — parité d'interaction avec la Timeline — design

Date : 2026-08-30
Statut : validé, en attente de plan d'implémentation

## Contexte

La vue « Modèles » (`/modeles`, spec [2026-08-16-templates-journee-design.md](2026-08-16-templates-journee-design.md), livrée par le plan [2026-08-29-templates-journee-frontend.md](../plans/2026-08-29-templates-journee-frontend.md)) édite les `TemplateRule` récurrentes dans une grille à 7 colonnes génériques Lundi→Dimanche. La V1 avait volontairement écarté copier/coller, undo/redo et la sélection multi-cellules (« volume de blocs faible »).

Retour utilisateur après recette : la vue doit se comporter comme la timeline jour — mêmes gestes, mêmes raccourcis. Ce document révise ce choix : la vue Modèles doit atteindre la **parité d'interaction** avec la Timeline (sélection multiple, drag, presse-papier, undo/redo, raccourcis clavier, double-clic pour éditer), plus quatre corrections ponctuelles issues de la même recette.

Ce document couvre le **frontend** uniquement. Aucun changement backend : les endpoints `TemplateRuleController` et `DayController` livrés restent inchangés.

## Objectif

1. **Moteur d'interaction partagé** entre la timeline jour et les colonnes Modèles — une seule implémentation, testée, à maintenir.
2. **Parité Modèles ↔ Timeline** : sélection simple/multiple, drag de plage, copier/couper/coller (clavier + menu), coller-multiple, undo/redo, navigation clavier, double-clic → détail/édition.
3. **Corrections de recette** :
   - popovers (édition ticket, date de fin) ancrés au bloc, plus au centre de l'écran ;
   - bouton « + » sur un bloc pour créer une alternance sans avoir à deviner le geste de drag-sur-bloc ;
   - sidebar favoris présente dans la vue Modèles, avec la teinte ambrée de la vue ;
   - (déjà livré au lot 1 : gouttière avec quarts d'heure, objectif affiché `7h30` au lieu de « Défaut ».)

## Hors scope

- Undo/redo des changements de **récurrence, d'alternance et d'objectif** dans la vue Modèles (voir « Portée de l'undo »).
- Rotation d'alternance à plus de 2 éléments via l'UI (inchangé — déjà hors scope V1).
- Tout changement backend.
- Mise en place d'un runner de tests frontend (le projet n'en a toujours pas — vérification manuelle, cohérent avec les plans précédents).

## Architecture

### `useSlotGrid` — le moteur

Nouveau hook `assets/hooks/useSlotGrid.ts`. On y **déplace depuis `Timeline.tsx`** toute la logique d'interaction, sans changement de comportement pour la vue jour :

| Domaine | Ce qui bouge dans le hook |
|---|---|
| Sélection | `Set<string>` des créneaux, ancre, curseur actif ; `selectSingle` / `extendToSlot` / `toggleSlot` / `clearSelection` / `handleSelect` (shift = plage, ctrl/cmd = toggle) ; navigation ↑/↓ et shift+↑/↓ |
| Drag | `startDrag` / `handleDragExtend` ; effet `mouseup` sur `document` ; effet d'auto-scroll quand le curseur approche du bord du conteneur |
| Presse-papier | état `clipboard`, `handleCopySelection` / `handleCutSelection` / `handlePaste` / `handlePasteToMultiple` ; synchro `sessionStorage` + écoute de l'événement `daytrack:clipboard-changed` |
| Historique | piles `undoStack` / `redoStack` de *snapshots* `SlotCell[]` ; `pushHistory` ; `handleUndo` / `handleRedo` ; `reconcile(target)` qui diffe l'état courant vs cible et émet les create/update/delete |
| Raccourcis | pattern `useRef` + wrapper stable enregistré une fois : ⌘/Ctrl+C, ⌘/Ctrl+X, ⌘/Ctrl+V, Delete/Backspace, Escape, ⌘Z / ⌘⇧Z / ⌘Y — n'agit que si **cette instance** a une sélection non vide et qu'aucun champ n'est focus |
| Garde | `pendingSlotsRef` (empêche l'empilement lors d'une double soumission rapide) |
| Scroll | persistance de `scrollTop` du conteneur sous `<storagePrefix>_scroll` |

**Clés `sessionStorage`.** Le hook dérive toutes ses clés d'un unique `storagePrefix` : `<storagePrefix>_undo`, `<storagePrefix>_redo`, `<storagePrefix>_scroll`. La vue jour passe `storagePrefix = `daytrack_${date}`` (isolation undo/redo par jour), la colonne Modèles `daytrack_tmpl_${iso}` (isolation par jour de semaine). Le **format** des clés jour change donc (`daytrack_undo_<date>` → `daytrack_<date>_undo`, et le scroll passe de global à par-jour) — sans conséquence : ce sont des états de session éphémères, aucune migration n'est requise.

**Signature :**

```ts
interface SlotCell {
    id: string;              // id réel (entrée ou règle) ; "" pour une cellule virtuelle non persistée
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;         // WORK | BREAK
    startedAt: string;       // "HH:mm"
    endedAt: string | null;  // "HH:mm"
}

interface SlotGridOps {
    /** Crée une cellule sur `slot` (créneau de 15 min) à partir des champs fournis. Retourne l'état rafraîchi. */
    createCell(slot: string, data: SlotCellInput): Promise<SlotCell[]>;
    /** Met à jour la cellule existante `cell` avec `data`. */
    updateCell(cell: SlotCell, data: SlotCellInput): Promise<SlotCell[]>;
    /** Supprime la cellule existante `cell`. */
    deleteCell(cell: SlotCell): Promise<SlotCell[]>;
}

type SlotCellInput = {
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;
    endedAt: string;
};

interface UseSlotGridArgs {
    slots: string[];                     // GRID_SLOTS
    cells: SlotCell[];                    // état courant fourni par le consommateur
    storagePrefix: string;               // "daytrack" | `daytrack_tmpl_${iso}`
    scrollRef: React.RefObject<HTMLDivElement | null>;
    ops: SlotGridOps;
    onChanged: (cells: SlotCell[]) => void; // remonte l'état rafraîchi au consommateur
}

interface UseSlotGridResult {
    selectedSlots: Set<string>;
    isDragging: boolean;
    hasClipboard: boolean;
    // handlers passés à la cellule d'interaction :
    onSelect(slot: string, e: React.MouseEvent): void;
    onCellMouseDown(slot: string, e: React.MouseEvent): void;
    onDragExtend(slot: string): void;
    onCopy(): void;
    onCut(): void;
    onPaste(slot: string): void;
    onClearRange(slots: Set<string>): void;
    onConvertToBreak(slots: Set<string>): void;
    onDropFavorite(slot: string): void;
    // API impérative pour le consommateur :
    save(slot: string, data: SlotCellInput | null): Promise<void>; // null sur une cellule existante = suppression
    clearSelection(): void;
}
```

Le hook **ne rend rien**. Il ne connaît ni `WorkDay`, ni `TemplateRule`, ni date, ni objectif, ni récurrence, ni l'indicateur « maintenant ». `reconcile` compare par `startedAt` (clé de créneau) et ignore les champs hors `SlotCell` — un `updateCell` d'une règle en alternance préserve donc côté consommateur `intervalWeeks` / `anchorDate` / `rotationGroupId` / `activeUntil`.

### `slotClipboard.ts` — presse-papier

`assets/utils/slotClipboard.ts` extrait la lecture/écriture du presse-papier aujourd'hui inline dans `Timeline.tsx` :

```ts
interface ClipboardCell {
    offset: number;
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;
    isEmpty: boolean;
}
interface ClipboardData { cells: ClipboardCell[]; }

export function readClipboard(): ClipboardData | null;
export function writeClipboard(data: ClipboardData): void;   // écrit sessionStorage + dispatch 'daytrack:clipboard-changed'
export function subscribeClipboard(cb: () => void): () => void; // add/removeEventListener
```

**Clé `sessionStorage` unique et partagée** (`daytrack_clipboard`, inchangée) : copier une cellule dans la vue jour et la coller dans une colonne Modèles fonctionne, et inversement.

## Ce qui reste dans chaque consommateur

### Timeline (vue jour)

- DOM : gouttière d'heures, lignes de grille, layer de cellules d'interaction, layer de blocs visuels (`blocks.tsx`), indicateur « maintenant » (`NowIndicator`).
- Mappe `TimeEntry[] → SlotCell[]` (quasi identité) et `SlotCell[] → WorkDay` en retour via `onChanged` (rechargement de la journée).
- `SlotGridOps` implémenté sur `dayService` (`createEntry` / `updateEntry` / `deleteEntry`) ; `onChanged` recharge la journée (`useWorkDay`).
- `storagePrefix = `daytrack_${date}`` (voir « Clés sessionStorage »).
- Câblage `EditPopover`, `knownTickets`, chargement `useWorkDay`.

### TemplateColumn (une colonne Modèles)

- DOM : lignes de grille, layer de cellules d'interaction, layer de blocs visuels (`blocks.tsx`), badges d'alternance, bouton « + ».
- Mappe `entryRulesForWeekday(rules, iso) → SlotCell[]` ; `onChanged` déclenche `reload()` de la page.
- `SlotGridOps` implémenté sur `templateRuleService` :
  - `createCell(slot, data)` → `POST` `{ ruleType, weekday: iso, startTime: slot, durationMinutes, intervalWeeks: 1, …ticket }` (pas d'ancre — le back calcule la prochaine occurrence) ;
  - `updateCell(cell, data)` → si le `type` change (`work`↔`break`, non modifiable par `PUT`) : `DELETE` + `POST` en conservant `weekday/startTime/durationMinutes/intervalWeeks/anchorDate/activeUntil/enabled/rotationGroupId` ; sinon `PUT` `{ startTime, durationMinutes, ticketKey, ticketSummary, ticketType, comment }` ;
  - `deleteCell(cell)` → `DELETE` (le collapse d'alternance côté back reste géré).
- **Reste propre à Modèles**, hors moteur : menu contextuel récurrence (`TemplateBlockMenu`), badges 1/2·2/2, bouton « + » d'alternance, champ objectif du jour, `StackPrompt` (empilement au drop sur bloc), câblage `EditPopover`.
- `storagePrefix = `daytrack_tmpl_${iso}`` → piles undo/redo isolées par jour de semaine.

## Portée de l'undo/redo (Modèles)

Même granularité que Timeline : **création, suppression, édition de blocs** (ticket, commentaire, type, plage horaire). Ces opérations passent par le moteur et alimentent la pile.

**Ne sont pas** dans la pile d'undo, et ne la vident pas :

- changement de récurrence (`intervalWeeks`, `activeUntil`, `enabled`) ;
- création / dissolution d'une alternance ;
- changement d'objectif du jour (`TARGET_OVERRIDE`).

Justification : opérations rares et délibérées, à réconciliation ambiguë (un snapshot `SlotCell[]` ne porte pas ces champs). Timeline n'a aucun de ces concepts, donc aucune régression côté vue jour. Après une de ces opérations, la pile undo/redo existante reste utilisable telle quelle sur les blocs.

## Modèle de clic

Repris **à l'identique** de la Timeline :

- **clic simple** sur une cellule → sélection (shift = étendre la plage, ctrl/cmd = toggle) ;
- **double-clic** → ouvre le `EditPopover`, qui affiche ticket + titre Jira + commentaire (= « le détail ») et permet l'édition ;
- **clic droit** → menu contextuel (Timeline : copier/couper/coller/convertir/effacer ; Modèles : + récurrence, activer-désactiver).

Pas de « clic simple ouvre le détail » : cela entrerait en conflit avec la sélection, base du multi-select et du copier/coller.

## Ancrage des popovers

- `EditPopover` déclenché **depuis le menu contextuel** (« Éditer le ticket ») : on lit `getBoundingClientRect()` de l'élément `ContextMenuTrigger` du bloc et on le passe en `mousePos` → le popover s'ouvre collé au bloc. (Le double-clic passe déjà l'événement souris réel, donc déjà correct.)
- Mini-popover « date de fin » : ancré sous le bloc via le même `getBoundingClientRect()`, au lieu de `position: fixed; top: 120; left: 50%`.

## Bouton « + » d'alternance

- Au survol d'un bloc **dont `rotationGroupId` est `null`**, un « + » discret apparaît au coin haut-droit.
- Clic → petit popover : champ ticket (autocomplete Jira, même composant que l'édition) + champ date de départ (`min` = aujourd'hui, défaut aujourd'hui).
- Validation → exécute la logique `resolveAlternate` existante : `DELETE` de la règle + `POST` de deux membres `intervalWeeks: 2` partageant un `rotationGroupId` neuf, ancrés à 7 jours d'écart (`nextOccurrenceOnOrAfter(startDate, iso)` et `+7j`).
- Bloc déjà en rotation (badge 2/2) → pas de « + ».
- Le geste « déposer un bloc sur un bloc existant → `StackPrompt` » reste en place en complément.

## Sidebar favoris dans la vue Modèles

- `FavoritesPanel` gagne une prop `tone?: 'neutral' | 'amber'` (défaut `'neutral'`). Elle bascule ~4 tokens de couleur du chrome du panneau (fond `bg-neutral-50` → `bg-amber-50`, bordure, couleur du titre, séparateur). Aucun changement de comportement.
- `TemplatesPage` monte `<FavoritesPanel tone="amber" … />` à gauche de la grille, dans le même flux flex que `TimelinePage`.
- Drag d'un favori sur un créneau d'une colonne → `onDropFavorite(slot)` du moteur (chemin déjà présent dans Timeline) → `createCell`.

## Structure de fichiers

| Fichier | Rôle |
|---|---|
| `assets/hooks/useSlotGrid.ts` — **créé** | le moteur d'interaction |
| `assets/utils/slotClipboard.ts` — **créé** | lecture/écriture/broadcast du presse-papier |
| `assets/components/timeline/Timeline.tsx` — **modifié** | ~900 → ~450 lignes : DOM + `NowIndicator` + câblage `EditPopover` + `useSlotGrid` |
| `assets/components/timeline/TimeBlock.tsx` — **modifié** | la cellule d'interaction devient générique : le contenu du menu contextuel est injecté en `children` / render-prop (Timeline injecte copier/couper/coller/convertir/effacer ; Modèles injecte + récurrence) |
| `assets/components/templates/TemplateColumn.tsx` — **modifié** | consomme `useSlotGrid` ; garde récurrence / rotation / objectif / « + » |
| `assets/components/templates/TemplateCell.tsx` — **supprimé** | remplacé par la cellule d'interaction partagée |
| `assets/components/templates/TemplatesPage.tsx` — **modifié** | ajoute `<FavoritesPanel tone="amber">` |
| `assets/components/layout/FavoritesPanel.tsx` — **modifié** | prop `tone` |
| `assets/components/templates/AlternateButton.tsx` — **créé** | bouton « + » + son popover |

## Dé-risquage

`Timeline.tsx` est le composant porteur de la vue principale. Le plan **commence par** :

1. Extraire `useSlotGrid` + `slotClipboard.ts`, rebrancher `Timeline` dessus **sans changement de comportement**.
2. Passe de non-régression manuelle **complète** sur la vue jour (créer/éditer/supprimer un bloc, plage par drag, sélection multiple, copier/couper/coller, coller-multiple, undo/redo, raccourcis clavier, drop favori, auto-scroll au bord, persistance du scroll).

Seulement ensuite : généralisation de `TimeBlock`, puis consommation par `TemplateColumn`, puis « + », puis sidebar, puis ancrage des popovers.

## Tests

Pas de tests automatisés (aucun runner dans le projet). Chaque tâche du plan se termine par une vérification manuelle : `npx tsc --noEmit`, `npm run dev` / `npm run build`, et clic dans le navigateur sur `https://daytrack.localhost/<date>` (non-régression jour) et `https://daytrack.localhost/modeles` (parité), avec `curl` pour confirmer la forme des appels API.

Points de vérification clés :

- **Non-régression Timeline** : les gestes listés au § Dé-risquage se comportent comme avant le refacto.
- **Modèles — sélection & presse-papier** : sélection multiple par drag et shift-clic ; ⌘C sur une plage puis ⌘V sur une autre cellule d'une **autre** colonne ; ⌘X ; coller-multiple ; copier dans la vue jour → coller dans un modèle.
- **Modèles — undo/redo** : créer 3 blocs, ⌘Z ×3 (grille vide), ⌘⇧Z ×3 (blocs revenus), isolation par colonne (undo dans Lundi n'affecte pas Mardi).
- **Modèles — undo hors portée** : après un changement de récurrence / objectif / alternance, la pile undo des blocs reste opérante.
- **Popovers** : « Éditer le ticket » et « date de fin » depuis le menu contextuel s'ouvrent au niveau du bloc.
- **Bouton « + »** : survol d'un bloc simple → « + » ; clic → popover ; validation → 2 règles `intervalWeeks: 2`, même `rotationGroupId`, ancres +7j. Bloc en rotation → pas de « + ».
- **Sidebar favoris** : visible dans `/modeles`, teinte ambrée ; drag d'un favori sur un créneau → règle créée.
