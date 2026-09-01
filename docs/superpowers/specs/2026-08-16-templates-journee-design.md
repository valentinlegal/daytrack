# Templates de journée — design

Date : 2026-08-16
Statut : validé, en attente de plan d'implémentation

## Contexte et objectif

Les utilisateurs remontent le besoin de ne pas ressaisir chaque jour les mêmes
éléments récurrents : un ticket "Daily" tous les jours à 9h15, un "Poker
planning" un mercredi sur deux, un objectif réduit à 6h30 le vendredi, une
pause de 2h le midi les mardi/jeudi, une alternance de deux tickets sur le
même créneau une semaine sur deux, etc.

Objectif : permettre de définir des règles récurrentes qui pré-remplissent
automatiquement les journées vides, sans devenir une usine à gaz (cohérent
avec la philosophie du projet : saisie < 2 minutes/jour, flexibilité sans
complexité — voir [SPEC.md](../../../SPEC.md)).

## Vue d'ensemble

- Les règles récurrentes sont indépendantes les unes des autres (pas de
  "journée type" monolithique) — chaque règle décrit un seul élément
  (un ticket, une pause, ou un objectif de journée) et son propre pattern de
  récurrence. Plusieurs règles actives le même jour se cumulent simplement.
- Une journée qui n'existe pas encore en base est pré-remplie automatiquement
  à partir des règles actives ce jour-là, **au moment où l'utilisateur la
  modifie réellement** (pas à la simple consultation). Une fois qu'une
  journée existe en base (via template ou saisie manuelle), plus aucune
  règle ne la retouche : modifier un template plus tard n'affecte que les
  jours futurs pas encore ouverts/modifiés.
- La gestion des règles reprend les interactions de la grille timeline
  existante (clic-glisser, saisie ticket, marquage pause), sur une vue
  dédiée "Modèles" clairement distincte visuellement du mode jour réel.

## Modèle de données

### Entité `TemplateRule`

Nouvelle entité, aux côtés de `TimeEntry` / `WorkDay` / `FavoriteTicket`
(mêmes conventions : UUID, `strict_types=1`, property hooks PHP 8.4).

| Champ | Type | Description |
|---|---|---|
| `id` | Uuid | identifiant |
| `ruleType` | enum `TemplateRuleType` | `WORK`, `BREAK` ou `TARGET_OVERRIDE` |
| `startTime` | string `HH:mm`, nullable | heure de début — requis pour WORK/BREAK, `null` pour TARGET_OVERRIDE |
| `durationMinutes` | int, nullable | durée du bloc — requis pour WORK/BREAK, `null` pour TARGET_OVERRIDE |
| `ticketKey` / `ticketSummary` / `ticketType` | string, nullable | uniquement pour WORK (mêmes champs que `TimeEntry`) |
| `comment` | string, nullable | uniquement pour WORK, optionnel |
| `targetMinutes` | int, nullable | uniquement pour TARGET_OVERRIDE |
| `weekday` | int 1–7 (ISO-8601, 1 = lundi) | jour de semaine ciblé |
| `intervalWeeks` | int | 1 = toutes les semaines (défaut), 2 = une semaine sur deux, etc. |
| `anchorDate` | date | date de référence pour calculer la parité de semaine avec `intervalWeeks` — auto-fixée à la date de création de la règle (voir "Bornes de validité"), non modifiable vers le passé |
| `activeFrom` | date | **toujours égale à la date de création de la règle**, jamais éditable — garantit qu'une règle ne peut jamais matérialiser rétroactivement un jour antérieur à sa création |
| `activeUntil` | date, nullable | borne de fin optionnelle, éditable par l'utilisateur (règle temporaire) |
| `enabled` | bool | activer/désactiver sans supprimer |
| `rotationGroupId` | Uuid, nullable | tag purement UI (voir "Alternance") — n'intervient pas dans le calcul de récurrence |
| `position` | int | précédence si deux règles résolvent malgré tout sur le même horaire un jour donné (la plus grande gagne) |

### Enum `TemplateRuleType`

```php
enum TemplateRuleType: string
{
    case WORK = 'work';
    case BREAK = 'break';
    case TARGET_OVERRIDE = 'target_override';
}
```

## Moteur de récurrence

Service `TemplateRuleMatcher` (ou équivalent) exposant une méthode pure :

```php
matches(TemplateRule $rule, DateTimeImmutable $date): bool
```

Logique :
1. Si `enabled` est faux → ne matche jamais.
2. Si `$date < activeFrom` (toujours vrai pour un jour antérieur à la
   création de la règle) ou (`activeUntil` défini et `$date > activeUntil`)
   → ne matche pas. `activeFrom` étant figé à la création, ce point élimine
   par construction tout remplissage rétroactif d'un jour passé.
3. Matche si `$date` tombe sur `weekday` **et** que
   `intdiv((int) $date->diff($anchorDate)->days, 7) % $intervalWeeks === 0`
   (semaines pleines écoulées depuis `anchorDate`, modulo `intervalWeeks`).
   Pour `intervalWeeks = 1` (cas par défaut "toutes les semaines"), cette
   condition est toujours vraie dès que `weekday` matche — `anchorDate`
   n'a d'effet que si `intervalWeeks > 1`.

Aucune règle n'a besoin de connaître l'existence d'autres règles pour être
évaluée — le calcul est strictement local à la règle.

Récurrence mensuelle (ex. "le 1er de chaque mois") : aucun des cas d'usage
qui motivent cette fonctionnalité (voir "Contexte et objectif") n'en a
besoin — reportée hors V1 (voir "Hors scope").

## Application aux journées (matérialisation)

Deux mécanismes distincts, choisis pour que naviguer sur des jours ne crée
jamais de ligne en base, tout en gardant des identifiants (`TimeEntry.id`)
réels et stables dès qu'une entrée doit pouvoir être éditée ou supprimée
individuellement — une entrée non persistée n'a pas d'UUID (le générateur
Doctrine ne s'exécute qu'au `persist()`), donc on ne peut pas exposer un
`id` utilisable pour un `PUT`/`DELETE` tant qu'elle n'existe pas réellement
en base.

- **Lecture seule (`GET /api/days/{date}`)** : comportement inchangé dans
  son principe — si le jour n'existe pas en base, un `WorkDay` est
  construit en mémoire et retourné **sans être persisté** (`persisted:
  false` dans `WorkDayOutput`). Au lieu d'être vide, il est peuplé des
  `TimeEntry` calculées à partir des `TemplateRule` actives pour cette date
  (+ `targetMinutes` si une règle `TARGET_OVERRIDE` matche). Ces entrées
  virtuelles n'ont pas d'`id` réel (front : identifiant local temporaire,
  jamais envoyé au serveur). Naviguer sur 30 jours dans le futur ne crée
  donc aucune ligne en base.
- **Nouvel endpoint `POST /api/days/{date}/materialize`** : idempotent — si
  le jour existe déjà en base, le retourne tel quel ; sinon calcule les
  règles actives, persiste le `WorkDay` + les `TimeEntry` générées, et
  retourne le résultat avec de vrais `id`. C'est le seul endroit qui
  matérialise un jour vide sans qu'un contenu utilisateur ne soit fourni en
  même temps.
- **Le front appelle ce point de matérialisation juste avant la première
  interaction qui nécessite un `id` réel** sur un jour encore virtuel —
  typiquement éditer ou supprimer un bloc pré-rempli par template (`PUT`/
  `DELETE /api/days/{date}/entries/{id}`) — et met à jour son état local
  avec les `id` réels retournés avant d'envoyer la requête d'édition/
  suppression proprement dite. `EntryController::update()`/`delete()` ne
  changent donc pas : ils continuent de s'attendre à ce que le jour et
  l'entrée existent déjà (comportement actuel, 404 sinon).
- **`EntryController::create()`** garde son comportement actuel
  (`resolveDay(createIfMissing: true)`), simplement étendu pour matérialiser
  les règles actives au lieu de créer un jour vide, avant d'ajouter la
  nouvelle entrée demandée — un `POST` peut créer le jour sans passer par
  l'étape de matérialisation séparée puisqu'il ne référence aucun `id`
  existant.
- **`PATCH /api/days/{date}`** (objectif du jour) et
  **`POST /api/days/{date}/jira-sync`** suivent le même principe que
  `create()` : si le jour n'existe pas en base, il est matérialisé depuis
  les règles avant d'appliquer la modification/synchronisation demandée.
  `JiraSyncController`, qui retourne aujourd'hui une erreur
  `error.day_not_found` si le jour n'existe pas encore, est mis à jour pour
  matérialiser au lieu d'échouer.
- **Dédoublonnage défensif** : si deux règles calculent des `TimeEntry` dont
  les plages `[startTime, startTime + durationMinutes)` se chevauchent (cas
  limite, ne devrait pas arriver via l'UI d'édition normale — voir
  "Alternance"), seule celle avec la plus grande `position` est
  matérialisée pour l'occurrence en conflit. Ceci est cohérent avec la
  contrainte existante "deux entrées ne peuvent pas démarrer au même
  horaire" (`error.entry_time_conflict`), étendue au chevauchement complet.
  En complément, `POST /api/template-rules` refuse la création d'une règle
  WORK/BREAK activée si elle chevauche exactement (même `weekday`, même
  parité `intervalWeeks`/`anchorDate`, plage horaire qui se recoupe) une
  règle déjà active en dehors du flux d'empilement de la vue Modèles.
- Aucun lien n'est conservé entre une `TimeEntry` matérialisée et sa
  `TemplateRule` d'origine. Pas de badge "généré par template", pas de
  resynchronisation : une fois matérialisée, une journée se comporte
  exactement comme une journée saisie manuellement (undo/redo, sync JIRA,
  édition libre).

## Alternance sur un même créneau

Cas d'usage : Daily le mardi une semaine sur deux, Poker planning l'autre
semaine, sur le même créneau.

- Pas de mécanisme dédié séparé : une alternance à N éléments sur un même
  créneau est simplement N règles avec `intervalWeeks = N`, ancrées à des
  dates décalées d'une semaine chacune (élément 0 → `anchorDate` = date de
  départ, élément 1 → `anchorDate` + 7 jours, etc.).
- `rotationGroupId` est un tag purement UI qui permet d'afficher ces règles
  groupées dans l'éditeur et de recalculer proprement les ancrages si une
  alternative supplémentaire est ajoutée plus tard (rotation à 3 éléments ou
  plus) — il n'intervient pas dans `TemplateRuleMatcher`.
- **Suppression d'un membre d'un groupe à 2** : quand il ne reste plus qu'une
  seule règle dans un `rotationGroupId`, elle est automatiquement repassée
  en `intervalWeeks = 1` (et son `rotationGroupId` vidé) pour redevenir une
  règle hebdomadaire simple — sans cette conversion, elle continuerait à ne
  s'appliquer qu'une semaine sur deux avec un créneau vide silencieux
  l'autre semaine, ce qui serait incompréhensible pour l'utilisateur.

## UX — Vue "Modèles"

- Nouvelle vue accessible depuis le header/sidebar, dans un composant
  **dédié** à 7 colonnes génériques Lundi→Dimanche (pas de dates), qui
  réutilise les **sous-composants d'interaction** de la timeline existante
  (cellule, saisie ticket avec autocomplete, marquage pause) plutôt que le
  composant `Timeline` entier — celui-ci est fortement couplé à une date
  unique (sessionStorage par jour, undo/redo, indicateur "maintenant") et ne
  se généralise pas tel quel à une grille multi-colonnes non datée. Le
  détail du découpage (quels sous-composants sont extraits vs. dupliqués)
  se précise dans le plan d'implémentation.
- **Undo/redo et copier/coller ne sont pas repris dans cette vue en V1**
  (voir "Hors scope") — le nombre de blocs y est faible comparé à une
  journée réelle, ce qui rend ces fonctionnalités moins critiques ici.
- **Distinction visuelle forte avec le mode jour réel** :
  - Bandeau permanent en haut de la vue ("Semaine type — s'applique aux
    futurs jours vides").
  - Teinte de fond distincte sur toute la grille par rapport au fond neutre
    habituel de la timeline.
  - Entrée dédiée (icône propre) dans le header/sidebar pour y accéder.
- **Créer un bloc** : mêmes interactions que la timeline actuelle
  (clic-glisser, saisie de ticket avec autocomplete Jira, clic droit
  "marquer comme pause"). Par défaut, un bloc posé sur "Vendredi" crée une
  règle `intervalWeeks = 1` sur ce jour — aucune UI supplémentaire pour le
  cas courant.
- **Réglages de récurrence** : un menu sur chaque bloc permet d'ajuster —
  toutes les semaines (défaut) / une semaine sur N / date de fin optionnelle
  (la date de début n'est pas éditable : elle correspond toujours à la
  création de la règle, pour ne jamais affecter rétroactivement un jour déjà
  passé) / activer-désactiver / supprimer.
- **Objectif du jour** : champ éditable en haut de chaque colonne (même
  pattern que l'objectif journalier actuel sur un jour réel), vide =
  objectif par défaut (450 min). Remplir "6h30" sous Vendredi crée une
  règle `TARGET_OVERRIDE`.
- **Empilement / alternance** : déposer un 2ᵉ bloc sur une case déjà
  occupée déclenche un prompt : "Remplacer le bloc existant" / "Alterner" /
  "Annuler".
  - *Remplacer* : la règle existante est mise à jour, pas de conflit
    d'exécution possible.
  - *Alterner* : demande une date de départ (aujourd'hui par défaut, jamais
    dans le passé — cohérent avec `activeFrom`), calcule les ancrages
    décalés automatiquement (voir section précédente), affiche les blocs
    côte à côte dans la case avec un badge de position (ex. "1/2", "2/2")
    et une infobulle explicitant la cadence.
- Tous les libellés de cette vue (bandeau, prompt d'empilement, menus de
  récurrence) passent par `t()` / `assets/i18n/fr.ts` côté front et par
  `TranslatorInterface` / `translations/messages.fr.yaml` côté back, comme
  partout ailleurs dans l'app (aucune chaîne en dur).

## API

Nouveau contrôleur `TemplateRuleController` sous `/api/template-rules`,
suivant les conventions des contrôleurs existants (`#[Template(...)]` côté
Twig non applicable ici — API JSON pure comme `EntryController`) :

- `GET /api/template-rules` — liste toutes les règles (pour peupler la vue
  Modèles)
- `POST /api/template-rules` — créer une règle
- `PUT /api/template-rules/{id}` — mettre à jour une règle (récurrence,
  activation, contenu)
- `DELETE /api/template-rules/{id}` — supprimer une règle

Nouvel endpoint sur `DayController` :

- `POST /api/days/{date}/materialize` — matérialise le jour depuis les
  règles actives s'il n'existe pas encore en base (idempotent, voir
  "Application aux journées").

`WorkDayOutput` gagne un champ `persisted: bool`.

DTOs `Input`/`Output` suivant le pattern existant dans `src/Dto/`.

## Hors scope (V1)

- Rotation à plus de 2 éléments via l'UI (le modèle de données le supporte
  nativement, mais l'UI d'alternance V1 ne couvre explicitement que le cas à
  2 éléments — un "+" pour ajouter une 3ᵉ alternative pourra être ajouté
  sans changement de modèle si le besoin se confirme).
- **Récurrence mensuelle** (jour fixe du mois ou n-ième jour de semaine du
  mois) — aucun des cas d'usage à l'origine de la fonctionnalité n'en a
  besoin ; ajout additif possible plus tard (nouvelle colonne nullable) si
  le besoin se confirme.
- **Undo/redo et copier/coller dans la vue Modèles** — le volume de blocs y
  est faible, ces fonctionnalités n'apportent pas la même valeur que sur une
  journée réelle dense.
- Lien/traçabilité entre une `TimeEntry` matérialisée et sa règle d'origine.
- Prévisualisation multi-jours de l'effet d'un template avant matérialisation
  réelle (au-delà du calcul virtuel déjà fait pour l'affichage du jour
  consulté).

## Tests

- **Backend** :
  - Tests unitaires de `TemplateRuleMatcher` pour chaque type de récurrence
    (hebdomadaire simple, `intervalWeeks` avec parité, bornes
    `activeFrom`/`activeUntil` — y compris qu'un jour antérieur à
    `activeFrom` ne matche jamais).
  - Tests de la matérialisation : règles → `WorkDay`/`TimeEntry` corrects,
    application de `TARGET_OVERRIDE`, dédoublonnage sur chevauchement
    d'horaire (pas seulement un `startTime` identique).
  - Test fonctionnel : `GET /api/days/{date}` sur une date jamais vue
    retourne un jour peuplé (`persisted: false`) mais non enregistré en
    base.
  - Test fonctionnel : `POST /api/days/{date}/materialize` crée le
    `WorkDay`/les `TimeEntry` avec de vrais `id`, est idempotent si rappelé.
  - Test fonctionnel : `PATCH /api/days/{date}` et `EntryController::create`
    matérialisent le jour avant d'appliquer leur modification quand il
    n'existe pas encore.
  - Test fonctionnel : `JiraSyncController` sur un jour encore virtuel le
    matérialise puis synchronise correctement.
  - Test : suppression d'un membre d'un groupe d'alternance à 2 → le
    membre restant repasse en `intervalWeeks = 1`.
- **Frontend** :
  - Rendu de la vue Modèles (grille générique, bandeau, teinte distincte).
  - Création d'un bloc → appel API `POST /api/template-rules` avec la
    récurrence par défaut attendue.
  - Comportement du prompt d'empilement (remplacer / alterner / annuler) et
    calcul des ancrages générés.
