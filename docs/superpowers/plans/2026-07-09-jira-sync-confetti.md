# Effet confettis à la synchronisation JIRA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Déclencher un petit effet de confettis localisé sur le bouton de synchro JIRA lorsque la synchro se termine avec succès et qu'au moins une entrée a été envoyée.

**Architecture:** Un utilitaire pur `fireConfettiFromElement(element)` dans `assets/utils/confetti.ts`, basé sur la lib `canvas-confetti`, calcule l'origine de l'effet à partir de la position du bouton et lance une explosion de confettis contenue (peu de particules, dispersion/vitesse/durée de vie réduites). `JiraSyncButton.tsx` garde une `ref` sur son bouton et appelle cet utilitaire au moment où `handleConfirm` détecte un succès avec `syncedCount > 0`.

**Tech Stack:** React 19 + TypeScript strict, `canvas-confetti` (nouvelle dépendance npm).

## Global Constraints

- Code (identifiants, fichiers) en anglais ; commentaires en français.
- Pas de `"use client"`, pas de classes Tailwind dynamiques.
- Aucune nouvelle clé i18n nécessaire (pas de texte visible ajouté).
- Aucun changement backend/PHP.
- Le projet n'a pas de framework de test JS installé (`package.json` ne liste ni jest ni vitest) : la vérification de ce plan est **manuelle**, via le navigateur, conformément à la section "Tests / vérification" du spec (`docs/superpowers/specs/2026-07-09-jira-sync-confetti-design.md`). Chaque tâche se termine par une vérification `tsc --noEmit` (typage) + un contrôle visuel manuel.
- Style du projet : commentaires `/** */` au-dessus des fonctions exportées (voir `JiraSyncButton.tsx` existant), imports natifs via `use` côté PHP (non applicable ici, frontend only).

---

### Task 1: Utilitaire `fireConfettiFromElement`

**Files:**
- Modify: `package.json` (ajout dépendance `canvas-confetti` + devDependency `@types/canvas-confetti`)
- Create: `assets/utils/confetti.ts`

**Interfaces:**
- Produces: `fireConfettiFromElement(element: HTMLElement | null): void` — exporté depuis `@/utils/confetti`, utilisé par Task 2.

- [ ] **Step 1: Installer les dépendances**

Run:
```bash
npm install canvas-confetti
npm install -D @types/canvas-confetti
```

Expected: `package.json` gagne une entrée `"canvas-confetti": "^1.9.x"` dans `dependencies` et `"@types/canvas-confetti": "^1.9.x"` dans `devDependencies`.

- [ ] **Step 2: Créer l'utilitaire**

Créer `assets/utils/confetti.ts` :

```ts
import confetti from 'canvas-confetti';

/** Nombre de particules de l'explosion — volontairement faible pour rester discret */
const PARTICLE_COUNT = 50;
/** Dispersion en degrés — angle du cône de particules */
const SPREAD = 65;
/** Vitesse initiale des particules — modérée pour que l'effet reste proche du bouton */
const START_VELOCITY = 28;
/** Durée de vie des particules en frames — court pour éviter que l'effet envahisse l'écran */
const TICKS = 180;

/**
 * Déclenche une explosion de confettis contenue, centrée sur l'élément donné.
 * Ne fait rien si l'élément est absent (ex : ref pas encore montée).
 */
export function fireConfettiFromElement(element: HTMLElement | null): void {
    if (null === element) return;

    const rect = element.getBoundingClientRect();
    const origin = {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
    };

    void confetti({
        particleCount: PARTICLE_COUNT,
        spread: SPREAD,
        startVelocity: START_VELOCITY,
        ticks: TICKS,
        origin,
        disableForReducedMotion: true,
    });
}
```

- [ ] **Step 3: Vérifier le typage**

Run: `npx tsc --noEmit`
Expected: aucune erreur (le fichier compile, `canvas-confetti` a des types via `@types/canvas-confetti`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json assets/utils/confetti.ts
git commit -m "feat: ajouter l'utilitaire de confettis localisés"
```

---

### Task 2: Déclenchement depuis `JiraSyncButton`

**Files:**
- Modify: `assets/components/jira/JiraSyncButton.tsx`

**Interfaces:**
- Consumes: `fireConfettiFromElement(element: HTMLElement | null): void` depuis `@/utils/confetti` (Task 1).

- [ ] **Step 1: Importer l'utilitaire et ajouter la ref**

Dans `assets/components/jira/JiraSyncButton.tsx`, ajouter l'import en haut du fichier (après l'import de `JiraSyncModal`) :

```ts
import { fireConfettiFromElement } from '@/utils/confetti';
```

Ajouter la ref juste après la déclaration de `syncFingerprintRef` (ligne ~50) :

```ts
    // Ref sur le bouton — sert d'origine pour l'effet de confettis au succès de la synchro
    const buttonRef = useRef<HTMLButtonElement>(null);
```

- [ ] **Step 2: Déclencher l'effet dans `handleConfirm`**

Dans la branche succès de `handleConfirm` (le `else` du `if (Object.keys(result.errors).length > 0)`, ligne ~81-93), ajouter l'appel juste après `setSyncStatus('success')` :

```ts
            } else {
                const fp = entriesFingerprint(result.workDay);
                sessionStorage.setItem(syncFpKey(result.workDay.date), fp);
                syncFingerprintRef.current = fp;
                setSyncStatus('success');
                if (result.syncedCount > 0) {
                    fireConfettiFromElement(buttonRef.current);
                }
                setFeedback(
                    result.syncedCount > 0
                        ? t('jira.feedback.success').replace('{n}', String(result.syncedCount))
                        : t('jira.feedback.success_empty'),
                );
                onWorkDayUpdate(result.workDay);
                setTimeout(() => { setSyncStatus('idle'); setFeedback(null); }, 2000);
            }
```

- [ ] **Step 3: Attacher la ref au bouton compact**

Dans la branche `if (compact)` (ligne ~149-157), ajouter `ref={buttonRef}` au `<Button>` :

```tsx
                            <Button
                                ref={buttonRef}
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowModal(true)}
                                disabled={isDisabled}
                                className={cn('h-8 w-8', iconColor)}
                            >
```

- [ ] **Step 4: Attacher la ref au bouton complet**

Dans le rendu non-compact (ligne ~202-210), ajouter `ref={buttonRef}` au `<Button>` :

```tsx
                <Button
                    ref={buttonRef}
                    variant="default"
                    onClick={() => setShowModal(true)}
                    disabled={syncStatus === 'syncing'}
                    className="gap-1.5 w-full h-auto min-h-8 py-1.5 shrink whitespace-normal text-center"
                >
```

- [ ] **Step 5: Vérifier le typage**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Vérification manuelle**

1. Démarrer l'environnement si besoin : `docker compose up --wait`
2. Compiler les assets frontend : `npm run dev` (ou `npm run watch` pour rester en écoute)
3. Ouvrir `https://daytrack.localhost`
4. Créer au moins une entrée de type travail avec un ticket JIRA et une heure de fin sur la journée du jour
5. Cliquer sur le bouton de synchro JIRA (header ou panel récap), confirmer dans la modal
6. Observer : à la fin de la synchro (icône verte / message "Synchronisé"), des confettis doivent partir du bouton cliqué, sans couvrir tout l'écran
7. Relancer une synchro sur une journée déjà synchronisée sans modification (donc `syncedCount === 0`) → vérifier qu'aucun confetti n'apparaît
8. Simuler une erreur (ex : couper la connexion JIRA ou invalider la config) → vérifier qu'aucun confetti n'apparaît
9. Activer "Réduire les animations" dans les préférences système (`prefers-reduced-motion: reduce`) → vérifier qu'aucun confetti n'apparaît malgré un succès

Expected: comportement conforme aux 4 points ci-dessus dans les deux emplacements du bouton (header compact + panel récap).

- [ ] **Step 7: Commit**

```bash
git add assets/components/jira/JiraSyncButton.tsx
git commit -m "feat: déclencher les confettis au succès de la synchro JIRA"
```
