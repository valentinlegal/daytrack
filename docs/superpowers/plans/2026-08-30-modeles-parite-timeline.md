# Vue Modèles — parité d'interaction avec la Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire toute la logique d'interaction de `Timeline.tsx` dans un moteur partagé (`useSlotGrid`), puis faire consommer ce moteur par les colonnes de la vue Modèles pour atteindre la parité (sélection multiple, drag, copier/coller, undo/redo, raccourcis, double-clic → détail), plus quatre corrections de recette (ancrage des popovers, bouton « + » d'alternance, sidebar favoris ambrée).

**Architecture:** Un hook `useSlotGrid` sans rendu, paramétré par `{ slots, cells, storagePrefix, scrollRef, ops, onChanged }`, encapsule sélection / drag / presse-papier / undo-redo / raccourcis / auto-scroll. `Timeline` le consomme avec des `ops` branchés sur `dayService` ; chaque `TemplateColumn` l'instancie avec des `ops` branchés sur `templateRuleService` et un `storagePrefix` par jour de semaine. Le presse-papier passe par un utilitaire partagé (`slotClipboard.ts`) et une clé `sessionStorage` unique. `TimeBlock` devient la cellule d'interaction générique : le contenu de son menu contextuel est injecté par le consommateur.

**Tech Stack:** React 19 + TypeScript, react-router-dom v7, Tailwind v4, composants shadcn/ui existants, build Symfony Encore (`npm run dev` / `npm run watch` / `npm run build` sur l'hôte).

Spec de référence : `docs/superpowers/specs/2026-08-30-modeles-parite-timeline-design.md`.

## Global Constraints

- Tout le code frontend en **TypeScript** ; fichiers React en `.tsx`.
- Tous les messages visibles passent par `t('clé')` (`assets/i18n/fr.ts`) — jamais de chaîne en dur. Interpolation via `.replace('{x}', String(v))`.
- Dates locales : jamais `toISOString()` — utiliser `assets/utils/timeline.ts`.
- **`sessionStorage`** pour l'état UI. Clé presse-papier partagée : `daytrack_clipboard` (inchangée).
- Handlers clavier sur `document` → **pattern `useRef`** : handler affecté à `ref.current` à chaque render, wrapper stable enregistré une fois avec `[]`.
- **Tailwind v4** : aucune classe dynamique ; couleurs de type de ticket via `assets/config/ticketTypeColors.ts`.
- Imports via l'alias `@/` (= `assets/`).
- Pas de `"use client"`.
- `npm` sur l'hôte. Après un `npm run dev` / `npm run build`, **redémarrer le worker FrankenPHP** si la page sert un vieux `entrypoints.json` : `docker compose restart php`.
- Backend inchangé. Commandes back dans le conteneur : `docker compose exec php …`. SQLite dev : `db/data_dev.db`.
- **Pas de tests automatisés** (aucun runner dans le projet) : chaque tâche finit par `npx tsc --noEmit`, un build, et une vérification navigateur + `curl`.
- `EntryType` (`@/types/api`) : `{ WORK: 'work', BREAK: 'break' }`.

---

## Task 1: Extraire le presse-papier dans `slotClipboard.ts`

**Files:**
- Create: `assets/utils/slotClipboard.ts`
- Modify: `assets/components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: `EntryType` (`@/types/api`).
- Produces :
  - `ClipboardCell`, `ClipboardData` (types) ;
  - `readClipboard(): ClipboardData | null` ;
  - `writeClipboard(data: ClipboardData): void` — écrit `sessionStorage['daytrack_clipboard']` **et** `window.dispatchEvent(new Event('daytrack:clipboard-changed'))` ;
  - `subscribeClipboard(cb: () => void): () => void` — `addEventListener` / retourne le `removeEventListener`.

- [ ] **Step 1: Créer `assets/utils/slotClipboard.ts`**

```ts
import type { EntryType } from '@/types/api';

const KEY = 'daytrack_clipboard';
const EVENT = 'daytrack:clipboard-changed';

export interface ClipboardCell {
    offset: number;
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;
    isEmpty: boolean;
}

export interface ClipboardData {
    cells: ClipboardCell[];
}

/** Lit le presse-papier partagé (jour + modèles). null si vide ou illisible. */
export function readClipboard(): ClipboardData | null {
    try {
        const stored = sessionStorage.getItem(KEY);
        return stored ? (JSON.parse(stored) as ClipboardData) : null;
    } catch {
        return null;
    }
}

/** Écrit le presse-papier partagé et notifie les autres grilles montées. */
export function writeClipboard(data: ClipboardData): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(data));
    } catch {
        // sessionStorage plein ou indisponible — on continue sans persister
    }
    window.dispatchEvent(new Event(EVENT));
}

/** S'abonne aux changements du presse-papier. Retourne la fonction de désabonnement. */
export function subscribeClipboard(cb: () => void): () => void {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
}
```

- [ ] **Step 2: Rebrancher `Timeline.tsx` sur `slotClipboard`**

Dans `assets/components/timeline/Timeline.tsx` :

1. Ajouter l'import :
   ```ts
   import { readClipboard, writeClipboard, subscribeClipboard } from '@/utils/slotClipboard';
   import type { ClipboardData } from '@/utils/slotClipboard';
   ```

2. Supprimer les déclarations locales `interface ClipboardCell { … }` et `type ClipboardData = { cells: ClipboardCell[] };` (≈ lignes 114–123).

3. Remplacer l'initialiseur du state `clipboard` :
   ```ts
   const [clipboard, setClipboard] = useState<ClipboardData | null>(() => {
       try {
           const stored = sessionStorage.getItem('daytrack_clipboard');
           if (!stored) return null;
           return JSON.parse(stored) as ClipboardData;
       } catch {
           return null;
       }
   });
   ```
   par :
   ```ts
   const [clipboard, setClipboard] = useState<ClipboardData | null>(() => readClipboard());
   ```

4. Remplacer l'effet d'écoute (`useEffect` avec `onClipboardChanged` / `window.addEventListener('daytrack:clipboard-changed', …)`) :
   ```ts
   useEffect(() => subscribeClipboard(() => setClipboard(readClipboard())), []);
   ```

5. Dans `handleCopySelection`, remplacer :
   ```ts
   setClipboard(value);
   sessionStorage.setItem('daytrack_clipboard', JSON.stringify(value));
   ```
   par :
   ```ts
   setClipboard(value);
   writeClipboard(value);
   ```

- [ ] **Step 3: Vérifier**

```bash
npx tsc --noEmit
npm run dev
docker compose restart php
```

Navigateur, `https://daytrack.localhost/` (jour) :
- Créer 2 blocs, sélectionner une plage, ⌘C, puis ⌘V sur une autre cellule → collage OK.
- ⌘X sur une plage → coupe OK.
- Le menu contextuel « Coller » apparaît bien après une copie (état `hasClipboard`).

- [ ] **Step 4: Commit**

```bash
git add assets/utils/slotClipboard.ts assets/components/timeline/Timeline.tsx
git commit -m "refactor: extraire le presse-papier de la timeline dans slotClipboard"
```

---

## Task 2: Créer `useSlotGrid` et rebrancher `Timeline` dessus

**Files:**
- Create: `assets/hooks/useSlotGrid.ts`
- Modify: `assets/components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: `EntryType` (`@/types/api`) ; `getNextSlot` (`@/utils/timeline`) ; `readClipboard` / `writeClipboard` / `subscribeClipboard` / `ClipboardData` / `ClipboardCell` (`@/utils/slotClipboard`).
- Produces : `useSlotGrid(args: UseSlotGridArgs): UseSlotGridResult` et les types `SlotCell`, `SlotCellInput`, `SlotGridOps`, `UseSlotGridArgs`, `UseSlotGridResult` (voir code). `Timeline.tsx` consomme le hook : toute la logique sélection/drag/presse-papier/undo-redo/raccourcis/auto-scroll disparaît du composant, remplacée par l'appel au hook + un objet `ops` branché sur `dayService`.

- [ ] **Step 1: Créer `assets/hooks/useSlotGrid.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EntryType } from '@/types/api';
import { getNextSlot } from '@/utils/timeline';
import {
    readClipboard,
    writeClipboard,
    subscribeClipboard,
} from '@/utils/slotClipboard';
import type { ClipboardData } from '@/utils/slotClipboard';

/** Sous-ensemble commun d'une entrée de temps et d'une règle rendue comme bloc. */
export interface SlotCell {
    id: string;
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;
    startedAt: string;      // "HH:mm"
    endedAt: string | null; // "HH:mm"
}

export interface SlotCellInput {
    ticketKey: string | null;
    ticketSummary: string | null;
    ticketType: string | null;
    comment: string | null;
    type: EntryType;
    endedAt: string;        // "HH:mm"
}

export interface SlotGridOps {
    createCell(slot: string, data: SlotCellInput): Promise<SlotCell[]>;
    updateCell(cell: SlotCell, data: SlotCellInput): Promise<SlotCell[]>;
    deleteCell(cell: SlotCell): Promise<SlotCell[]>;
}

export interface UseSlotGridArgs {
    slots: string[];
    cells: SlotCell[];
    storagePrefix: string;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    ops: SlotGridOps;
    onChanged: (cells: SlotCell[]) => void;
    /** Appelé quand ⌘V est pressé sur une multi-sélection avec un presse-papier multi-cellules. */
    onNeedsPasteWarning?: () => void;
}

export interface UseSlotGridResult {
    selectedSlots: Set<string>;
    isDragging: boolean;
    hasClipboard: boolean;
    entryMap: Map<string, SlotCell>;
    onSelect(slot: string, e: React.MouseEvent): void;
    onCellMouseDown(slot: string, e: React.MouseEvent): void;
    onDragExtend(slot: string): void;
    onContextMenuOpen(slot: string): void;
    onCopy(): void;
    onCut(): void;
    onPaste(slot: string): void;
    onClearRange(slots: Set<string>): void;
    onConvertToBreak(slots: Set<string>): void;
    onDropFavorite(slot: string): void;
    /** Crée / met à jour / supprime la cellule d'un créneau. `null` sur une cellule existante = suppression. */
    save(slot: string, data: SlotCellInput | null): Promise<void>;
    clearSelection(): void;
    /** true si le clic vient de terminer un drag (le consommateur ne doit pas déclencher un clic simple). */
    consumeDragMoved(): boolean;
}

export function useSlotGrid({
    slots,
    cells,
    storagePrefix,
    scrollRef,
    ops,
    onChanged,
    onNeedsPasteWarning,
}: UseSlotGridArgs): UseSlotGridResult {
    const entryMap = useMemo(
        () => new Map(cells.map((c) => [c.startedAt, c])),
        [cells],
    );

    // ── Sélection ─────────────────────────────────────────────────────────
    const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
    const [anchorSlot, setAnchorSlot] = useState<string | null>(null);
    const [activeSlot, setActiveSlot] = useState<string | null>(null);

    const slotRange = useCallback(
        (from: string, to: string): string[] => {
            const a = slots.indexOf(from);
            const b = slots.indexOf(to);
            if (-1 === a || -1 === b) return [from];
            const [lo, hi] = a <= b ? [a, b] : [b, a];
            return slots.slice(lo, hi + 1);
        },
        [slots],
    );

    const selectSingle = useCallback((slot: string) => {
        setSelectedSlots(new Set([slot]));
        setAnchorSlot(slot);
        setActiveSlot(slot);
    }, []);

    const extendToSlot = useCallback(
        (to: string) => {
            setSelectedSlots(new Set(slotRange(anchorSlot ?? to, to)));
            setActiveSlot(to);
        },
        [anchorSlot, slotRange],
    );

    const toggleSlot = useCallback((slot: string) => {
        setSelectedSlots((prev) => {
            const next = new Set(prev);
            if (next.has(slot)) next.delete(slot);
            else next.add(slot);
            return next;
        });
        setAnchorSlot(slot);
        setActiveSlot(slot);
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedSlots(new Set());
        setAnchorSlot(null);
        setActiveSlot(null);
    }, []);

    const onSelect = useCallback(
        (slot: string, e: React.MouseEvent) => {
            if (e.shiftKey && anchorSlot) extendToSlot(slot);
            else if (e.ctrlKey || e.metaKey) toggleSlot(slot);
            else selectSingle(slot);
        },
        [anchorSlot, extendToSlot, toggleSlot, selectSingle],
    );

    // Clic hors grille → efface la sélection
    useEffect(() => {
        if (0 === selectedSlots.size) return;
        function onDocClick(e: MouseEvent) {
            if (scrollRef.current?.contains(e.target as Node)) return;
            clearSelection();
        }
        document.addEventListener('click', onDocClick);
        return () => document.removeEventListener('click', onDocClick);
    }, [selectedSlots.size, scrollRef, clearSelection]);

    // ── Drag ──────────────────────────────────────────────────────────────
    const [isDragging, setIsDragging] = useState(false);
    const dragMovedRef = useRef(false);

    const onCellMouseDown = useCallback(
        (slot: string, e: React.MouseEvent) => {
            if (0 !== e.button) return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            dragMovedRef.current = false;
            selectSingle(slot);
            setIsDragging(true);
        },
        [selectSingle],
    );

    const onDragExtend = useCallback(
        (slot: string) => {
            if (!isDragging) return;
            dragMovedRef.current = true;
            extendToSlot(slot);
        },
        [isDragging, extendToSlot],
    );

    const consumeDragMoved = useCallback(() => {
        if (dragMovedRef.current) {
            dragMovedRef.current = false;
            return true;
        }
        return false;
    }, []);

    useEffect(() => {
        if (!isDragging) return;
        function onUp() { setIsDragging(false); }
        document.addEventListener('mouseup', onUp);
        return () => document.removeEventListener('mouseup', onUp);
    }, [isDragging]);

    useEffect(() => {
        if (!isDragging) return;
        let lastY = 0;
        let frame = 0;
        function onMove(e: MouseEvent) { lastY = e.clientY; }
        function tick() {
            const el = scrollRef.current;
            if (el) {
                const r = el.getBoundingClientRect();
                const t = 60;
                if (lastY > r.top && lastY < r.top + t) el.scrollTop -= 6;
                else if (lastY < r.bottom && lastY > r.bottom - t) el.scrollTop += 6;
            }
            frame = requestAnimationFrame(tick);
        }
        document.addEventListener('mousemove', onMove);
        frame = requestAnimationFrame(tick);
        return () => {
            document.removeEventListener('mousemove', onMove);
            cancelAnimationFrame(frame);
        };
    }, [isDragging, scrollRef]);

    // ── Scroll persistant ────────────────────────────────────────────────
    useEffect(() => {
        const el = scrollRef.current;
        if (null === el) return;
        const saved = sessionStorage.getItem(`${storagePrefix}_scroll`);
        el.scrollTop = null !== saved ? parseInt(saved, 10) : 0;
        function onScroll() {
            if (el) sessionStorage.setItem(`${storagePrefix}_scroll`, String(el.scrollTop));
        }
        el.addEventListener('scroll', onScroll);
        return () => el.removeEventListener('scroll', onScroll);
    }, [storagePrefix, scrollRef]);

    // ── Presse-papier ────────────────────────────────────────────────────
    const [clipboard, setClipboard] = useState<ClipboardData | null>(() => readClipboard());
    useEffect(() => subscribeClipboard(() => setClipboard(readClipboard())), []);

    const onCopy = useCallback(() => {
        const sorted = [...selectedSlots].sort();
        if (0 === sorted.length) return;
        const anchorIdx = slots.indexOf(sorted[0] as string);
        const value: ClipboardData = {
            cells: sorted.map((slot) => {
                const idx = slots.indexOf(slot);
                const entry = entryMap.get(slot) ?? null;
                return {
                    offset: idx - anchorIdx,
                    ticketKey: entry?.ticketKey ?? null,
                    ticketSummary: entry?.ticketSummary ?? null,
                    ticketType: entry?.ticketType ?? null,
                    comment: entry?.comment ?? null,
                    type: entry?.type ?? EntryType.WORK,
                    isEmpty: null === entry,
                };
            }),
        };
        setClipboard(value);
        writeClipboard(value);
    }, [selectedSlots, slots, entryMap]);

    // ── Garde anti-double-soumission + historique ────────────────────────
    const pendingSlotsRef = useRef<Set<string>>(new Set());
    const [undoStack, setUndoStack] = useState<SlotCell[][]>([]);
    const [redoStack, setRedoStack] = useState<SlotCell[][]>([]);

    useEffect(() => {
        try {
            const u = sessionStorage.getItem(`${storagePrefix}_undo`);
            setUndoStack(u ? (JSON.parse(u) as SlotCell[][]) : []);
        } catch { setUndoStack([]); }
        try {
            const r = sessionStorage.getItem(`${storagePrefix}_redo`);
            setRedoStack(r ? (JSON.parse(r) as SlotCell[][]) : []);
        } catch { setRedoStack([]); }
    }, [storagePrefix]);

    const persistStacks = useCallback(
        (u: SlotCell[][], r: SlotCell[][]) => {
            sessionStorage.setItem(`${storagePrefix}_undo`, JSON.stringify(u));
            sessionStorage.setItem(`${storagePrefix}_redo`, JSON.stringify(r));
        },
        [storagePrefix],
    );

    const pushHistory = useCallback(() => {
        const u = [...undoStack.slice(-49), cells];
        setUndoStack(u);
        setRedoStack([]);
        persistStacks(u, []);
    }, [undoStack, cells, persistStacks]);

    const reconcile = useCallback(
        async (target: SlotCell[]) => {
            const curMap = new Map(cells.map((c) => [c.startedAt, c]));
            const tgtMap = new Map(target.map((c) => [c.startedAt, c]));
            let latest: SlotCell[] = cells;
            for (const [, cur] of curMap) {
                if (!tgtMap.has(cur.startedAt)) latest = await ops.deleteCell(cur);
            }
            for (const [, tgt] of tgtMap) {
                if (!curMap.has(tgt.startedAt)) {
                    latest = await ops.createCell(tgt.startedAt, {
                        ticketKey: tgt.ticketKey,
                        ticketSummary: tgt.ticketSummary,
                        ticketType: tgt.ticketType,
                        comment: tgt.comment,
                        type: tgt.type,
                        endedAt: tgt.endedAt ?? getNextSlot(tgt.startedAt),
                    });
                }
            }
            for (const [, tgt] of tgtMap) {
                const cur = curMap.get(tgt.startedAt);
                if (cur && (
                    cur.ticketKey !== tgt.ticketKey
                    || cur.type !== tgt.type
                    || cur.comment !== tgt.comment
                    || cur.ticketSummary !== tgt.ticketSummary
                    || cur.ticketType !== tgt.ticketType
                )) {
                    latest = await ops.updateCell(cur, {
                        ticketKey: tgt.ticketKey,
                        ticketSummary: tgt.ticketSummary,
                        ticketType: tgt.ticketType,
                        comment: tgt.comment,
                        type: tgt.type,
                        endedAt: cur.endedAt ?? getNextSlot(cur.startedAt),
                    });
                }
            }
            onChanged(latest);
        },
        [cells, ops, onChanged],
    );

    const handleUndo = useCallback(async () => {
        const target = undoStack[undoStack.length - 1];
        if (!target) return;
        const u = undoStack.slice(0, -1);
        const r = [...redoStack, cells];
        setUndoStack(u);
        setRedoStack(r);
        persistStacks(u, r);
        try { await reconcile(target); } catch { /* ops gèrent */ }
    }, [undoStack, redoStack, cells, persistStacks, reconcile]);

    const handleRedo = useCallback(async () => {
        const target = redoStack[redoStack.length - 1];
        if (!target) return;
        const u = [...undoStack, cells];
        const r = redoStack.slice(0, -1);
        setUndoStack(u);
        setRedoStack(r);
        persistStacks(u, r);
        try { await reconcile(target); } catch { /* ops gèrent */ }
    }, [undoStack, redoStack, cells, persistStacks, reconcile]);

    // ── Opérations ───────────────────────────────────────────────────────
    const save = useCallback(
        async (slot: string, data: SlotCellInput | null) => {
            if (pendingSlotsRef.current.has(slot)) return;
            pendingSlotsRef.current.add(slot);
            const existing = entryMap.get(slot);
            try {
                if (data === null) {
                    if (existing) { pushHistory(); onChanged(await ops.deleteCell(existing)); }
                    return;
                }
                if (existing) {
                    if (
                        existing.type === data.type
                        && existing.ticketKey === data.ticketKey
                        && existing.comment === data.comment
                        && existing.ticketSummary === data.ticketSummary
                        && existing.ticketType === data.ticketType
                    ) return;
                    pushHistory();
                    onChanged(await ops.updateCell(existing, data));
                } else {
                    pushHistory();
                    onChanged(await ops.createCell(slot, data));
                }
            } catch {
                /* ops gèrent le message */
            } finally {
                pendingSlotsRef.current.delete(slot);
            }
        },
        [entryMap, ops, onChanged, pushHistory],
    );

    const onClearRange = useCallback(
        async (targetSlots: Set<string>) => {
            const toDelete = [...targetSlots]
                .map((s) => entryMap.get(s))
                .filter((c): c is SlotCell => !!c);
            if (0 === toDelete.length) return;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const cell of toDelete) {
                try { latest = await ops.deleteCell(cell); } catch { /* */ }
            }
            onChanged(latest);
        },
        [entryMap, cells, ops, onChanged, pushHistory],
    );

    const onConvertToBreak = useCallback(
        async (targetSlots: Set<string>) => {
            const arr = [...targetSlots];
            const toConvert = arr
                .map((s) => entryMap.get(s))
                .filter((c): c is SlotCell => !!c && c.type !== EntryType.BREAK);
            const empties = arr.filter((s) => !entryMap.has(s));
            if (0 === toConvert.length && 0 === empties.length) return;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const cell of toConvert) {
                try {
                    latest = await ops.updateCell(cell, {
                        ticketKey: null, ticketSummary: null, ticketType: null,
                        comment: null, type: EntryType.BREAK,
                        endedAt: cell.endedAt ?? getNextSlot(cell.startedAt),
                    });
                } catch { /* */ }
            }
            for (const slot of empties) {
                if (pendingSlotsRef.current.has(slot)) continue;
                pendingSlotsRef.current.add(slot);
                try {
                    latest = await ops.createCell(slot, {
                        ticketKey: null, ticketSummary: null, ticketType: null,
                        comment: null, type: EntryType.BREAK, endedAt: getNextSlot(slot),
                    });
                } catch { /* */ } finally {
                    pendingSlotsRef.current.delete(slot);
                }
            }
            onChanged(latest);
        },
        [entryMap, cells, ops, onChanged, pushHistory],
    );

    const applyClipboardCell = useCallback(
        async (destSlot: string, cell: ClipboardData['cells'][number]): Promise<SlotCell[] | null> => {
            const existing = entryMap.get(destSlot) ?? null;
            if (cell.isEmpty) {
                return existing ? await ops.deleteCell(existing) : null;
            }
            const data: SlotCellInput = {
                ticketKey: cell.ticketKey,
                ticketSummary: cell.ticketSummary,
                ticketType: cell.ticketType,
                comment: cell.comment,
                type: cell.type,
                endedAt: existing?.endedAt ?? getNextSlot(destSlot),
            };
            return existing ? await ops.updateCell(existing, data) : await ops.createCell(destSlot, data);
        },
        [entryMap, ops],
    );

    const onPaste = useCallback(
        async (targetSlot: string) => {
            if (null === clipboard || 0 === clipboard.cells.length) return;
            const targetIdx = slots.indexOf(targetSlot);
            if (-1 === targetIdx) return;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const cell of clipboard.cells) {
                const destIdx = targetIdx + cell.offset;
                if (destIdx < 0 || destIdx >= slots.length) continue;
                const destSlot = slots[destIdx] as string;
                if (pendingSlotsRef.current.has(destSlot)) continue;
                pendingSlotsRef.current.add(destSlot);
                try {
                    const r = await applyClipboardCell(destSlot, cell);
                    if (r) latest = r;
                } catch { /* */ } finally {
                    pendingSlotsRef.current.delete(destSlot);
                }
            }
            onChanged(latest);
        },
        [clipboard, slots, cells, onChanged, pushHistory, applyClipboardCell],
    );

    const onPasteToMultiple = useCallback(
        async (targetSlots: string[]) => {
            if (null === clipboard || 0 === clipboard.cells.length) return;
            const cell = clipboard.cells[0]!;
            pushHistory();
            let latest: SlotCell[] = cells;
            for (const slot of targetSlots) {
                if (pendingSlotsRef.current.has(slot)) continue;
                pendingSlotsRef.current.add(slot);
                try {
                    const r = await applyClipboardCell(slot, cell);
                    if (r) latest = r;
                } catch { /* */ } finally {
                    pendingSlotsRef.current.delete(slot);
                }
            }
            onChanged(latest);
        },
        [clipboard, cells, onChanged, pushHistory, applyClipboardCell],
    );

    const onCut = useCallback(async () => {
        onCopy();
        await onClearRange(selectedSlots);
    }, [onCopy, onClearRange, selectedSlots]);

    const onDropFavorite = useCallback((slot: string) => { void onPaste(slot); }, [onPaste]);

    const onContextMenuOpen = useCallback(
        (slot: string) => { if (!selectedSlots.has(slot)) selectSingle(slot); },
        [selectedSlots, selectSingle],
    );

    // ── Raccourcis clavier ───────────────────────────────────────────────
    const selKeyRef = useRef<((e: KeyboardEvent) => void) | null>(null);
    selKeyRef.current = (e: KeyboardEvent) => {
        if (0 === selectedSlots.size) return;
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        const ctrl = e.metaKey || e.ctrlKey;
        if (ctrl && 'c' === e.key) { e.preventDefault(); onCopy(); }
        else if (ctrl && 'x' === e.key) { e.preventDefault(); void onCut(); }
        else if (ctrl && 'v' === e.key) {
            e.preventDefault();
            if (selectedSlots.size > 1 && clipboard?.cells.length === 1) void onPasteToMultiple([...selectedSlots]);
            else if (selectedSlots.size > 1) onNeedsPasteWarning?.();
            else { const t = anchorSlot ?? [...selectedSlots][0]; if (t) void onPaste(t); }
        } else if ('Delete' === e.key || 'Backspace' === e.key) { e.preventDefault(); void onClearRange(selectedSlots); }
        else if ('ArrowUp' === e.key || 'ArrowDown' === e.key) {
            e.preventDefault();
            const cur = activeSlot ?? anchorSlot ?? [...selectedSlots][0];
            if (!cur) return;
            const idx = slots.indexOf(cur);
            const nextIdx = 'ArrowUp' === e.key ? idx - 1 : idx + 1;
            if (nextIdx < 0 || nextIdx >= slots.length) return;
            const nextSlot = slots[nextIdx] as string;
            if (e.shiftKey) extendToSlot(nextSlot);
            else selectSingle(nextSlot);
        } else if ('Escape' === e.key) { e.preventDefault(); clearSelection(); }
    };
    useEffect(() => {
        function handler(e: KeyboardEvent) { selKeyRef.current?.(e); }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    const undoKeyRef = useRef<((e: KeyboardEvent) => void) | null>(null);
    undoKeyRef.current = (e: KeyboardEvent) => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        const ctrl = e.metaKey || e.ctrlKey;
        if (!ctrl) return;
        if ('z' === e.key && !e.shiftKey) { e.preventDefault(); void handleUndo(); }
        else if (('z' === e.key && e.shiftKey) || 'y' === e.key) { e.preventDefault(); void handleRedo(); }
    };
    useEffect(() => {
        function handler(e: KeyboardEvent) { undoKeyRef.current?.(e); }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    return {
        selectedSlots,
        isDragging,
        hasClipboard: null !== clipboard && clipboard.cells.length > 0,
        entryMap,
        onSelect,
        onCellMouseDown,
        onDragExtend,
        onContextMenuOpen,
        onCopy,
        onCut,
        onPaste,
        onClearRange,
        onConvertToBreak,
        onDropFavorite,
        save,
        clearSelection,
        consumeDragMoved,
    };
}
```

- [ ] **Step 2: Rebrancher `Timeline.tsx` sur `useSlotGrid`**

Objectif : `Timeline` ne garde que le DOM (gouttière, lignes, cellules, blocs visuels, `NowIndicator`), le câblage `EditPopover`, le `tick` de l'horloge, la modale « avertissement collage », et le mapping `WorkDay ↔ SlotCell`.

1. Imports : ajouter
   ```ts
   import { useSlotGrid } from '@/hooks/useSlotGrid';
   import type { SlotCell, SlotCellInput } from '@/hooks/useSlotGrid';
   ```
   Retirer les imports devenus inutiles (`getNextSlot` si plus référencé directement — vérifier ; `createEntry`/`deleteEntry`/`updateEntry` restent, utilisés par `ops`).

2. **Supprimer** du composant `Timeline` (désormais dans le hook) :
   - les states `selectedSlots` / `anchorSlot` / `activeSlot` / `isDragging` / `dragMovedRef` / `pendingSlotsRef` / `undoStack` / `redoStack` / `clipboard` ;
   - l'effet de synchro presse-papier, l'effet de chargement des piles undo/redo, l'effet de restauration du scroll ;
   - les fonctions `selectSingle` / `extendToSlot` / `toggleSlot` / `clearSelection` / `handleSelect` / `startDrag` / `handleDragExtend` ; les deux effets de drag (`onMouseUp`, auto-scroll) ;
   - `pushHistory` / `reconcileWorkDay` / `handleUndo` / `handleRedo` ;
   - `handleSave` / `handleBulkClear` / `handleBulkConvertToBreak` / `handleCopySelection` / `handleCutSelection` / `handlePaste` / `handlePasteToMultiple` ;
   - `getSlotRange` (module) ;
   - les deux blocs `selectionKeyHandlerRef` / `undoRedoKeyHandlerRef` + leurs `useEffect` ;
   - `handleScroll`.
   **Garder** : `runKey`, `computeRunMap`, `getNowPosition`, `SLOT_HEIGHT`, `TIME_SLOTS`, `visualBlocks`, `runMap`, `entryMap` (recalculé — voir ci-dessous), `knownTickets`, `tick` + son effet, `getEditAnchorTop`, `NowIndicator`, la modale collage.

3. Mapper `WorkDay.entries` → `SlotCell[]` et brancher le hook. Juste après `knownTickets` :
   ```ts
   const cells = useMemo<SlotCell[]>(
       () => workDay.entries.map((e) => ({
           id: e.id,
           ticketKey: e.ticketKey,
           ticketSummary: e.ticketSummary,
           ticketType: e.ticketType,
           comment: e.comment,
           type: e.type,
           startedAt: e.startedAt,
           endedAt: e.endedAt,
       })),
       [workDay.entries],
   );

   const ops = useMemo(() => ({
       async createCell(slot: string, data: SlotCellInput): Promise<SlotCell[]> {
           const updated = await createEntry(workDay.date, {
               startedAt: slot,
               endedAt: data.endedAt,
               ticketKey: data.ticketKey,
               type: data.type,
               comment: data.comment,
               ticketSummary: data.ticketSummary,
               ticketType: data.ticketType,
           });
           onWorkDayUpdate(updated);
           return mapEntries(updated);
       },
       async updateCell(cell: SlotCell, data: SlotCellInput): Promise<SlotCell[]> {
           const updated = await updateEntry(workDay.date, cell.id, {
               ticketKey: data.ticketKey,
               type: data.type,
               comment: data.comment,
               ticketSummary: data.ticketSummary,
               ticketType: data.ticketType,
           });
           onWorkDayUpdate(updated);
           return mapEntries(updated);
       },
       async deleteCell(cell: SlotCell): Promise<SlotCell[]> {
           const updated = await deleteEntry(workDay.date, cell.id);
           onWorkDayUpdate(updated);
           return mapEntries(updated);
       },
   }), [workDay.date, onWorkDayUpdate]);

   const grid = useSlotGrid({
       slots: TIME_SLOTS,
       cells,
       storagePrefix: `daytrack_${workDay.date}`,
       scrollRef,
       ops,
       onChanged: () => { /* onWorkDayUpdate déjà appelé par ops */ },
       onNeedsPasteWarning: () => setShowPasteWarning(true),
   });
   const entryMap = grid.entryMap;
   ```
   Ajouter en tête de fichier (module) le helper :
   ```ts
   function mapEntries(wd: WorkDay): SlotCell[] {
       return wd.entries.map((e) => ({
           id: e.id, ticketKey: e.ticketKey, ticketSummary: e.ticketSummary,
           ticketType: e.ticketType, comment: e.comment, type: e.type,
           startedAt: e.startedAt, endedAt: e.endedAt,
       }));
   }
   ```

4. Dans le JSX, remplacer les handlers passés à `<TimeBlock>` et au conteneur scrollable :
   - `onSelect={(e) => grid.onSelect(slot, e)}`
   - `onCellMouseDown={(e) => grid.onCellMouseDown(slot, e)}`
   - `onDragExtend={() => grid.onDragExtend(slot)}`
   - `onContextMenuOpen={() => grid.onContextMenuOpen(slot)}`
   - `onCopy={() => grid.onCopy()}`
   - `onCut={() => void grid.onCut()}`
   - `onPaste={() => void grid.onPaste(slot)}`
   - `onClear={() => void grid.onClearRange(effectiveSelection)}`
   - `onConvertToBreak={() => void grid.onConvertToBreak(effectiveSelection)}`
   - `onDropFavorite={() => grid.onDropFavorite(slot)}`
   - `isSelected={grid.selectedSlots.has(slot)}`
   - `hasClipboard={grid.hasClipboard}`
   - conteneur scrollable : `onClick={() => { if (!grid.consumeDragMoved()) grid.clearSelection(); }}`
   - `effectiveSelection` : inchangé, mais lire `grid.selectedSlots` :
     ```ts
     const effectiveSelection =
         grid.selectedSlots.has(slot) && grid.selectedSlots.size > 1
             ? grid.selectedSlots
             : new Set([slot]);
     ```
   - le layer « rings de sélection » : `[...grid.selectedSlots].map(...)`.

5. `EditPopover` `onSave` :
   ```ts
   onSave={(ticketKey, type, comment, ticketSummary, ticketType) => {
       setEditingSlot(null);
       void grid.save(editingSlot, ticketKey === null && type !== EntryType.BREAK
           ? null
           : { ticketKey, ticketSummary, ticketType, comment, type, endedAt: getNextSlot(editingSlot) });
   }}
   ```
   `onClear` : `onClear={() => { const ex = entryMap.get(editingSlot); if (ex) void grid.save(editingSlot, null); setEditingSlot(null); setEditMousePos(null); }}`.
   (garder l'import `getNextSlot`.)

6. Vérifier qu'aucune référence morte ne subsiste (`npx tsc --noEmit` le confirmera).

- [ ] **Step 3: Vérifier — compilation + non-régression COMPLÈTE de la vue jour**

```bash
npx tsc --noEmit
npm run dev && docker compose restart php
```

Navigateur `https://daytrack.localhost/<aujourd'hui>` — dérouler **toute** la check-list :

1. Créer un bloc (double-clic → ticket) → s'affiche, header mis à jour.
2. Créer un bloc multi-créneaux par clic-glisser.
3. Double-clic sur un bloc → popover pré-rempli → modifier le ticket + commentaire → OK.
4. Clic droit → « Convertir en pause » → bloc pause.
5. Sélection : clic simple, shift-clic (plage), ⌘/Ctrl-clic (toggle).
6. Flèches ↑/↓ déplacent la sélection ; shift+↑/↓ l'étendent ; Escape l'efface.
7. ⌘C sur une plage puis ⌘V sur une autre cellule → collage aux bons offsets.
8. ⌘X → coupe. Coller-multiple : sélectionner plusieurs cellules, presse-papier 1 cellule, ⌘V → applique partout.
9. ⌘V sur multi-sélection avec presse-papier multi → modale d'avertissement.
10. Delete/Backspace sur une sélection → efface les blocs.
11. ⌘Z annule la dernière action (création, suppression, édition, collage) ; ⌘⇧Z / ⌘Y refait.
12. Drag près du bord haut/bas pendant une sélection → auto-scroll.
13. Recharger la page → position de scroll restaurée ; piles undo/redo restaurées (⌘Z fonctionne encore).
14. Drag d'un favori depuis la sidebar sur une cellule → bloc créé.
15. Indicateur « maintenant » visible et positionné (si on est dans la plage horaire).

Toute divergence de comportement = blocage : corriger avant de committer.

- [ ] **Step 4: Commit**

```bash
git add assets/hooks/useSlotGrid.ts assets/components/timeline/Timeline.tsx
git commit -m "refactor: extraire le moteur d'interaction de la timeline dans useSlotGrid"
```

---

## Task 3: Rendre `TimeBlock` générique (menu contextuel injecté)

**Files:**
- Modify: `assets/components/timeline/TimeBlock.tsx`
- Modify: `assets/components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: composants `ContextMenu*` (`@/components/ui/context-menu`).
- Produces : `TimeBlock` n'impose plus le contenu du menu contextuel. Nouvelle prop `menu: React.ReactNode` (le `<ContextMenuContent>` fourni par le consommateur). Les props `onCopy` / `onCut` / `onPaste` / `onClear` / `onConvertToBreak` / `hasClipboard` / `entry` disparaissent de `TimeBlock` (le consommateur les gère dans son `menu`). Restent : `slot`, `isSelected`, `onSelect`, `onStartEdit`, `onContextMenuOpen`, `onCellMouseDown`, `onDragExtend`, `onDropFavorite`.

- [ ] **Step 1: Réécrire `assets/components/timeline/TimeBlock.tsx`**

```tsx
import { useState } from 'react';
import {
    ContextMenu,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface TimeBlockProps {
    slot: string;
    isSelected: boolean;
    /** Contenu du menu contextuel (`<ContextMenuContent>…</ContextMenuContent>`) fourni par le consommateur. */
    menu: React.ReactNode;
    onSelect: (e: React.MouseEvent) => void;
    onStartEdit: (x: number, y: number) => void;
    onContextMenuOpen: () => void;
    onCellMouseDown: (e: React.MouseEvent) => void;
    onDragExtend: () => void;
    onDropFavorite: () => void;
}

/**
 * Cellule d'interaction transparente d'un créneau (grille jour + grille Modèles).
 * Toute la logique (sélection, drag, presse-papier, undo…) est dans useSlotGrid ;
 * ce composant ne fait que capter les événements souris et déclencher le menu.
 */
export default function TimeBlock({
    slot,
    isSelected,
    menu,
    onSelect,
    onStartEdit,
    onContextMenuOpen,
    onCellMouseDown,
    onDragExtend,
    onDropFavorite,
}: TimeBlockProps) {
    const [isDragOver, setIsDragOver] = useState(false);

    return (
        <ContextMenu onOpenChange={(open) => { if (open) onContextMenuOpen(); }}>
            <ContextMenuTrigger asChild>
                <div
                    data-slot={slot}
                    className="w-full h-full cursor-pointer select-none relative rounded-sm"
                    style={{
                        background: isDragOver ? 'rgba(99,102,241,0.08)' : undefined,
                        boxShadow: isDragOver ? 'inset 0 0 0 2px #818cf8' : undefined,
                    }}
                    onClick={(e) => { e.stopPropagation(); onSelect(e); }}
                    onDoubleClick={(e) => { e.preventDefault(); onStartEdit(e.clientX, e.clientY); }}
                    onMouseDown={(e) => onCellMouseDown(e)}
                    onMouseEnter={() => onDragExtend()}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (e.dataTransfer.getData('application/daytrack-favorite')) onDropFavorite();
                    }}
                />
            </ContextMenuTrigger>
            {menu}
        </ContextMenu>
    );
}
```

- [ ] **Step 2: Fournir le menu depuis `Timeline.tsx`**

Extraire le contenu de menu actuel dans un petit composant `TimelineBlockMenu` (fichier `assets/components/timeline/TimelineBlockMenu.tsx`) :

```tsx
import { Coffee, Copy, Scissors, Clipboard, Trash2 } from 'lucide-react';
import { EntryType } from '@/types/api';
import type { SlotCell } from '@/hooks/useSlotGrid';
import { t } from '@/i18n/fr';
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';

interface TimelineBlockMenuProps {
    entry: SlotCell | null;
    hasClipboard: boolean;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onClear: () => void;
    onConvertToBreak: () => void;
}

export default function TimelineBlockMenu({
    entry, hasClipboard, onCopy, onCut, onPaste, onClear, onConvertToBreak,
}: TimelineBlockMenuProps) {
    return (
        <ContextMenuContent className="min-w-[200px]">
            {entry && (
                <ContextMenuItem onClick={onCopy} className="gap-2 text-sm">
                    <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.copy')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘C</span>
                </ContextMenuItem>
            )}
            {entry && (
                <ContextMenuItem onClick={onCut} className="gap-2 text-sm">
                    <Scissors className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.cut')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘X</span>
                </ContextMenuItem>
            )}
            {hasClipboard && (
                <ContextMenuItem onClick={onPaste} className="gap-2 text-sm">
                    <Clipboard className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.paste')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘V</span>
                </ContextMenuItem>
            )}
            {entry?.type !== EntryType.BREAK && <ContextMenuSeparator className="mx-1" />}
            {entry?.type !== EntryType.BREAK && (
                <ContextMenuItem onClick={onConvertToBreak} className="gap-2 text-sm">
                    <Coffee className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.convert_to_break')}
                </ContextMenuItem>
            )}
            <ContextMenuSeparator className="mx-1" />
            <ContextMenuItem variant="destructive" onClick={onClear} className="gap-2 text-sm">
                <Trash2 className="w-3.5 h-3.5 shrink-0 text-destructive" />
                {t('timeline.clear')}
                <span className="ml-auto font-mono text-[11px] text-muted-foreground opacity-60">⌫</span>
            </ContextMenuItem>
        </ContextMenuContent>
    );
}
```

Dans `Timeline.tsx`, le rendu de `<TimeBlock>` devient :
```tsx
<TimeBlock
    slot={slot}
    isSelected={grid.selectedSlots.has(slot)}
    onSelect={(e) => grid.onSelect(slot, e)}
    onStartEdit={(x, y) => { setEditMousePos({ x, y }); setEditingSlot(slot); }}
    onContextMenuOpen={() => grid.onContextMenuOpen(slot)}
    onCellMouseDown={(e) => grid.onCellMouseDown(slot, e)}
    onDragExtend={() => grid.onDragExtend(slot)}
    onDropFavorite={() => grid.onDropFavorite(slot)}
    menu={
        <TimelineBlockMenu
            entry={entry}
            hasClipboard={grid.hasClipboard}
            onCopy={() => grid.onCopy()}
            onCut={() => void grid.onCut()}
            onPaste={() => void grid.onPaste(slot)}
            onClear={() => void grid.onClearRange(effectiveSelection)}
            onConvertToBreak={() => void grid.onConvertToBreak(effectiveSelection)}
        />
    }
/>
```

- [ ] **Step 3: Vérifier**

```bash
npx tsc --noEmit
npm run dev && docker compose restart php
```
Navigateur vue jour : le menu contextuel d'un bloc affiche Copier / Couper / Coller / Convertir en pause / Effacer et chaque action fonctionne (re-dérouler points 3, 4, 7, 8, 10 de la check-list Task 2).

- [ ] **Step 4: Commit**

```bash
git add assets/components/timeline/TimeBlock.tsx assets/components/timeline/TimelineBlockMenu.tsx assets/components/timeline/Timeline.tsx
git commit -m "refactor: TimeBlock générique, menu contextuel injecté par le consommateur"
```

---

## Task 4: `TemplateColumn` consomme `useSlotGrid`

**Files:**
- Modify: `assets/components/templates/TemplateColumn.tsx`
- Delete: `assets/components/templates/TemplateCell.tsx`
- Modify: `assets/components/templates/TemplateBlockMenu.tsx`

**Interfaces:**
- Consumes: `useSlotGrid` + `SlotCell` / `SlotCellInput` (`@/hooks/useSlotGrid`) ; `TimeBlock` (`@/components/timeline/TimeBlock`) ; `entryRulesForWeekday` (`@/utils/templateGrid`) ; `createTemplateRule` / `updateTemplateRule` / `deleteTemplateRule` (`@/services/templateRuleService`).
- Produces : la colonne Modèles gère désormais sélection multiple, drag de plage, copier/couper/coller (clavier + menu), coller-multiple, undo/redo, navigation clavier, double-clic → `EditPopover`. Le layer de cellules d'interaction utilise `TimeBlock` (plus `TemplateCell`, supprimé). `TemplateBlockMenu` est étendu pour être le `menu` injecté : il porte à la fois les entrées « grille » (copier/couper/coller/convertir/effacer) et les entrées « règle » (récurrence, activer/désactiver, supprimer, éditer).

- [ ] **Step 1: Étendre `TemplateBlockMenu` pour couvrir les deux familles d'actions**

Réécrire `assets/components/templates/TemplateBlockMenu.tsx` — il devient le `<ContextMenuContent>` complet d'une cellule Modèles :

```tsx
import { Coffee, Copy, Scissors, Clipboard, Trash2 } from 'lucide-react';
import type { TemplateRule } from '@/types/api';
import { EntryType, TemplateRuleType } from '@/types/api';
import type { SlotCell } from '@/hooks/useSlotGrid';
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
    entry: SlotCell | null;
    rule: TemplateRule | null; // règle correspondant au créneau, si le bloc existe
    hasClipboard: boolean;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onClear: () => void;
    onConvertToBreak: () => void;
    onEdit: () => void;
    onToggleType: () => void;
    onSetInterval: (n: number) => void;
    onSetEndDate: () => void;
    onClearEndDate: () => void;
    onToggleEnabled: () => void;
    onDelete: () => void;
}

const INTERVAL_CHOICES = [1, 2, 3, 4];

export default function TemplateBlockMenu(p: TemplateBlockMenuProps) {
    const isBreak = p.entry?.type === EntryType.BREAK;

    return (
        <ContextMenuContent className="min-w-[220px]">
            {p.entry && (
                <ContextMenuItem onClick={p.onCopy} className="gap-2 text-sm">
                    <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.copy')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘C</span>
                </ContextMenuItem>
            )}
            {p.entry && (
                <ContextMenuItem onClick={p.onCut} className="gap-2 text-sm">
                    <Scissors className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.cut')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘X</span>
                </ContextMenuItem>
            )}
            {p.hasClipboard && (
                <ContextMenuItem onClick={p.onPaste} className="gap-2 text-sm">
                    <Clipboard className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.paste')}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘V</span>
                </ContextMenuItem>
            )}

            {p.rule && <ContextMenuSeparator className="mx-1" />}
            {p.rule && !isBreak && (
                <ContextMenuItem className="text-sm" onClick={p.onEdit}>{t('templates.block.edit')}</ContextMenuItem>
            )}
            {p.rule && (
                <ContextMenuItem className="text-sm" onClick={p.onToggleType}>
                    {isBreak ? t('templates.block.convert_to_work') : t('timeline.convert_to_break')}
                </ContextMenuItem>
            )}
            {!p.rule && (
                <ContextMenuItem className="gap-2 text-sm" onClick={p.onConvertToBreak}>
                    <Coffee className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    {t('timeline.convert_to_break')}
                </ContextMenuItem>
            )}

            {p.rule && (
                <>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger className="text-sm">{t('templates.recurrence.menu')}</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                            <ContextMenuRadioGroup value={String(p.rule.intervalWeeks)}>
                                {INTERVAL_CHOICES.map((n) => (
                                    <ContextMenuRadioItem key={n} value={String(n)} className="text-sm" onClick={() => p.onSetInterval(n)}>
                                        {n === 1
                                            ? t('templates.recurrence.every_week')
                                            : t('templates.recurrence.every_n_weeks').replace('{n}', String(n))}
                                    </ContextMenuRadioItem>
                                ))}
                            </ContextMenuRadioGroup>
                            <ContextMenuSeparator />
                            <ContextMenuItem className="text-sm" onClick={p.onSetEndDate}>
                                {t('templates.recurrence.set_end_date')}
                            </ContextMenuItem>
                            {p.rule.activeUntil !== null && (
                                <ContextMenuItem className="text-sm" onClick={p.onClearEndDate}>
                                    {t('templates.recurrence.clear_end_date')}
                                </ContextMenuItem>
                            )}
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem className="text-sm" onClick={p.onToggleEnabled}>
                        {p.rule.enabled ? t('templates.block.disable') : t('templates.block.enable')}
                    </ContextMenuItem>
                </>
            )}

            <ContextMenuSeparator className="mx-1" />
            <ContextMenuItem variant="destructive" className="gap-2 text-sm" onClick={p.rule ? p.onDelete : p.onClear}>
                <Trash2 className="w-3.5 h-3.5 shrink-0 text-destructive" />
                {p.rule ? t('templates.block.delete') : t('timeline.clear')}
            </ContextMenuItem>
        </ContextMenuContent>
    );
}
```
(Importer uniquement `EntryType` depuis `@/types/api` — `TemplateRuleType` n'est pas utilisé dans ce composant.)

- [ ] **Step 2: Réécrire `TemplateColumn.tsx` autour de `useSlotGrid`**

Le câblage reprend **exactement** le patron de `Timeline.tsx` (Task 2 Step 2 + Task 3) : `cells` mappées depuis les données, `ops` branchés sur le service, `useSlotGrid(...)`, `<TimeBlock>` par créneau avec `menu={<…>}`, `EditPopover` câblé sur `grid.save`. Ci-dessous, seules les spécificités Modèles.

Structure cible du composant :

```tsx
import { useMemo, useRef, useState } from 'react';
import type { JiraTicketInfo, TemplateRule } from '@/types/api';
import { EntryType, TemplateRuleType } from '@/types/api';
import {
    DEFAULT_TARGET_MINUTES, SLOT_PX, formatMinutes, getNextSlot, parseTarget, shiftDate, today,
} from '@/utils/timeline';
import {
    GRID_SLOTS, buildColumnBlocks, entryRulesForWeekday, nextOccurrenceOnOrAfter,
    targetRuleForWeekday, timeToMinutes, weekdayLabel,
} from '@/utils/templateGrid';
import { getBlockColors } from '@/config/ticketTypeColors';
import {
    createTemplateRule, deleteTemplateRule, updateTemplateRule,
} from '@/services/templateRuleService';
import { useSlotGrid } from '@/hooks/useSlotGrid';
import type { SlotCell, SlotCellInput } from '@/hooks/useSlotGrid';
import { WorkBlock, PauseBlock } from '@/components/timeline/blocks';
import TimeBlock from '@/components/timeline/TimeBlock';
import EditPopover from '@/components/timeline/EditPopover';
import { t } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import TemplateBlockMenu from './TemplateBlockMenu';

interface TemplateColumnProps {
    iso: number;
    rules: TemplateRule[];
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    onNeedsPasteWarning: () => void;
}
```

Points clés de l'implémentation :

1. **`cells`** = `entryRulesForWeekday(rules, iso)` mappées :
   ```ts
   const columnRules = useMemo(() => entryRulesForWeekday(rules, iso), [rules, iso]);
   const ruleBySlot = useMemo(
       () => new Map(columnRules.filter((r) => r.startTime).map((r) => [r.startTime as string, r])),
       [columnRules],
   );
   const cells = useMemo<SlotCell[]>(
       () => columnRules
           .filter((r) => r.startTime && r.durationMinutes)
           .map((r) => ({
               id: r.id,
               ticketKey: r.ticketKey,
               ticketSummary: r.ticketSummary,
               ticketType: r.ticketType,
               comment: r.comment,
               type: r.ruleType === TemplateRuleType.BREAK ? EntryType.BREAK : EntryType.WORK,
               startedAt: r.startTime as string,
               endedAt: addMinutes(r.startTime as string, r.durationMinutes as number),
           })),
       [columnRules],
   );
   ```
   avec un helper module `addMinutes(hhmm, mins)` (réutilise `timeToMinutes` + `minutesToTime` de `templateGrid`).

2. **`ops`** sur `templateRuleService`. `createCell` calcule `durationMinutes` depuis `data.endedAt` :
   ```ts
   const ops = useMemo(() => ({
       async createCell(slot: string, data: SlotCellInput): Promise<SlotCell[]> {
           const isBreak = data.type === EntryType.BREAK;
           await createTemplateRule({
               ruleType: isBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
               weekday: iso,
               startTime: slot,
               durationMinutes: Math.max(15, timeToMinutes(data.endedAt) - timeToMinutes(slot)),
               intervalWeeks: 1,
               ...(isBreak ? {} : { ticketKey: data.ticketKey, ticketSummary: data.ticketSummary, ticketType: data.ticketType, comment: data.comment }),
           });
           onChanged();
           return [];
       },
       async updateCell(cell: SlotCell, data: SlotCellInput): Promise<SlotCell[]> {
           const rule = ruleBySlot.get(cell.startedAt);
           const targetIsBreak = data.type === EntryType.BREAK;
           if (rule && targetIsBreak !== (rule.ruleType === TemplateRuleType.BREAK)) {
               // PUT ne change pas ruleType → delete + recreate en préservant récurrence/rotation
               await deleteTemplateRule(cell.id);
               await createTemplateRule({
                   ruleType: targetIsBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                   weekday: iso,
                   startTime: cell.startedAt,
                   durationMinutes: Math.max(15, timeToMinutes(data.endedAt) - timeToMinutes(cell.startedAt)),
                   intervalWeeks: rule.intervalWeeks,
                   anchorDate: rule.anchorDate,
                   activeUntil: rule.activeUntil,
                   enabled: rule.enabled,
                   rotationGroupId: rule.rotationGroupId,
                   ...(targetIsBreak ? {} : { ticketKey: data.ticketKey, ticketSummary: data.ticketSummary, ticketType: data.ticketType, comment: data.comment }),
               });
           } else {
               await updateTemplateRule(cell.id, {
                   ticketKey: targetIsBreak ? null : data.ticketKey,
                   ticketSummary: targetIsBreak ? null : data.ticketSummary,
                   ticketType: targetIsBreak ? null : data.ticketType,
                   comment: targetIsBreak ? null : data.comment,
               });
           }
           onChanged();
           return [];
       },
       async deleteCell(cell: SlotCell): Promise<SlotCell[]> {
           await deleteTemplateRule(cell.id);
           onChanged();
           return [];
       },
   }), [iso, ruleBySlot, onChanged]);
   ```
   > `ops.*` renvoie `[]` : la source de vérité est le rechargement déclenché par `onChanged()` (la page recharge `rules`, qui redérive `cells`). Le hook rappelle `onChanged([])` en plus — sans effet ici (voir `onChanged` passé au hook ci-dessous, qui ignore son argument).

3. **Le hook** :
   ```ts
   const grid = useSlotGrid({
       slots: GRID_SLOTS,
       cells,
       storagePrefix: `daytrack_tmpl_${iso}`,
       scrollRef,
       ops,
       onChanged: () => { /* ops appellent déjà props.onChanged (reload page) */ },
       onNeedsPasteWarning,
   });
   ```

4. **Édition** : `editingSlot` / `editMousePos` locaux, `EditPopover` câblé sur `grid.save` :
   ```ts
   onSave={(ticketKey, type, comment, ticketSummary, ticketType) => {
       const s = editingSlot;
       setEditingSlot(null);
       if (!s) return;
       void grid.save(s, ticketKey === null && type !== EntryType.BREAK
           ? null
           : { ticketKey, ticketSummary, ticketType, comment, type, endedAt: getNextSlot(s) });
   }}
   ```
   Pour l'édition d'un bloc existant (double-clic ou menu « Éditer »), passer l'`entry` synthétique construit depuis la règle (comme aujourd'hui) et ancrer via l'événement souris réel (double-clic) ou le rect du bloc (menu — voir Task 5).

5. **Le layer de cellules** : `GRID_SLOTS.map` de `<TimeBlock>` (comme Timeline), `menu={<TemplateBlockMenu entry={grid.entryMap.get(slot) ?? null} rule={ruleBySlot.get(slot) ?? null} hasClipboard={grid.hasClipboard} onCopy … onEdit … />}`. Les handlers `onSetInterval` / `onToggleEnabled` / `onDelete` / `onSetEndDate` / `onClearEndDate` / `onToggleType` restent ceux déjà écrits (Task 7 du plan précédent), inchangés.

6. **Trois layers superposés dans le corps de la colonne** (`<div className="relative" style={{ height: gridHeight }}>`), du plus bas au plus haut :
   - **z2 — blocs visuels** (`WorkBlock` / `PauseBlock` via `buildColumnBlocks`), `pointer-events-none`. L'enveloppe de bloc n'est plus `ContextMenuTrigger`.
   - **z5 — cellules d'interaction** : `GRID_SLOTS.map` de `<TimeBlock>` (comme Timeline). Porte le clic / double-clic / clic droit / drag.
   - **z10 — overlay alternance** : `pointer-events-none`, contient par bloc le badge de rotation (`rotationSize > 1`, display-only) **et** le bouton « + » (`rotationGroupId === null`), ce dernier en `pointer-events-auto`. Placé au-dessus de la couche d'interaction pour rester cliquable ; il n'éclipse qu'un carré de 16 px dans le coin du créneau.

7. **`consumeDragMoved`** : chaque colonne gère le clic de fond de son propre corps — `onClick={() => { if (!grid.consumeDragMoved()) grid.clearSelection(); }}` sur le `<div className="relative">`.

8. **Suppression de l'empilement par drop.** Le flux « déposer un bloc sur un bloc existant → `StackPrompt` » disparaît (le drag sert maintenant à la sélection). **Retirer** de `TemplateColumn` : le state `stack`, `resolveReplace`, `resolveAlternate`, `closeStack`, le rendu `<StackPrompt>` et l'import. L'alternance se crée désormais **uniquement** via le bouton « + » (Task 6), qui porte sa propre logique complète. `StackPrompt.tsx` devient orphelin → `git rm` en fin de Task 4 (après `grep -rn StackPrompt assets/` pour confirmer).

- [ ] **Step 3: Adapter `TemplatesPage` — scrollRef partagé + avertissement collage**

Dans `assets/components/templates/TemplatesPage.tsx` :
- un seul `scrollRef` (`useRef<HTMLDivElement>(null)`) sur le conteneur `.flex-1.overflow-auto`, passé à chaque `<TemplateColumn scrollRef={scrollRef} … />` ;
- un state `showPasteWarning` + la même `<Dialog>` d'avertissement que `Timeline` (texte `t('timeline.paste_multiselection_warning')`), `onNeedsPasteWarning={() => setShowPasteWarning(true)}` passé à chaque colonne.

- [ ] **Step 4: Supprimer `TemplateCell.tsx`**

```bash
git rm assets/components/templates/TemplateCell.tsx
```
Vérifier qu'aucun import ne le référence (`grep -rn TemplateCell assets/`).

- [ ] **Step 5: Vérifier — parité Modèles**

```bash
npx tsc --noEmit
npm run dev && docker compose restart php
```

Base de règles vide (`curl -sk https://daytrack.localhost/api/template-rules` → `[]`). Sur `/modeles` :

1. Glisser une plage en colonne Lundi → popover → ticket → bloc multi-créneaux.
2. Double-clic sur le bloc → popover pré-rempli (ticket + titre Jira + commentaire).
3. Sélection multiple : shift-clic, ⌘/Ctrl-clic ; flèches ; Escape.
4. ⌘C sur une plage en Lundi → ⌘V sur une cellule en **Mardi** → blocs créés en Mardi (colonnes indépendantes, presse-papier partagé).
5. ⌘X ; coller-multiple ; Delete sur une sélection.
6. ⌘Z / ⌘⇧Z : créer 3 blocs en Lundi, ⌘Z ×3 → colonne vide ; ⌘⇧Z ×3 → blocs revenus. Undo en Lundi n'affecte pas Mardi.
7. Recharger : scroll restauré, piles undo restaurées.
8. Menu contextuel : Copier/Couper/Coller + Récurrence (1/2/3/4 sem., date de fin) + Activer/Désactiver + Supprimer — chaque action produit l'appel API attendu (`curl` pour vérifier `intervalWeeks`, `activeUntil`, `enabled`).
9. `curl` après création : règle `weekday`, `startTime`, `durationMinutes` = nb créneaux × 15, `intervalWeeks: 1`.

- [ ] **Step 6: Commit**

```bash
git add assets/components/templates/TemplateColumn.tsx assets/components/templates/TemplateBlockMenu.tsx assets/components/templates/TemplatesPage.tsx
git rm assets/components/templates/TemplateCell.tsx assets/components/templates/StackPrompt.tsx
git commit -m "feat: la grille Modèles consomme useSlotGrid (parité sélection/presse-papier/undo)"
```

---

## Task 5: Ancrage des popovers au bloc

**Files:**
- Modify: `assets/components/templates/TemplateColumn.tsx`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces : le `EditPopover` ouvert depuis le menu contextuel (« Éditer le ticket ») et le mini-popover « date de fin » s'ouvrent **au niveau du bloc** au lieu du centre de l'écran. On récupère le `DOMRect` de l'élément cliqué et on le passe en `mousePos` / position absolue.

- [ ] **Step 1: Capturer le rect du bloc à l'ouverture du menu**

Dans le layer visuel des blocs, poser une `ref` par bloc n'est pas nécessaire : `ContextMenu` de Radix rend son trigger ; on peut lire la position via l'événement. Le plus simple : le `TimeBlock` transmet déjà `onContextMenuOpen()` ; on ajoute un `onContextMenuOpenAt(rect: DOMRect)` en enrichissant `TimeBlock` :

Dans `assets/components/timeline/TimeBlock.tsx`, `ContextMenuTrigger` → capter le rect :
```tsx
<div
    ref={cellRef}
    …
    onContextMenu={() => { const r = cellRef.current?.getBoundingClientRect(); if (r) onContextMenuOpenAt?.(r); }}
/>
```
avec `const cellRef = useRef<HTMLDivElement>(null);` et une prop optionnelle `onContextMenuOpenAt?: (rect: DOMRect) => void;`.

- [ ] **Step 2: Utiliser le rect dans `TemplateColumn`**

- state `menuRect: DOMRect | null` ; `onContextMenuOpenAt={(r) => setMenuRect(r)}` sur chaque `TimeBlock`.
- « Éditer le ticket » : `openEdit(rule)` sans event → `setEditMousePos({ x: menuRect.left, y: menuRect.bottom + 4 })` (repli `{ x: innerWidth/2, y: 200 }` si `menuRect` nul).
- Mini-popover « date de fin » : `style={{ position: 'fixed', top: menuRect ? menuRect.bottom + 4 : 120, left: menuRect ? menuRect.left : '50%', transform: menuRect ? undefined : 'translateX(-50%)' }}`.

- [ ] **Step 3: Vérifier**

Sur `/modeles`, créer un bloc, clic droit :
- « Éditer le ticket » → le `EditPopover` s'ouvre collé sous le bloc (pas au centre).
- Récurrence ▸ « Ajouter une date de fin… » → le mini-popover s'ouvre sous le bloc.

- [ ] **Step 4: Commit**

```bash
git add assets/components/timeline/TimeBlock.tsx assets/components/templates/TemplateColumn.tsx
git commit -m "fix: ancrer les popovers Modèles au bloc au lieu du centre de l'écran"
```

---

## Task 6: Bouton « + » d'alternance sur le bloc

**Files:**
- Create: `assets/components/templates/AlternateButton.tsx`
- Modify: `assets/components/templates/TemplateColumn.tsx`
- Modify: `assets/i18n/fr.ts`

**Interfaces:**
- Consumes: `EditPopover` (`@/components/timeline/EditPopover`) ; `nextOccurrenceOnOrAfter` (`@/utils/templateGrid`) ; `today` / `shiftDate` (`@/utils/timeline`) ; `createTemplateRule` / `deleteTemplateRule` (`@/services/templateRuleService`).
- Produces : au survol d'un bloc dont `rotationGroupId === null`, un « + » apparaît (coin haut-droit). Clic → popover (ticket + date de départ). Validation → `DELETE` de la règle + `POST` de 2 membres `intervalWeeks: 2` partageant un `rotationGroupId` neuf, ancres à 7 j d'écart. Bloc déjà en rotation → pas de « + ».

- [ ] **Step 1: Clés i18n**

Dans `assets/i18n/fr.ts`, section `templates`, ajouter sous `stack` (ou une nouvelle sous-clé `alternate`) :
```ts
        alternate: {
            add: "Ajouter une alternance",
            title: "Alterner ce créneau une semaine sur deux",
            ticket_label: "Ticket de l'autre semaine",
            start_label: "À partir de quelle semaine ?",
            start_hint: "Jamais dans le passé — aujourd'hui par défaut.",
            confirm: "Créer l'alternance",
            cancel: "Annuler",
        },
```

- [ ] **Step 2: Créer `assets/components/templates/AlternateButton.tsx`**

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { TemplateRule } from '@/types/api';
import { EntryType, TemplateRuleType } from '@/types/api';
import { today, shiftDate } from '@/utils/timeline';
import { nextOccurrenceOnOrAfter } from '@/utils/templateGrid';
import { createTemplateRule, deleteTemplateRule } from '@/services/templateRuleService';
import { fetchTicketInfo } from '@/services/jiraService';
import type { JiraTicketInfo } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n/fr';

interface AlternateButtonProps {
    rule: TemplateRule;
    iso: number;
    knownTickets: Record<string, JiraTicketInfo>;
    onChanged: () => void;
}

/** Bouton « + » au survol d'un bloc simple : transforme le créneau en alternance à 2 membres. */
export default function AlternateButton({ rule, iso, knownTickets, onChanged }: AlternateButtonProps) {
    const [open, setOpen] = useState(false);
    const [ticket, setTicket] = useState('');
    const [startDate, setStartDate] = useState(today());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit() {
        const key = ticket.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
        if (!key) { setError(t('templates.error.save')); return; }
        setBusy(true);
        setError(null);
        try {
            let info: JiraTicketInfo | null = null;
            try { info = await fetchTicketInfo(key, knownTickets); } catch (e) {
                setError(e instanceof Error ? e.message : t('templates.error.save'));
                setBusy(false);
                return;
            }
            const groupId = crypto.randomUUID();
            const anchor0 = nextOccurrenceOnOrAfter(startDate, iso);
            const anchor1 = shiftDate(anchor0, 7);
            const wasBreak = rule.ruleType === TemplateRuleType.BREAK;
            await deleteTemplateRule(rule.id);
            await createTemplateRule({
                ruleType: wasBreak ? TemplateRuleType.BREAK : TemplateRuleType.WORK,
                weekday: iso,
                startTime: rule.startTime,
                durationMinutes: rule.durationMinutes,
                intervalWeeks: 2,
                anchorDate: anchor0,
                rotationGroupId: groupId,
                ...(wasBreak ? {} : { ticketKey: rule.ticketKey, ticketSummary: rule.ticketSummary, ticketType: rule.ticketType, comment: rule.comment }),
            });
            await createTemplateRule({
                ruleType: TemplateRuleType.WORK,
                weekday: iso,
                startTime: rule.startTime,
                durationMinutes: rule.durationMinutes,
                intervalWeeks: 2,
                anchorDate: anchor1,
                rotationGroupId: groupId,
                ticketKey: key,
                ticketSummary: info?.summary ?? null,
                ticketType: info?.type ?? null,
                comment: null,
            });
            setOpen(false);
            setTicket('');
            onChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : t('templates.error.save'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <button
                type="button"
                aria-label={t('templates.alternate.add')}
                title={t('templates.alternate.add')}
                onClick={(e) => { e.stopPropagation(); setStartDate(today()); setError(null); setOpen(true); }}
                className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded bg-amber-900/70 text-white opacity-60 transition-opacity hover:opacity-100"
            >
                <Plus className="h-3 w-3" />
            </button>

            {open && (
                <div
                    className="fixed z-50 flex w-64 flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg"
                    style={{ top: 120, left: '50%', transform: 'translateX(-50%)' }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    <span className="text-[12px] font-medium">{t('templates.alternate.title')}</span>
                    <label className="text-[12px] text-muted-foreground">{t('templates.alternate.ticket_label')}</label>
                    <Input
                        autoFocus
                        value={ticket}
                        onChange={(e) => { setTicket(e.target.value); setError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setOpen(false); }}
                        placeholder="PROJ-123"
                        className="h-8 font-mono text-[13px] uppercase"
                        disabled={busy}
                    />
                    <label className="text-[12px] text-muted-foreground">{t('templates.alternate.start_label')}</label>
                    <input
                        type="date"
                        min={today()}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="h-8 rounded-md border border-input px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    <p className="text-[11px] text-muted-foreground">{t('templates.alternate.start_hint')}</p>
                    {error && <p className="text-[11px] text-red-500">{error}</p>}
                    <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                            {t('templates.alternate.cancel')}
                        </Button>
                        <Button size="sm" onClick={() => void submit()} disabled={busy}>
                            {t('templates.alternate.confirm')}
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
}
```

- [ ] **Step 3: Monter le bouton dans le layer overlay (z10) de `TemplateColumn`**

Dans le layer overlay `z10` (`pointer-events-none`) décrit en Task 4 Step 2 point 6, pour chaque bloc, positionner une enveloppe absolue sur le coin haut-droit du bloc (`top: startSlotIndex * SLOT_PX + 3`, `right: leftPct%`-relatif) contenant :
```tsx
{rule.rotationGroupId === null
    ? <AlternateButton rule={rule} iso={iso} knownTickets={knownTickets} onChanged={onChanged} />
    : <span className="rounded bg-amber-900/80 px-1 text-[10px] font-semibold text-white">{rotationIndex + 1}/{rotationSize}</span>}
```
Le badge de rotation et le bouton « + » sont mutuellement exclusifs (selon `rotationGroupId`). Le layer étant `pointer-events-none`, seul le `<button>` d'`AlternateButton` (qui porte `pointer-events-auto`) est cliquable ; son popover est `position: fixed` donc non contraint par le layer.

- [ ] **Step 4: Vérifier**

Sur `/modeles`, base vide, créer un bloc `SCRUM-1` en Lundi :
- un « + » discret est visible en haut à droite du bloc (opacité ~60 %, 100 % au survol) ;
- clic → popover ; saisir `SCRUM-2`, date par défaut, « Créer l'alternance » ;
- `curl` : **2 règles** `weekday:1`, `intervalWeeks:2`, même `rotationGroupId`, `anchorDate` distants de 7 j, l'une `SCRUM-1` l'autre `SCRUM-2` ;
- la colonne affiche les 2 blocs côte à côte avec badges 1/2 · 2/2 ; **plus de « + »** sur ces blocs ;
- supprimer un membre (menu → Supprimer) → l'autre repasse `intervalWeeks:1`, `rotationGroupId:null`, et le « + » réapparaît.

- [ ] **Step 5: Commit**

```bash
git add assets/components/templates/AlternateButton.tsx assets/components/templates/TemplateColumn.tsx assets/i18n/fr.ts
git commit -m "feat: bouton + sur un bloc Modèles pour créer une alternance"
```

---

## Task 7: Sidebar favoris dans la vue Modèles

**Files:**
- Modify: `assets/components/layout/FavoritesPanel.tsx`
- Modify: `assets/components/templates/TemplatesPage.tsx`

**Interfaces:**
- Consumes: `FavoritesPanel` (`@/components/layout/FavoritesPanel`) ; `listFavorites` (`@/services/favoriteService`).
- Produces : `FavoritesPanel` accepte `tone?: 'neutral' | 'amber'` (défaut `'neutral'`) qui bascule les tokens de couleur du chrome. `TemplatesPage` monte `<FavoritesPanel tone="amber" …>` à gauche de la grille et charge la liste des favoris. Le drop d'un favori sur un créneau crée une règle (chemin `onDropFavorite` du moteur, déjà en place).

- [ ] **Step 1: Prop `tone` sur `FavoritesPanel`**

Dans `assets/components/layout/FavoritesPanel.tsx` :
```ts
interface FavoritesPanelProps {
    favorites: FavoriteTicket[];
    onChange: (favorites: FavoriteTicket[]) => void;
    tone?: 'neutral' | 'amber';
}
```
```ts
const chrome = tone === 'amber'
    ? { aside: 'bg-amber-50', handleIdle: 'bg-amber-200', handleHover: 'group-hover:bg-amber-900', title: 'text-amber-800' }
    : { aside: 'bg-neutral-50', handleIdle: 'bg-neutral-200', handleHover: 'group-hover:bg-neutral-900', title: 'text-neutral-500' };
```
- `<aside className={cn('w-full h-full py-4 ps-2 pe-4 flex flex-col overflow-hidden', chrome.aside)}>` ;
- titre : `className={cn('text-xs font-semibold', chrome.title)}` ;
- poignée de resize : `className={cn('absolute inset-y-0 right-0 w-px group-hover:w-[2px] transition-all', chrome.handleIdle, chrome.handleHover)}`.
Aucun autre changement (pills, drag & drop, ajout, renommage inchangés).

- [ ] **Step 2: Monter la sidebar dans `TemplatesPage`**

```tsx
import FavoritesPanel from '@/components/layout/FavoritesPanel';
import { listFavorites } from '@/services/favoriteService';
import type { FavoriteTicket } from '@/types/api';
// …
const [favorites, setFavorites] = useState<FavoriteTicket[]>([]);
useEffect(() => { void listFavorites().then(setFavorites).catch(() => null); }, []);
```
Layout : envelopper le corps dans un `flex` horizontal, `FavoritesPanel` à gauche, la grille (gouttière + colonnes) à droite dans un conteneur qui **garde** le `scrollRef` :
```tsx
<div className="flex flex-1 overflow-hidden">
    <FavoritesPanel favorites={favorites} onChange={setFavorites} tone="amber" />
    <div ref={scrollRef} className="flex-1 overflow-auto">
        {/* gouttière + 7 colonnes, inchangé */}
    </div>
</div>
```

- [ ] **Step 3: Vérifier**

Sur `/modeles` :
- la sidebar favoris est visible à gauche, fond ambré, cohérente avec la vue ;
- les favoris existants s'affichent, le redimensionnement fonctionne ;
- glisser un favori sur un créneau d'une colonne → un bloc est créé avec le ticket du favori ; `curl` confirme la règle.
- Revenir sur la vue jour (`Retour au jour`) : la sidebar y est toujours en teinte neutre (pas de régression).

- [ ] **Step 4: Commit**

```bash
git add assets/components/layout/FavoritesPanel.tsx assets/components/templates/TemplatesPage.tsx
git commit -m "feat: sidebar favoris dans la vue Modèles (teinte ambrée)"
```

---

## Task 8: Revue finale + build de production

**Files:** aucun (vérification).

- [ ] **Step 1: Build de production**

```bash
npx tsc --noEmit
npm run build
docker compose restart php
```
Expected : build Encore de production **sans erreur** ni warning TypeScript.

- [ ] **Step 2: Check-list complète**

Vue jour (`https://daytrack.localhost/<aujourd'hui>`) — re-dérouler les 15 points de la check-list Task 2 Step 3. Aucune régression.

Vue Modèles (`https://daytrack.localhost/modeles`, base de règles vide au départ) :
- [ ] Gouttière avec quarts d'heure ; objectif affiché `7h30` grisé, plein contraste si surchargé.
- [ ] Sidebar favoris ambrée ; drop d'un favori → règle.
- [ ] Glisser une plage → popover → bloc ; double-clic → détail/édition ; clic droit → menu complet.
- [ ] Sélection multiple (shift, ⌘/Ctrl) ; flèches ; Escape.
- [ ] ⌘C / ⌘X / ⌘V / coller-multiple ; copie d'une colonne, collage dans une autre ; copie depuis la vue jour, collage dans un modèle.
- [ ] ⌘Z / ⌘⇧Z par colonne ; isolation entre colonnes ; restauration après reload.
- [ ] Après un changement de récurrence / objectif / alternance, la pile undo des blocs reste opérante.
- [ ] Menu récurrence : 1/2/3/4 sem., date de fin (ajout + retrait), activer/désactiver, convertir travail↔pause, supprimer.
- [ ] Popovers (« Éditer le ticket », « date de fin ») ancrés au bloc.
- [ ] Bouton « + » : visible sur bloc simple, remplacé par le badge 1/2·2/2 sur bloc en rotation ; crée 2 règles `intervalWeeks:2` même `rotationGroupId`, ancres +7 j ; suppression d'un membre → l'autre repasse hebdo et le « + » revient.
- [ ] Aucune chaîne en dur (tout via `t()`), aucune classe Tailwind dynamique.
- [ ] `git status` : seuls les fichiers attendus ont bougé ; `TemplateCell.tsx` supprimé.

- [ ] **Step 3: Nettoyage des données de test**

```bash
curl -sk https://daytrack.localhost/api/template-rules | \
  docker compose exec -T php php -r '$r=json_decode(stream_get_contents(STDIN),true); foreach($r as $x){echo $x["id"],"\n";}' | \
  while read id; do curl -sk -X DELETE "https://daytrack.localhost/api/template-rules/$id"; done
curl -sk https://daytrack.localhost/api/template-rules   # -> []
```

- [ ] **Step 4: Commit (si des ajustements ont été nécessaires)**

Si l'étape 2 a nécessité des correctifs, les committer avec un message `fix: …` dédié. Sinon, rien à committer — cette tâche ne fait que valider.

---

## Récapitulatif

À l'issue de ce plan :
- `useSlotGrid` porte toute la logique d'interaction ; `Timeline.tsx` passe de ~900 à ~450 lignes ; `slotClipboard.ts` centralise le presse-papier.
- La vue Modèles a la **parité** avec la Timeline : sélection simple/multiple, drag de plage, copier/couper/coller (clavier + menu), coller-multiple, undo/redo par colonne, navigation clavier, double-clic → détail.
- Presse-papier **partagé** jour ↔ modèle ; undo/redo Modèles limité aux blocs (pas récurrence/alternance/objectif).
- Popovers ancrés au bloc ; bouton « + » d'alternance ; sidebar favoris ambrée.
- `TemplateCell.tsx` supprimé ; `TimeBlock` est la cellule d'interaction générique commune aux deux vues.

### Écarts connus assumés

- L'empilement par « déposer un bloc sur un bloc existant » (`StackPrompt`) disparaît : le drag sert maintenant à la sélection (parité Timeline). L'alternance se crée par le bouton « + ». `StackPrompt.tsx` et `TemplateCell.tsx` sont supprimés (Task 4).
- Undo/redo ne couvre pas récurrence / alternance / objectif (décision spec).
- Rotation à ≥ 3 éléments : toujours hors scope.
- Pas de tests automatisés (aucun runner) — vérification manuelle à chaque tâche.
