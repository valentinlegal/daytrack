# Effet confettis à la synchronisation JIRA

## Contexte

Quand l'utilisateur synchronise ses temps avec JIRA via `JiraSyncButton`, l'app affiche déjà
un feedback textuel/couleur de succès (icône verte, message "Synchronisé"). L'objectif est
d'ajouter un petit effet de confettis localisé sur le bouton pour rendre ce moment plus
gratifiant, sans que ça devienne kitsch ni envahisse tout l'écran.

## Déclenchement

- L'effet se déclenche **au succès complet de la synchro** (`syncStatus === 'success'`,
  aucune erreur), pas au clic ni à l'ouverture de la modal de confirmation.
- Raison : la synchro fait de vrais appels réseau séquencés en 3 phases
  (`JiraSyncService::sync` — fetch / delete / create), donc un délai de l'ordre de la seconde
  est possible. Ce délai est déjà communiqué par le spinner existant
  (`syncStatus === 'syncing'`, icône `animate-spin`, texte "Synchronisation..."). Les
  confettis se déclenchent au même instant que le feedback de succès déjà présent
  (icône verte, checkmark) — ils n'introduisent pas de délai perçu supplémentaire.
- Déclencher au clic aurait été trompeur : la modal peut être annulée, et la synchro peut
  échouer ou revenir en erreur partielle.
- **Condition supplémentaire** : uniquement si `result.syncedCount > 0`. Le cas
  `syncedCount === 0` (succès "vide", rien à envoyer — message `jira.feedback.success_empty`)
  ne déclenche pas l'effet : il n'y a rien à célébrer.

## Boutons concernés

Les deux rendus de `JiraSyncButton` déclenchent l'effet quand c'est ce bouton précis qui a
été utilisé pour synchroniser :
- Mode `compact` (icône dans `AppHeader`)
- Mode complet (bouton pleine largeur dans `SummaryDrawer`)

Comme un seul rendu est monté à la fois (branchement `if (compact)`), un unique `buttonRef`
suffit dans le composant.

## Implémentation technique

### Dépendance

Ajout de `canvas-confetti` (dépendance) + `@types/canvas-confetti` (dev dépendance).
Librairie standard, ~4kb gzip, sans dépendance, API `confetti({ origin, ... })` qui permet de
positionner l'effet à un point précis de l'écran.

### Nouvel utilitaire `assets/utils/confetti.ts`

```ts
export function fireConfettiFromElement(element: HTMLElement | null): void
```

- Si `element` est `null`, ne fait rien (no-op sûr).
- Calcule l'origine `{x, y}` (ratios 0–1) à partir de `element.getBoundingClientRect()` et de
  `window.innerWidth` / `window.innerHeight`.
- Appelle `confetti()` avec des réglages qui contiennent visuellement l'effet près du bouton
  plutôt qu'un plein écran : nombre de particules limité (~40-60), dispersion (`spread`) et
  vitesse initiale (`startVelocity`) modérées, durée de vie (`ticks`) courte.
- Palette multicolore classique (comportement par défaut de `canvas-confetti`, pas de
  restriction de couleurs).
- `disableForReducedMotion: true` pour respecter `prefers-reduced-motion`.

### Modification de `JiraSyncButton.tsx`

- Ajout d'un `buttonRef = useRef<HTMLButtonElement>(null)`, attaché au `<Button>` dans les
  deux branches de rendu (compact et complet).
- Dans `handleConfirm`, branche succès sans erreur (`Object.keys(result.errors).length === 0`) :
  après `setSyncStatus('success')`, si `result.syncedCount > 0`, appel de
  `fireConfettiFromElement(buttonRef.current)`.
- Aucun appel si `syncedCount === 0` ou dans la branche erreur.

### Hors périmètre

- Pas de nouvelle clé i18n (aucun texte visible ajouté).
- Aucun changement backend/PHP.
- Pas de gestion spécifique multi-onglets/multi-fenêtres.

## Tests / vérification

Vérification manuelle en dev :
- Synchro avec au moins une entrée synchronisable → confettis visibles, partant du bouton
  utilisé (header et/ou panel récap).
- Synchro "vide" (`syncedCount === 0`) → pas de confettis.
- Synchro en erreur (partielle ou totale) → pas de confettis.
- `prefers-reduced-motion: reduce` activé → pas de confettis.
