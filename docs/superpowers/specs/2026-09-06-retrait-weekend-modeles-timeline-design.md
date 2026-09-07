# Retrait du week-end des vues Modèles et Timeline

Date : 2026-09-06
Branche : `fix/templates-feedback`

## Contexte et objectif

Retour utilisateur sur la feature Modèle : le samedi et le dimanche ne servent à
rien, on ne travaille jamais ces jours-là. Il faut les retirer des vues
**Modèles** et **Timeline**.

État actuel :

- **Modèles** : `WEEKDAYS = [1,2,3,4,5,6,7]` dans `assets/utils/templateGrid.ts`
  pilote une grille de 7 colonnes (`TemplatesPage.tsx`).
- **Timeline** : vue mono-jour avec flèches préc./suiv. qui font
  `shiftDate(date, ±1)` (`TimelinePage.tsx` → `AppHeader.tsx`). Aucune vue
  semaine. `today()` peut tomber un week-end (c'est le cas le 2026-09-06, un
  samedi).

## Décisions

- **Timeline** : les flèches préc./suiv. sautent samedi/dimanche **et** ouvrir
  l'app un week-end (ou saisir une URL de week-end) redirige vers un jour ouvré.
- **Sens de la redirection** : un week-end renvoie au **vendredi précédent**
  (dernier jour ouvré écoulé).
- Inclure le nettoyage des clés i18n `weekday.6/.7` et l'ajustement du `min-w` de
  la grille Modèles.

## Périmètre

### 1. Vue Modèles

**`assets/utils/templateGrid.ts`**

- `WEEKDAYS` : `[1,2,3,4,5,6,7]` → `[1,2,3,4,5]`.
  Seul point de vérité : `TemplatesPage` itère dessus pour `rulesByIso`, la
  gouttière d'heures et les colonnes. La grille passe de 7 à 5 colonnes
  automatiquement.

**`assets/components/templates/TemplatesPage.tsx`**

- Conteneur de grille (`<div className="flex min-w-[1100px]">`, ~ligne 143) :
  `min-w-[1100px]` → `min-w-[800px]`. Cosmétique : évite d'étirer 5 colonnes
  inutilement ; `flex-1` continue de gérer les grands écrans.

**`assets/i18n/fr.ts`**

- Retirer les entrées `templates.weekday."6"` (« Samedi ») et
  `templates.weekday."7"` (« Dimanche »). Plus aucune référence après le passage
  de `WEEKDAYS` à 1–5 (`weekdayLabel` n'est appelé que pour les `iso` de
  `WEEKDAYS`).

**Backend — `src/Dto/Input/CreateTemplateRuleInput.php` et
`src/Dto/Input/UpdateTemplateRuleInput.php`**

- `#[Assert\Range(min: 1, max: 7)]` sur `$weekday` → `max: 5`.
  L'UI ne peut plus créer de règle week-end ; l'API refuse désormais aussi
  `weekday` 6/7 au lieu de laisser passer une règle que la vue n'affichera
  jamais.
- `nextOccurrence` (`TemplateRuleController`) et `TemplateRuleMatcher` :
  inchangés, corrects pour 1–5.

**Données existantes** : les `TemplateRule` de week-end déjà en base sont
ignorées silencieusement par la vue (le bucket `rulesByIso` n'existe plus). Pas
de suppression de données, pas de migration.

### 2. Vue Timeline

**`assets/utils/timeline.ts`** — nouveaux helpers :

- `isWeekend(date: string): boolean` — `date` au format `YYYY-MM-DD`, construite
  en heure locale (`new Date(date + 'T00:00:00')`), `getDay()` ∈ {0, 6}.
- `shiftWeekday(date: string, direction: 1 | -1): string` — avance/recule d'un
  jour ouvré en sautant samedi/dimanche (vendredi `+1` → lundi ; lundi `-1` →
  vendredi). Implémentation : `shiftDate` d'un jour puis, tant que le résultat
  est un week-end, `shiftDate` d'un jour dans la même direction.
- `defaultDate(): string` — `today()` s'il est un jour ouvré, sinon
  `shiftWeekday(today(), -1)` (= le vendredi précédent).

Pas de helper `previousWeekday` séparé : ce serait un pur alias de
`shiftWeekday(date, -1)`, on l'inline aux deux points d'appel.

**`assets/components/App.tsx`**

- Route `/` : `<Navigate to={\`/${defaultDate()}\`} replace />` au lieu de
  `today()`, pour ne pas afficher brièvement un jour de week-end avant que
  `TimelinePage` ne redirige.

**`assets/components/TimelinePage.tsx`**

- `isValidDate` inchangée. Après la validation, si `isWeekend(dateParam)` :
  `return <Navigate to={\`/${shiftWeekday(dateParam, -1)}\`} replace />;`.
  Ouvrir l'app un samedi (2026-09-06) affiche donc le vendredi.
- Fallback date absente/invalide : `<Navigate to={\`/${defaultDate()}\`} replace />`
  au lieu de `today()`, pour éviter un double redirect quand `today()` est un
  week-end.
- `onPrevious` : `navigate(\`/${shiftWeekday(date, -1)}\`)`.
- `onNext` : `navigate(\`/${shiftWeekday(date, 1)}\`)`.
- `onToday` : `navigate(\`/${defaultDate()}\`)`.

**`assets/components/layout/AppHeader.tsx`** (seul consommateur : `TimelinePage`)

- Tooltips des flèches préc./suiv. : `formatDate(shiftWeekday(date, -1))` et
  `formatDate(shiftWeekday(date, 1))` au lieu de `shiftDate(date, ±1)` — la bulle
  annonce la vraie cible (vendredi/lundi).
- `nextDisabled` : `shiftWeekday(date, 1) > shiftDate(today(), MAX_DAYS_AHEAD)`
  au lieu de `date >= shiftDate(today(), MAX_DAYS_AHEAD)`. Léger changement de
  sémantique à la borne `MAX_DAYS_AHEAD` (on désactive dès que le *prochain* jour
  ouvré dépasserait la borne), cohérent avec le saut de week-end.
- `isToday` : comparé à `defaultDate()` au lieu de `today()`, pour que le bouton
  « Aujourd'hui » soit désactivé quand on est déjà sur le jour ouvré courant un
  week-end.

**Choix assumé** : un week-end, le bouton « Aujourd'hui » navigue vers le
vendredi précédent tout en gardant son libellé « Aujourd'hui », et est désactivé
une fois sur ce vendredi. Acceptable : on ne travaille pas le week-end, il n'y a
pas de « aujourd'hui » ouvré à afficher.

## Hors périmètre

- Pas de vue semaine à modifier (la Timeline est mono-jour).
- Pas de purge des `TimeEntry` / `WorkDay` de week-end existants.
- Pas de blocage backend de la création d'un `WorkDay` un week-end (accessible
  seulement par URL directe, cas marginal ; la redirection front suffit).
- Pas de suppression des `TemplateRule` de week-end en base.

## Critères de succès

- Vue Modèles : 5 colonnes (Lundi → Vendredi), aucune trace de Samedi/Dimanche.
- Grille Modèles non étirée inutilement sur écran moyen.
- API : `POST`/`PATCH` d'une `TemplateRule` avec `weekday` 6 ou 7 → 422.
- Timeline : depuis vendredi, flèche suivante → lundi ; depuis lundi, flèche
  précédente → vendredi ; tooltips cohérents.
- Ouvrir `/2026-09-06` (samedi) → redirige vers `/2026-09-05` (vendredi).
- Ouvrir l'app sans date un week-end → affiche le vendredi précédent.
- Bouton « Aujourd'hui » désactivé quand on est déjà sur le jour ouvré courant.

## Tests

Le projet n'a aucun harnais de test JS (pas de vitest/jest, pas de script
`test`). On ne met pas en place un runner pour ce retour — vérification manuelle,
comme le reste du front :

- Vue Modèles : 5 colonnes Lundi → Vendredi, gouttière d'heures alignée, grille
  non étirée sur écran moyen.
- Timeline : depuis vendredi → flèche suivante = lundi ; depuis lundi → flèche
  précédente = vendredi ; tooltips des flèches cohérents avec la cible réelle.
- `/2026-09-06` (samedi) → redirige vers `/2026-09-05` (vendredi).
- `/` un week-end → affiche le vendredi précédent (sans clignotement sur une date
  de week-end).
- Bouton « Aujourd'hui » désactivé quand on est déjà sur le jour ouvré courant.
- API : `POST` puis `PATCH` d'une `TemplateRule` avec `weekday` = 6 → 422.
