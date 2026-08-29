# Templates de journée — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de définir des règles récurrentes (`TemplateRule`) qui pré-remplissent automatiquement les journées vides (ticket de travail, pause, objectif journalier), avec matérialisation paresseuse (jamais de ligne créée par simple navigation) et sans jamais retoucher rétroactivement un jour passé.

**Architecture:** Nouvelle entité `TemplateRule` indépendante de `TimeEntry`/`WorkDay`, un service pur `TemplateRuleMatcher` qui détermine si une règle s'applique à une date, et un service `DayMaterializer` qui construit un `WorkDay` (en mémoire pour la lecture seule, ou persisté pour toute mutation réelle) à partir des règles actives. Quatre points d'entrée API existants sont branchés dessus (`GET`/`PATCH /api/days/{date}`, `POST /api/days/{date}/entries`, `POST /api/days/{date}/jira-sync`) plus un nouvel endpoint `POST /api/days/{date}/materialize` et un contrôleur CRUD `TemplateRuleController`.

**Tech Stack:** Symfony 8 / PHP 8.5, Doctrine ORM (SQLite en dev), `symfony/uid` pour les UUID, `symfony/validator` pour les DTOs d'entrée.

Ce plan couvre uniquement le **backend** — testable et utilisable en entier via `curl`, sans aucune UI. La vue frontend "Modèles" fait l'objet d'un plan séparé écrit une fois ce backend en place, pour s'appuyer sur la forme réelle de l'API livrée ici.

**Pas de tests automatisés dans ce plan** (décision explicite : le projet n'a aujourd'hui ni PHPUnit ni aucune infrastructure de test). Chaque tâche se termine par une vérification manuelle via `curl`/`bin/console`/requête SQL directe, avec la commande exacte et le résultat attendu.

## Global Constraints

- PHP ≥ 8.5, `declare(strict_types=1);` en tête de chaque fichier PHP.
- Classes natives importées via `use` — jamais de préfixe `\`.
- Getters/setters remplacés par les property hooks PHP 8.4 quand une normalisation est nécessaire (voir `TimeEntry::$ticketKey` comme référence).
- IDs d'entité en UUID (`symfony/uid`), génération via `UuidGenerator` (`CustomIdGenerator`).
- Cases d'enum en MAJUSCULES.
- Commentaires de classe et de fonction en docblock `/** */`, en français.
- Style Yoda pour les comparaisons d'égalité (`null === $var`).
- Tableaux associatifs PHP toujours sur plusieurs lignes.
- Pas de `name` dans `#[Route]` au niveau de la classe — uniquement sur les méthodes.
- Aucun message utilisateur en dur — toujours une clé de traduction (`TranslatorInterface`, `translations/messages.fr.yaml`).
- Toutes les commandes s'exécutent dans le conteneur : `docker compose exec php <commande>`. L'environnement de dev doit tourner (`docker compose up --wait`) avant de commencer.
- Le fichier SQLite de dev est `db/data_dev.db` (⚠️ ce chemin diffère de ce qu'indique CLAUDE.md — vérifié directement dans `compose.yaml`/`.env` : `DATABASE_URL=sqlite:///%kernel.project_dir%/db/data_%kernel.environment%.db`).

---

## Task 1: Entité `TemplateRule`, enum `TemplateRuleType`, repository et migration

**Files:**
- Create: `src/Enum/TemplateRuleType.php`
- Create: `src/Entity/TemplateRule.php`
- Create: `src/Repository/TemplateRuleRepository.php`
- Create: `migrations/VersionYYYYMMDDHHMMSS.php` (généré par `doctrine:migrations:diff`)

**Interfaces:**
- Consumes: rien (première tâche).
- Produces: entité `App\Entity\TemplateRule` avec propriétés publiques `id: ?Uuid`, `ruleType: TemplateRuleType`, `startTime: ?string`, `durationMinutes: ?int`, `ticketKey: ?string`, `ticketSummary: ?string`, `ticketType: ?string`, `comment: ?string`, `targetMinutes: ?int`, `weekday: int`, `intervalWeeks: int`, `anchorDate: DateTimeImmutable`, `activeFrom: DateTimeImmutable` (private(set)), `activeUntil: ?DateTimeImmutable`, `enabled: bool`, `rotationGroupId: ?Uuid`, `position: int`. Constructeur `__construct(TemplateRuleType $ruleType, int $weekday, DateTimeImmutable $anchorDate)`. Repository `App\Repository\TemplateRuleRepository` avec `findAllOrderedByPosition(): array`, `findAllEnabled(): array`, `getMaxPosition(): int`.

- [ ] **Step 1: Créer l'enum `TemplateRuleType`**

```php
<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Type d'une règle récurrente : bloc de travail, pause, ou objectif journalier.
 */
enum TemplateRuleType: string
{
    case WORK = 'work';
    case BREAK = 'break';
    case TARGET_OVERRIDE = 'target_override';
}
```

- [ ] **Step 2: Créer l'entité `TemplateRule`**

```php
<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\TemplateRuleType;
use App\Repository\TemplateRuleRepository;
use DateTimeImmutable;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\IdGenerator\UuidGenerator;
use Symfony\Component\Uid\Uuid;

/**
 * Représente une règle récurrente qui pré-remplit automatiquement les journées vides
 * (bloc de travail, pause, ou objectif journalier).
 */
#[ORM\Entity(repositoryClass: TemplateRuleRepository::class)]
#[ORM\Table(name: 'template_rule')]
class TemplateRule
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    #[ORM\GeneratedValue(strategy: 'CUSTOM')]
    #[ORM\CustomIdGenerator(class: UuidGenerator::class)]
    public private(set) ?Uuid $id = null;

    #[ORM\Column(type: 'string', length: 20, enumType: TemplateRuleType::class)]
    public TemplateRuleType $ruleType;

    // Heure de début HH:mm — requis pour WORK/BREAK, null pour TARGET_OVERRIDE
    #[ORM\Column(length: 5, nullable: true)]
    public ?string $startTime = null;

    // Durée en minutes — requis pour WORK/BREAK, null pour TARGET_OVERRIDE
    #[ORM\Column(nullable: true)]
    public ?int $durationMinutes = null;

    // Référence du ticket (ex : PROJ-123) — uniquement pour WORK
    #[ORM\Column(length: 50, nullable: true)]
    public ?string $ticketKey = null {
        // Normalise la clé en majuscules sans espaces superflus
        set(?string $value) => $this->ticketKey = $value !== null ? strtoupper(trim($value)) : null;
    }

    #[ORM\Column(length: 255, nullable: true)]
    public ?string $ticketSummary = null;

    #[ORM\Column(length: 50, nullable: true)]
    public ?string $ticketType = null;

    #[ORM\Column(length: 500, nullable: true)]
    public ?string $comment = null;

    // Objectif journalier en minutes — uniquement pour TARGET_OVERRIDE
    #[ORM\Column(nullable: true)]
    public ?int $targetMinutes = null;

    // Jour de semaine ciblé — ISO-8601 (1 = lundi ... 7 = dimanche)
    #[ORM\Column]
    public int $weekday;

    // 1 = toutes les semaines (défaut), 2 = une semaine sur deux, etc.
    #[ORM\Column]
    public int $intervalWeeks = 1;

    // Date de référence (tombant sur $weekday) pour calculer la parité de semaine avec intervalWeeks
    #[ORM\Column(type: Types::DATE_IMMUTABLE)]
    public DateTimeImmutable $anchorDate;

    // Toujours égale à la date de création — jamais modifiée après coup, garantit qu'une
    // règle ne peut jamais matérialiser rétroactivement un jour antérieur à sa création
    #[ORM\Column(type: Types::DATE_IMMUTABLE)]
    public private(set) DateTimeImmutable $activeFrom;

    #[ORM\Column(type: Types::DATE_IMMUTABLE, nullable: true)]
    public ?DateTimeImmutable $activeUntil = null;

    #[ORM\Column]
    public bool $enabled = true;

    // Tag purement UI pour regrouper les règles d'une alternance — n'intervient pas
    // dans le calcul de récurrence (voir TemplateRuleMatcher)
    #[ORM\Column(type: 'uuid', nullable: true)]
    public ?Uuid $rotationGroupId = null;

    // Précédence si deux règles résolvent sur le même horaire un jour donné (la plus grande gagne)
    #[ORM\Column]
    public int $position = 0;

    public function __construct(TemplateRuleType $ruleType, int $weekday, DateTimeImmutable $anchorDate)
    {
        $this->ruleType = $ruleType;
        $this->weekday = $weekday;
        $this->anchorDate = $anchorDate;
        $this->activeFrom = new DateTimeImmutable('today');
    }
}
```

- [ ] **Step 3: Créer le repository `TemplateRuleRepository`**

```php
<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\TemplateRule;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<TemplateRule>
 */
class TemplateRuleRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, TemplateRule::class);
    }

    /**
     * Retourne toutes les règles (actives et désactivées) triées par position ascendante.
     *
     * @return TemplateRule[]
     */
    public function findAllOrderedByPosition(): array
    {
        return $this->findBy([], ['position' => 'ASC']);
    }

    /**
     * Retourne uniquement les règles activées — utilisé par la matérialisation.
     *
     * @return TemplateRule[]
     */
    public function findAllEnabled(): array
    {
        return $this->findBy(['enabled' => true]);
    }

    /**
     * Retourne la position maximale parmi toutes les règles.
     * Retourne -1 si la table est vide.
     */
    public function getMaxPosition(): int
    {
        $result = $this->createQueryBuilder('r')
            ->select('MAX(r.position)')
            ->getQuery()
            ->getSingleScalarResult();

        return null !== $result ? (int) $result : -1;
    }
}
```

- [ ] **Step 4: Générer et jouer la migration**

Run:
```bash
docker compose exec php bin/console doctrine:migrations:diff --no-interaction
docker compose exec php bin/console doctrine:migrations:migrate --no-interaction
```

Expected: la commande `diff` crée un fichier `migrations/VersionYYYYMMDDHHMMSS.php` contenant un `CREATE TABLE template_rule (...)` dans `up()` et un `DROP TABLE template_rule` dans `down()`. La commande `migrate` l'applique sans erreur ("Migrating up to VersionYYYYMMDDHHMMSS ... [OK]").

- [ ] **Step 5: Vérifier le schéma et une insertion manuelle**

Run:
```bash
docker compose exec php bin/console dbal:run-sql "SELECT sql FROM sqlite_master WHERE type='table' AND name='template_rule'"
```

Expected: une ligne montrant les colonnes `id`, `rule_type`, `start_time`, `duration_minutes`, `ticket_key`, `ticket_summary`, `ticket_type`, `comment`, `target_minutes`, `weekday`, `interval_weeks`, `anchor_date`, `active_from`, `active_until`, `enabled`, `rotation_group_id`, `position`.

Run (vérifie que Doctrine peut lire la table sans erreur de mapping) :
```bash
docker compose exec php bin/console dbal:run-sql "SELECT COUNT(*) FROM template_rule"
```

Expected: `array(1) { [0]=> array(1) { ["COUNT(*)"]=> int(0) } }` (table vide, pas d'erreur).

- [ ] **Step 6: Commit**

```bash
git add src/Enum/TemplateRuleType.php src/Entity/TemplateRule.php src/Repository/TemplateRuleRepository.php migrations/
git commit -m "feat: ajouter l'entité TemplateRule et sa migration"
```

---

## Task 2: Service `TemplateRuleMatcher`

**Files:**
- Create: `src/Service/TemplateRuleMatcher.php`

**Interfaces:**
- Consumes: `App\Entity\TemplateRule` (Task 1).
- Produces: `App\Service\TemplateRuleMatcher` avec `public function matches(TemplateRule $rule, DateTimeImmutable $date): bool` et `public function overlaps(TemplateRule $a, TemplateRule $b): bool`. Aucune dépendance injectée (service pur, sans constructeur) — réutilisé tel quel par `DayMaterializer` (Task 4) et `TemplateRuleController` (Task 3).

- [ ] **Step 1: Écrire le service**

```php
<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\TemplateRule;
use DateTimeImmutable;

/**
 * Détermine si une règle récurrente s'applique à une date donnée, et si deux règles
 * WORK/BREAK peuvent réellement tomber le même jour (même jour de semaine, même
 * cadence, même phase) avec des horaires qui se recoupent.
 */
final class TemplateRuleMatcher
{
    private const string EPOCH = '1970-01-01';

    public function matches(TemplateRule $rule, DateTimeImmutable $date): bool
    {
        if (!$rule->enabled) {
            return false;
        }

        $day = $date->setTime(0, 0);

        if ($day < $rule->activeFrom) {
            return false;
        }

        if (null !== $rule->activeUntil && $day > $rule->activeUntil) {
            return false;
        }

        if ((int) $day->format('N') !== $rule->weekday) {
            return false;
        }

        return $this->weekIndex($day) % $rule->intervalWeeks === $this->weekPhase($rule);
    }

    /**
     * Indique si deux règles WORK/BREAK partagent le même jour de semaine, la même
     * cadence et la même phase (elles peuvent donc réellement tomber le même jour),
     * et si leurs plages horaires se recoupent dans ce cas.
     */
    public function overlaps(TemplateRule $a, TemplateRule $b): bool
    {
        if ($a->weekday !== $b->weekday || $a->intervalWeeks !== $b->intervalWeeks) {
            return false;
        }

        if ($this->weekPhase($a) !== $this->weekPhase($b)) {
            return false;
        }

        $startA = $this->toMinutes((string) $a->startTime);
        $endA = $startA + (int) $a->durationMinutes;
        $startB = $this->toMinutes((string) $b->startTime);
        $endB = $startB + (int) $b->durationMinutes;

        return $startA < $endB && $startB < $endA;
    }

    private function weekPhase(TemplateRule $rule): int
    {
        return $this->weekIndex($rule->anchorDate) % $rule->intervalWeeks;
    }

    private function weekIndex(DateTimeImmutable $date): int
    {
        $epoch = new DateTimeImmutable(self::EPOCH);

        return intdiv((int) $epoch->diff($date)->days, 7);
    }

    private function toMinutes(string $time): int
    {
        [$hours, $minutes] = explode(':', $time);

        return ((int) $hours * 60) + (int) $minutes;
    }
}
```

- [ ] **Step 2: Vérifier manuellement le comportement (script jetable, aucune dépendance au kernel Symfony)**

Run:
```bash
docker compose exec php php -r '
require "/app/vendor/autoload.php";

use App\Entity\TemplateRule;
use App\Enum\TemplateRuleType;
use App\Service\TemplateRuleMatcher;

$matcher = new TemplateRuleMatcher();

// 2026-08-19 est un mercredi
$anchor = new DateTimeImmutable("2026-08-19");
$rule = new TemplateRule(TemplateRuleType::WORK, 3, $anchor);
$rule->startTime = "09:15";
$rule->durationMinutes = 15;

echo "toutes les semaines, meme mercredi: ";
var_dump($matcher->matches($rule, new DateTimeImmutable("2026-08-19"))); // true
echo "toutes les semaines, mercredi suivant: ";
var_dump($matcher->matches($rule, new DateTimeImmutable("2026-08-26"))); // true
echo "toutes les semaines, jeudi: ";
var_dump($matcher->matches($rule, new DateTimeImmutable("2026-08-20"))); // false

$rule->intervalWeeks = 2;
echo "une semaine sur deux, semaine ancrage: ";
var_dump($matcher->matches($rule, new DateTimeImmutable("2026-08-19"))); // true
echo "une semaine sur deux, semaine suivante: ";
var_dump($matcher->matches($rule, new DateTimeImmutable("2026-08-26"))); // false
echo "une semaine sur deux, 2 semaines apres: ";
var_dump($matcher->matches($rule, new DateTimeImmutable("2026-09-02"))); // true

$rule->activeUntil = new DateTimeImmutable("2026-08-20");
echo "hors bornes (activeUntil depasse): ";
var_dump($matcher->matches($rule, new DateTimeImmutable("2026-09-02"))); // false

// Alternance : deuxieme regle ancree une semaine apres, meme creneau
$rule->activeUntil = null;
$other = new TemplateRule(TemplateRuleType::WORK, 3, new DateTimeImmutable("2026-08-26"));
$other->startTime = "09:15";
$other->durationMinutes = 15;
$other->intervalWeeks = 2;

echo "alternance (phases differentes) ne se chevauchent jamais: ";
var_dump($matcher->overlaps($rule, $other)); // false

$sameWeek = new TemplateRule(TemplateRuleType::WORK, 3, new DateTimeImmutable("2026-08-19"));
$sameWeek->startTime = "09:00";
$sameWeek->durationMinutes = 30;
$sameWeek->intervalWeeks = 2;

echo "meme phase, horaires qui se recoupent: ";
var_dump($matcher->overlaps($rule, $sameWeek)); // true
'
```

Expected (dans l'ordre) : `true`, `true`, `false`, `true`, `false`, `true`, `false`, `false`, `true`.

- [ ] **Step 3: Commit**

```bash
git add src/Service/TemplateRuleMatcher.php
git commit -m "feat: ajouter le moteur de récurrence TemplateRuleMatcher"
```

---

## Task 3: DTOs et `TemplateRuleController` (CRUD)

**Files:**
- Create: `src/Dto/Input/CreateTemplateRuleInput.php`
- Create: `src/Dto/Input/UpdateTemplateRuleInput.php`
- Create: `src/Dto/Output/TemplateRuleOutput.php`
- Create: `src/Controller/Api/TemplateRuleController.php`
- Modify: `translations/messages.fr.yaml`

**Interfaces:**
- Consumes: `App\Entity\TemplateRule`, `App\Enum\TemplateRuleType` (Task 1) ; `App\Service\TemplateRuleMatcher::overlaps()` (Task 2) ; `App\Repository\TemplateRuleRepository` (Task 1).
- Produces: endpoints `GET/POST /api/template-rules`, `PUT/DELETE /api/template-rules/{id}`. `TemplateRuleOutput::fromEntity(TemplateRule $rule): self`. Ces endpoints sont utilisés dans les tâches suivantes pour créer les règles servant à vérifier `DayMaterializer`.

- [ ] **Step 1: Ajouter les clés de traduction**

Dans `translations/messages.fr.yaml`, sous la clé `error:` existante, ajouter :

```yaml
    template_rule_not_found: "Règle introuvable"
    template_rule_overlap: "Cette règle chevauche une règle déjà active sur ce créneau"
    template_rule_anchor_weekday_mismatch: "La date d'ancrage ne correspond pas au jour de semaine sélectionné"
    template_rule_anchor_in_past: "La date d'ancrage ne peut pas être dans le passé"
```

Le fichier complet doit ressembler à :

```yaml
error:
    invalid_date_format: "Format de date invalide, attendu : YYYY-MM-DD"
    future_day_forbidden: "Impossible de créer une journée au-delà du lendemain"
    day_not_found: "Journée introuvable"
    entry_not_found: "Entrée introuvable"
    entry_time_conflict: "Une saisie existe déjà à cet horaire"
    jira_not_configured: "JIRA n'est pas configuré"
    jira_ticket_not_found: "Ticket introuvable ou inaccessible"
    favorite_not_found: "Favori introuvable"
    favorite_already_exists: "Ce ticket est déjà dans vos favoris"
    template_rule_not_found: "Règle introuvable"
    template_rule_overlap: "Cette règle chevauche une règle déjà active sur ce créneau"
    template_rule_anchor_weekday_mismatch: "La date d'ancrage ne correspond pas au jour de semaine sélectionné"
    template_rule_anchor_in_past: "La date d'ancrage ne peut pas être dans le passé"
```

- [ ] **Step 2: Créer `CreateTemplateRuleInput`**

```php
<?php

declare(strict_types=1);

namespace App\Dto\Input;

use App\Enum\TemplateRuleType;
use Symfony\Component\Validator\Constraints as Assert;

readonly class CreateTemplateRuleInput
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Choice(choices: [
            TemplateRuleType::WORK->value,
            TemplateRuleType::BREAK->value,
            TemplateRuleType::TARGET_OVERRIDE->value,
        ])]
        public string $ruleType,

        #[Assert\NotBlank]
        #[Assert\Range(min: 1, max: 7)]
        public int $weekday,

        #[Assert\When(
            expression: 'this.ruleType !== "target_override"',
            constraints: [new Assert\NotBlank()],
        )]
        #[Assert\DateTime(format: 'H:i')]
        public ?string $startTime = null,

        #[Assert\When(
            expression: 'this.ruleType !== "target_override"',
            constraints: [new Assert\NotBlank(), new Assert\Positive()],
        )]
        #[Assert\Range(min: 1, max: 1440)]
        public ?int $durationMinutes = null,

        #[Assert\When(
            expression: 'this.ruleType === "work"',
            constraints: [new Assert\NotBlank()],
        )]
        #[Assert\Regex(pattern: '/^[A-Za-z0-9-]+$/', message: 'error.ticket_key_invalid')]
        public ?string $ticketKey = null,

        #[Assert\Length(max: 255)]
        public ?string $ticketSummary = null,

        #[Assert\Length(max: 50)]
        public ?string $ticketType = null,

        #[Assert\Length(max: 500)]
        public ?string $comment = null,

        #[Assert\When(
            expression: 'this.ruleType === "target_override"',
            constraints: [new Assert\NotBlank(), new Assert\Positive()],
        )]
        public ?int $targetMinutes = null,

        #[Assert\Positive]
        public int $intervalWeeks = 1,

        #[Assert\Date]
        public ?string $anchorDate = null,

        #[Assert\Date]
        public ?string $activeUntil = null,

        public bool $enabled = true,

        #[Assert\Uuid]
        public ?string $rotationGroupId = null,
    ) {}
}
```

- [ ] **Step 3: Créer `UpdateTemplateRuleInput`**

```php
<?php

declare(strict_types=1);

namespace App\Dto\Input;

use Symfony\Component\Validator\Constraints as Assert;

readonly class UpdateTemplateRuleInput
{
    public function __construct(
        #[Assert\DateTime(format: 'H:i')]
        public ?string $startTime = null,

        #[Assert\Range(min: 1, max: 1440)]
        public ?int $durationMinutes = null,

        #[Assert\Regex(pattern: '/^[A-Za-z0-9-]+$/', message: 'error.ticket_key_invalid')]
        public ?string $ticketKey = null,

        #[Assert\Length(max: 255)]
        public ?string $ticketSummary = null,

        #[Assert\Length(max: 50)]
        public ?string $ticketType = null,

        #[Assert\Length(max: 500)]
        public ?string $comment = null,

        #[Assert\Positive]
        public ?int $targetMinutes = null,

        #[Assert\Range(min: 1, max: 7)]
        public ?int $weekday = null,

        #[Assert\Positive]
        public ?int $intervalWeeks = null,

        #[Assert\Date]
        public ?string $anchorDate = null,

        #[Assert\Date]
        public ?string $activeUntil = null,

        public ?bool $enabled = null,
    ) {}
}
```

- [ ] **Step 4: Créer `TemplateRuleOutput`**

```php
<?php

declare(strict_types=1);

namespace App\Dto\Output;

use App\Entity\TemplateRule;

readonly class TemplateRuleOutput
{
    public function __construct(
        public string $id,
        public string $ruleType,
        public int $weekday,
        public ?string $startTime,
        public ?int $durationMinutes,
        public ?string $ticketKey,
        public ?string $ticketSummary,
        public ?string $ticketType,
        public ?string $comment,
        public ?int $targetMinutes,
        public int $intervalWeeks,
        public string $anchorDate,
        public string $activeFrom,
        public ?string $activeUntil,
        public bool $enabled,
        public ?string $rotationGroupId,
        public int $position,
    ) {}

    public static function fromEntity(TemplateRule $rule): self
    {
        return new self(
            id: (string) $rule->id,
            ruleType: $rule->ruleType->value,
            weekday: $rule->weekday,
            startTime: $rule->startTime,
            durationMinutes: $rule->durationMinutes,
            ticketKey: $rule->ticketKey,
            ticketSummary: $rule->ticketSummary,
            ticketType: $rule->ticketType,
            comment: $rule->comment,
            targetMinutes: $rule->targetMinutes,
            intervalWeeks: $rule->intervalWeeks,
            anchorDate: $rule->anchorDate->format('Y-m-d'),
            activeFrom: $rule->activeFrom->format('Y-m-d'),
            activeUntil: $rule->activeUntil?->format('Y-m-d'),
            enabled: $rule->enabled,
            rotationGroupId: null !== $rule->rotationGroupId ? (string) $rule->rotationGroupId : null,
            position: $rule->position,
        );
    }
}
```

- [ ] **Step 5: Créer `TemplateRuleController`**

```php
<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Dto\Input\CreateTemplateRuleInput;
use App\Dto\Input\UpdateTemplateRuleInput;
use App\Dto\Output\TemplateRuleOutput;
use App\Entity\TemplateRule;
use App\Enum\TemplateRuleType;
use App\Repository\TemplateRuleRepository;
use App\Service\TemplateRuleMatcher;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Gère les règles récurrentes qui pré-remplissent automatiquement les journées vides.
 */
#[Route('/api/template-rules')]
class TemplateRuleController extends AbstractController
{
    public function __construct(
        private readonly TemplateRuleRepository $ruleRepository,
        private readonly TemplateRuleMatcher $matcher,
        private readonly EntityManagerInterface $em,
        private readonly TranslatorInterface $translator,
    ) {}

    /**
     * Retourne toutes les règles (activées et désactivées), triées par position.
     */
    #[Route('', name: 'api_template_rules_list', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return $this->json(array_map(
            static fn (TemplateRule $r) => TemplateRuleOutput::fromEntity($r),
            $this->ruleRepository->findAllOrderedByPosition(),
        ));
    }

    /**
     * Crée une nouvelle règle récurrente.
     */
    #[Route('', name: 'api_template_rules_create', methods: ['POST'])]
    public function create(#[MapRequestPayload] CreateTemplateRuleInput $input): JsonResponse
    {
        $ruleType = TemplateRuleType::from($input->ruleType);
        $today = new DateTimeImmutable('today');

        $anchorDate = null !== $input->anchorDate
            ? DateTimeImmutable::createFromFormat('Y-m-d', $input->anchorDate)->setTime(0, 0)
            : $this->nextOccurrence($input->weekday, $today);

        if ((int) $anchorDate->format('N') !== $input->weekday) {
            return $this->json(
                ['error' => $this->translator->trans('error.template_rule_anchor_weekday_mismatch')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        if ($anchorDate < $today) {
            return $this->json(
                ['error' => $this->translator->trans('error.template_rule_anchor_in_past')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $rule = new TemplateRule($ruleType, $input->weekday, $anchorDate);
        $rule->intervalWeeks = $input->intervalWeeks;
        $rule->enabled = $input->enabled;
        $rule->position = $this->ruleRepository->getMaxPosition() + 1;

        if (null !== $input->activeUntil) {
            $rule->activeUntil = DateTimeImmutable::createFromFormat('Y-m-d', $input->activeUntil)->setTime(0, 0);
        }

        if (null !== $input->rotationGroupId) {
            $rule->rotationGroupId = Uuid::fromString($input->rotationGroupId);
        }

        if (TemplateRuleType::TARGET_OVERRIDE === $ruleType) {
            $rule->targetMinutes = $input->targetMinutes;
        } else {
            $rule->startTime = $input->startTime;
            $rule->durationMinutes = $input->durationMinutes;

            if (TemplateRuleType::WORK === $ruleType) {
                $rule->ticketKey = $input->ticketKey;
                $rule->ticketSummary = $input->ticketSummary;
                $rule->ticketType = $input->ticketType;
                $rule->comment = $input->comment;
            }

            if ($rule->enabled && $this->hasOverlap($rule)) {
                return $this->json(
                    ['error' => $this->translator->trans('error.template_rule_overlap')],
                    Response::HTTP_CONFLICT,
                );
            }
        }

        $this->em->persist($rule);
        $this->em->flush();

        return $this->json(TemplateRuleOutput::fromEntity($rule), Response::HTTP_CREATED);
    }

    /**
     * Met à jour une règle existante (patch partiel).
     */
    #[Route('/{id}', name: 'api_template_rules_update', methods: ['PUT'])]
    public function update(string $id, #[MapRequestPayload] UpdateTemplateRuleInput $input): JsonResponse
    {
        $rule = $this->ruleRepository->find(Uuid::fromString($id));

        if (null === $rule) {
            return $this->json(
                ['error' => $this->translator->trans('error.template_rule_not_found')],
                Response::HTTP_NOT_FOUND,
            );
        }

        if (null !== $input->weekday) {
            $rule->weekday = $input->weekday;
        }

        if (null !== $input->intervalWeeks) {
            $rule->intervalWeeks = $input->intervalWeeks;
        }

        if (null !== $input->anchorDate) {
            $rule->anchorDate = DateTimeImmutable::createFromFormat('Y-m-d', $input->anchorDate)->setTime(0, 0);
        }

        if (null !== $input->activeUntil) {
            $rule->activeUntil = DateTimeImmutable::createFromFormat('Y-m-d', $input->activeUntil)->setTime(0, 0);
        }

        if (null !== $input->enabled) {
            $rule->enabled = $input->enabled;
        }

        // Si le jour de semaine ou l'ancrage a changé, revalider les mêmes invariants qu'à
        // la création (l'ancrage doit tomber sur le jour de semaine, jamais dans le passé) —
        // sinon TemplateRuleMatcher calculerait une phase de récurrence incorrecte.
        if (null !== $input->weekday || null !== $input->anchorDate) {
            if ((int) $rule->anchorDate->format('N') !== $rule->weekday) {
                return $this->json(
                    ['error' => $this->translator->trans('error.template_rule_anchor_weekday_mismatch')],
                    Response::HTTP_UNPROCESSABLE_ENTITY,
                );
            }

            if ($rule->anchorDate < new DateTimeImmutable('today')) {
                return $this->json(
                    ['error' => $this->translator->trans('error.template_rule_anchor_in_past')],
                    Response::HTTP_UNPROCESSABLE_ENTITY,
                );
            }
        }

        if (TemplateRuleType::TARGET_OVERRIDE === $rule->ruleType) {
            if (null !== $input->targetMinutes) {
                $rule->targetMinutes = $input->targetMinutes;
            }
        } else {
            if (null !== $input->startTime) {
                $rule->startTime = $input->startTime;
            }
            if (null !== $input->durationMinutes) {
                $rule->durationMinutes = $input->durationMinutes;
            }
            if (TemplateRuleType::WORK === $rule->ruleType) {
                if (null !== $input->ticketKey) {
                    $rule->ticketKey = $input->ticketKey;
                }
                if (null !== $input->ticketSummary) {
                    $rule->ticketSummary = $input->ticketSummary;
                }
                if (null !== $input->ticketType) {
                    $rule->ticketType = $input->ticketType;
                }
                if (null !== $input->comment) {
                    $rule->comment = $input->comment;
                }
            }
        }

        $this->em->flush();

        return $this->json(TemplateRuleOutput::fromEntity($rule));
    }

    /**
     * Supprime une règle. Si elle appartenait à un groupe d'alternance qui ne
     * contient alors plus qu'un seul membre, celui-ci redevient une règle
     * hebdomadaire simple (sinon il resterait actif une semaine sur deux avec
     * un créneau vide silencieux l'autre semaine).
     */
    #[Route('/{id}', name: 'api_template_rules_delete', methods: ['DELETE'])]
    public function delete(string $id): JsonResponse
    {
        $rule = $this->ruleRepository->find(Uuid::fromString($id));

        if (null === $rule) {
            return $this->json(
                ['error' => $this->translator->trans('error.template_rule_not_found')],
                Response::HTTP_NOT_FOUND,
            );
        }

        $rotationGroupId = $rule->rotationGroupId;

        $this->em->remove($rule);
        $this->em->flush();

        if (null !== $rotationGroupId) {
            $this->collapseRotationGroupIfSingleMember($rotationGroupId);
        }

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * Retourne la première occurrence du jour de semaine donné à partir de $from (incluse).
     */
    private function nextOccurrence(int $weekday, DateTimeImmutable $from): DateTimeImmutable
    {
        $from = $from->setTime(0, 0);
        $diff = ($weekday - (int) $from->format('N') + 7) % 7;

        return $from->modify("+{$diff} days");
    }

    /**
     * Vérifie que la règle candidate ne chevauche aucune règle WORK/BREAK activée existante.
     */
    private function hasOverlap(TemplateRule $candidate): bool
    {
        foreach ($this->ruleRepository->findAllEnabled() as $existing) {
            if (TemplateRuleType::TARGET_OVERRIDE !== $existing->ruleType
                && $existing !== $candidate
                && $this->matcher->overlaps($candidate, $existing)
            ) {
                return true;
            }
        }

        return false;
    }

    private function collapseRotationGroupIfSingleMember(Uuid $rotationGroupId): void
    {
        $remaining = $this->ruleRepository->findBy(['rotationGroupId' => $rotationGroupId]);

        if (1 !== count($remaining)) {
            return;
        }

        $last = $remaining[0];
        $last->intervalWeeks = 1;
        $last->rotationGroupId = null;
        $this->em->flush();
    }
}
```

- [ ] **Step 6: Vérifier manuellement via curl**

Prérequis : environnement de dev démarré (`docker compose up --wait`), accessible sur `https://daytrack.localhost`.

Créer une règle WORK sur le mercredi (jour 3), sans préciser d'ancrage (calculé automatiquement) :
```bash
curl -sk -X POST https://daytrack.localhost/api/template-rules \
  -H 'Content-Type: application/json' \
  -d '{"ruleType":"work","weekday":3,"startTime":"09:15","durationMinutes":15,"ticketKey":"DAILY"}'
```
Expected: `201`, JSON avec `"ruleType":"work"`, `"weekday":3`, `"ticketKey":"DAILY"`, `"anchorDate"` sur un mercredi, `"activeFrom"` égal à aujourd'hui. Noter l'`id` retourné (`RULE_ID`).

Recréer la même règle (même jour, même horaire) doit être refusé :
```bash
curl -sk -X POST https://daytrack.localhost/api/template-rules \
  -H 'Content-Type: application/json' \
  -d '{"ruleType":"work","weekday":3,"startTime":"09:00","durationMinutes":30,"ticketKey":"AUTRE"}'
```
Expected: `409`, `{"error":"Cette règle chevauche une règle déjà active sur ce créneau"}`.

Lister :
```bash
curl -sk https://daytrack.localhost/api/template-rules
```
Expected: tableau contenant uniquement la première règle créée.

Mettre à jour (désactiver) :
```bash
curl -sk -X PUT https://daytrack.localhost/api/template-rules/RULE_ID \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```
Expected: `200`, `"enabled":false`.

Changer le jour de semaine sans changer l'ancrage (doit être refusé, l'ancrage ne tombe plus sur le nouveau jour) :
```bash
curl -sk -X PUT https://daytrack.localhost/api/template-rules/RULE_ID \
  -H 'Content-Type: application/json' \
  -d '{"weekday":4}'
```
Expected: `422`, `{"error":"La date d'ancrage ne correspond pas au jour de semaine sélectionné"}`.

Supprimer :
```bash
curl -sk -X DELETE https://daytrack.localhost/api/template-rules/RULE_ID
```
Expected: `204`, puis un `GET /api/template-rules` renvoie `[]`.

- [ ] **Step 7: Commit**

```bash
git add src/Dto/Input/CreateTemplateRuleInput.php src/Dto/Input/UpdateTemplateRuleInput.php \
        src/Dto/Output/TemplateRuleOutput.php src/Controller/Api/TemplateRuleController.php \
        translations/messages.fr.yaml
git commit -m "feat: ajouter le CRUD des règles récurrentes (TemplateRuleController)"
```

---

## Task 4: Service `DayMaterializer` et branchement dans `DayController`

**Files:**
- Create: `src/Service/DayMaterializer.php`
- Modify: `src/Dto/Output/WorkDayOutput.php`
- Modify: `src/Controller/Api/DayController.php`

**Interfaces:**
- Consumes: `App\Repository\WorkDayRepository::findByDate()` (existant) ; `App\Repository\TemplateRuleRepository::findAllEnabled()` (Task 1) ; `App\Service\TemplateRuleMatcher::matches()`/`overlaps()` (Task 2).
- Produces: `App\Service\DayMaterializer` avec `public function preview(DateTimeImmutable $date): WorkDay` (jamais persisté si le jour n'existait pas) et `public function materialize(DateTimeImmutable $date): WorkDay` (persisté). Utilisé par les tâches suivantes (`EntryController`, `PATCH` de `DayController`, `JiraSyncController`). `WorkDayOutput` gagne un champ `persisted: bool`.

- [ ] **Step 1: Ajouter `persisted` à `WorkDayOutput`**

```php
<?php

declare(strict_types=1);

namespace App\Dto\Output;

use App\Entity\TimeEntry;
use App\Entity\WorkDay;

readonly class WorkDayOutput
{
    /**
     * @param TimeEntryOutput[] $entries
     */
    public function __construct(
        public string $id,
        public string $date,
        public int $targetMinutes,
        public int $workedMinutes,
        public int $balanceMinutes,
        public array $entries,
        public ?string $jiraSyncedAt,
        public bool $persisted,
    ) {}

    public static function fromEntity(WorkDay $workDay): self
    {
        return new self(
            id: (string) $workDay->id,
            date: $workDay->date->format('Y-m-d'),
            targetMinutes: $workDay->targetMinutes,
            workedMinutes: $workDay->getWorkedMinutes(),
            balanceMinutes: $workDay->getBalanceMinutes(),
            entries: array_values(
                $workDay->entries
                    ->map(fn (TimeEntry $e) => TimeEntryOutput::fromEntity($e))
                    ->toArray()
            ),
            jiraSyncedAt: $workDay->jiraSyncedAt?->format(\DateTimeInterface::ATOM),
            persisted: null !== $workDay->id,
        );
    }
}
```

- [ ] **Step 2: Créer `DayMaterializer`**

```php
<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\TemplateRule;
use App\Entity\TimeEntry;
use App\Entity\WorkDay;
use App\Enum\EntryType;
use App\Enum\TemplateRuleType;
use App\Repository\TemplateRuleRepository;
use App\Repository\WorkDayRepository;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Résout une journée à partir des règles récurrentes actives : soit en mémoire
 * sans effet de bord (preview, pour la simple consultation), soit persistée
 * (materialize, dès qu'une mutation réelle a lieu sur cette journée).
 */
final class DayMaterializer
{
    public function __construct(
        private readonly WorkDayRepository $workDayRepository,
        private readonly TemplateRuleRepository $templateRuleRepository,
        private readonly TemplateRuleMatcher $matcher,
        private readonly EntityManagerInterface $em,
    ) {}

    /**
     * Retourne le jour existant, ou un WorkDay calculé à partir des règles actives
     * mais jamais persisté.
     */
    public function preview(DateTimeImmutable $date): WorkDay
    {
        return $this->workDayRepository->findByDate($date) ?? $this->buildFromRules($date, persist: false);
    }

    /**
     * Retourne le jour existant, ou le matérialise (persiste) à partir des règles actives.
     * Idempotent : si le jour existe déjà, ne le recalcule jamais.
     */
    public function materialize(DateTimeImmutable $date): WorkDay
    {
        return $this->workDayRepository->findByDate($date) ?? $this->buildFromRules($date, persist: true);
    }

    private function buildFromRules(DateTimeImmutable $date, bool $persist): WorkDay
    {
        $day = new WorkDay($date);

        $matching = array_values(array_filter(
            $this->templateRuleRepository->findAllEnabled(),
            fn (TemplateRule $rule) => $this->matcher->matches($rule, $date),
        ));

        $targetRule = $this->highestPosition(array_filter(
            $matching,
            static fn (TemplateRule $r) => TemplateRuleType::TARGET_OVERRIDE === $r->ruleType,
        ));
        if (null !== $targetRule) {
            $day->targetMinutes = (int) $targetRule->targetMinutes;
        }

        $entryRules = array_filter(
            $matching,
            static fn (TemplateRule $r) => TemplateRuleType::TARGET_OVERRIDE !== $r->ruleType,
        );

        foreach ($this->deduplicateOverlaps($entryRules) as $rule) {
            $day->addEntry($this->buildEntry($day, $date, $rule));
        }

        if ($persist) {
            $this->em->persist($day);
            $this->em->flush();
        }

        return $day;
    }

    private function buildEntry(WorkDay $day, DateTimeImmutable $date, TemplateRule $rule): TimeEntry
    {
        $startedAt = DateTimeImmutable::createFromFormat('Y-m-d H:i', $date->format('Y-m-d').' '.$rule->startTime);
        $entry = new TimeEntry(
            workDay: $day,
            startedAt: $startedAt,
            type: TemplateRuleType::BREAK === $rule->ruleType ? EntryType::BREAK : EntryType::WORK,
        );
        $entry->endedAt = $startedAt->modify('+'.$rule->durationMinutes.' minutes');

        if (EntryType::WORK === $entry->type) {
            $entry->ticketKey = $rule->ticketKey;
            $entry->ticketSummary = $rule->ticketSummary;
            $entry->ticketType = $rule->ticketType;
            $entry->comment = $rule->comment;
        }

        return $entry;
    }

    /**
     * @param TemplateRule[] $rules
     * @return TemplateRule[] règles ne se chevauchant plus entre elles, la plus grande
     *                        position gagnant sur un chevauchement (cas limite, ne devrait
     *                        pas arriver via l'UI d'édition normale)
     */
    private function deduplicateOverlaps(array $rules): array
    {
        $sorted = $rules;
        usort($sorted, static fn (TemplateRule $a, TemplateRule $b) => $b->position <=> $a->position);

        $kept = [];
        foreach ($sorted as $rule) {
            $overlapsKept = false;
            foreach ($kept as $existing) {
                if ($this->matcher->overlaps($rule, $existing)) {
                    $overlapsKept = true;
                    break;
                }
            }
            if (!$overlapsKept) {
                $kept[] = $rule;
            }
        }

        return $kept;
    }

    /**
     * @param TemplateRule[] $rules
     */
    private function highestPosition(array $rules): ?TemplateRule
    {
        $best = null;
        foreach ($rules as $rule) {
            if (null === $best || $rule->position > $best->position) {
                $best = $rule;
            }
        }

        return $best;
    }
}
```

- [ ] **Step 3: Brancher `DayMaterializer` dans `DayController`**

Dans `src/Controller/Api/DayController.php` :

1. Ajouter l'import `use App\Service\DayMaterializer;`.
2. Ajouter `private readonly DayMaterializer $materializer,` au constructeur.
3. Dans `get()`, remplacer :
   ```php
   $day = $this->workDayRepository->findByDate($parsedDate) ?? new WorkDay($parsedDate);
   ```
   par :
   ```php
   $day = $this->materializer->preview($parsedDate);
   ```
4. Dans `patch()`, remplacer :
   ```php
   $day = $this->workDayRepository->findByDate($parsedDate);

   if (null === $day) {
       $day = new WorkDay($parsedDate);
       $this->em->persist($day);
   }
   ```
   par :
   ```php
   $day = $this->workDayRepository->findByDate($parsedDate) ?? $this->materializer->materialize($parsedDate);
   ```
5. Ajouter une nouvelle méthode (mêmes vérifications de date que `get()`/`patch()`) :
   ```php
   /**
    * Matérialise la journée depuis les règles actives si elle n'existe pas encore en
    * base — idempotent. Utilisé par le front juste avant la première édition/suppression
    * d'un bloc pré-rempli par template, pour obtenir un id réel avant l'appel PUT/DELETE.
    */
   #[Route('/{date}/materialize', name: 'api_days_materialize', methods: ['POST'])]
   public function materialize(string $date): JsonResponse
   {
       $parsedDate = DateTimeImmutable::createFromFormat('Y-m-d', $date);

       if (false === $parsedDate) {
           return $this->json(
               ['error' => $this->translator->trans('error.invalid_date_format')],
               Response::HTTP_BAD_REQUEST,
           );
       }

       if ($parsedDate->format('Y-m-d') > (new DateTimeImmutable('+30 days'))->format('Y-m-d')) {
           return $this->json(
               ['error' => $this->translator->trans('error.future_day_forbidden')],
               Response::HTTP_UNPROCESSABLE_ENTITY,
           );
       }

       $day = $this->materializer->materialize($parsedDate);

       return $this->json(WorkDayOutput::fromEntity($day));
   }
   ```
6. Une fois les deux remplacements ci-dessus faits, plus aucun `new WorkDay(...)` ne subsiste dans `DayController` (c'était sa seule utilisation dans ce fichier — pas de méthode `resolveDay()` ici, contrairement à `EntryController`) : retirer l'import désormais inutilisé `use App\Entity\WorkDay;`.

- [ ] **Step 4: Vérifier manuellement via curl**

Recréer une règle WORK sur le jour de semaine correspondant à **dans 10 jours** (pour être sûr de tomber sur un jour jamais consulté) :
```bash
curl -sk -X POST https://daytrack.localhost/api/template-rules \
  -H 'Content-Type: application/json' \
  -d '{"ruleType":"work","weekday":<N>,"startTime":"09:15","durationMinutes":15,"ticketKey":"DAILY"}'
```
(remplacer `<N>` par le numéro ISO du jour de semaine, 1=lundi..7=dimanche, du jour choisi ci-dessous)

Consulter ce jour (remplacer `DATE` par la date au format `YYYY-MM-DD`) :
```bash
curl -sk https://daytrack.localhost/api/days/DATE
```
Expected: `"persisted":false`, `"entries"` contient une entrée `"ticketKey":"DAILY"`, `"startedAt":"09:15"`, `"endedAt":"09:30"`.

Vérifier qu'aucune ligne n'a été créée en base :
```bash
docker compose exec php bin/console dbal:run-sql "SELECT COUNT(*) FROM work_day WHERE date = 'DATE'"
```
Expected: `int(0)`.

Matérialiser :
```bash
curl -sk -X POST https://daytrack.localhost/api/days/DATE/materialize
```
Expected: `"persisted":true`, mêmes entrées que ci-dessus.

Revérifier en base :
```bash
docker compose exec php bin/console dbal:run-sql "SELECT COUNT(*) FROM work_day WHERE date = 'DATE'"
docker compose exec php bin/console dbal:run-sql "SELECT COUNT(*) FROM time_entry"
```
Expected: `int(1)` pour le jour, et au moins `int(1)` pour les entrées.

Rappeler `materialize` une deuxième fois (idempotence) :
```bash
curl -sk -X POST https://daytrack.localhost/api/days/DATE/materialize
docker compose exec php bin/console dbal:run-sql "SELECT COUNT(*) FROM work_day WHERE date = 'DATE'"
```
Expected: toujours `int(1)` (pas de doublon).

- [ ] **Step 5: Commit**

```bash
git add src/Service/DayMaterializer.php src/Dto/Output/WorkDayOutput.php src/Controller/Api/DayController.php
git commit -m "feat: matérialiser les journées vides depuis les règles récurrentes (DayController)"
```

---

## Task 5: Branchement dans `EntryController::create`

**Files:**
- Modify: `src/Controller/Api/EntryController.php`

**Interfaces:**
- Consumes: `App\Service\DayMaterializer::materialize()` (Task 4).
- Produces: `EntryController::create()` matérialise désormais un jour vide depuis les règles au lieu de créer un `WorkDay` vide, avant d'ajouter l'entrée demandée par l'utilisateur.

- [ ] **Step 1: Modifier `EntryController`**

1. Ajouter l'import `use App\Service\DayMaterializer;`.
2. Ajouter `private readonly DayMaterializer $materializer,` au constructeur.
3. Dans la méthode privée `resolveDay()`, remplacer :
   ```php
   if (null === $day) {
       if ($createIfMissing) {
           $day = new WorkDay($parsedDate);
           $this->em->persist($day);
       } else {
           return $this->json(
               ['error' => $this->translator->trans('error.day_not_found')],
               Response::HTTP_NOT_FOUND,
           );
       }
   }
   ```
   par :
   ```php
   if (null === $day) {
       if ($createIfMissing) {
           $day = $this->materializer->materialize($parsedDate);
       } else {
           return $this->json(
               ['error' => $this->translator->trans('error.day_not_found')],
               Response::HTTP_NOT_FOUND,
           );
       }
   }
   ```
4. L'import `use App\Entity\WorkDay;` reste nécessaire (type de retour de `resolveDay()`).

- [ ] **Step 2: Vérifier manuellement via curl**

Créer une règle BREAK sur le jour de semaine correspondant à **dans 11 jours** (jour encore jamais touché) :
```bash
curl -sk -X POST https://daytrack.localhost/api/template-rules \
  -H 'Content-Type: application/json' \
  -d '{"ruleType":"break","weekday":<N>,"startTime":"12:00","durationMinutes":120}'
```

Créer directement une entrée sur ce jour sans passer par `materialize` au préalable (remplacer `DATE`) :
```bash
curl -sk -X POST https://daytrack.localhost/api/days/DATE/entries \
  -H 'Content-Type: application/json' \
  -d '{"startedAt":"14:00","endedAt":"14:15","type":"work","ticketKey":"ABC-1"}'
```
Expected: `201`, la réponse contient **deux** entrées : la pause `12:00`-`14:00` générée par la règle, et l'entrée `14:00`-`14:15` créée manuellement. `"persisted":true`.

Vérifier en base :
```bash
docker compose exec php bin/console dbal:run-sql "SELECT COUNT(*) FROM work_day WHERE date = 'DATE'"
```
Expected: `int(1)`.

- [ ] **Step 3: Commit**

```bash
git add src/Controller/Api/EntryController.php
git commit -m "feat: matérialiser le jour depuis les règles à la création d'une entrée"
```

---

## Task 6: Branchement dans `DayController::patch`

**Files:**
- Modify: `src/Controller/Api/DayController.php`

**Interfaces:**
- Consumes: `App\Service\DayMaterializer::materialize()` (déjà injecté dans `DayController` depuis Task 4).
- Produces: `PATCH /api/days/{date}` matérialise désormais un jour vide depuis les règles avant d'appliquer l'objectif demandé, au lieu de créer un `WorkDay` vide.

Ce changement a déjà été appliqué dans **Task 4, Step 3, point 4** (remplacement du bloc `new WorkDay($parsedDate)` par `$this->materializer->materialize($parsedDate)` dans `patch()`). Cette tâche ne fait que le vérifier isolément et le committer séparément — aucune nouvelle modification de code n'est nécessaire ici au-delà de ce qui a déjà été écrit.

- [ ] **Step 1: Vérifier manuellement via curl**

Créer une règle TARGET_OVERRIDE sur le jour de semaine correspondant à **dans 12 jours** (jour encore jamais touché) :
```bash
curl -sk -X POST https://daytrack.localhost/api/template-rules \
  -H 'Content-Type: application/json' \
  -d '{"ruleType":"target_override","weekday":<N>,"targetMinutes":390}'
```

Patcher l'objectif de ce jour à une autre valeur (remplacer `DATE`) :
```bash
curl -sk -X PATCH https://daytrack.localhost/api/days/DATE \
  -H 'Content-Type: application/json' \
  -d '{"targetMinutes":420}'
```
Expected: `200`, `"targetMinutes":420` (la valeur envoyée écrase bien celle de la règle — cohérent avec l'édition manuelle qui prime dès que le jour est touché), `"persisted":true`.

Vérifier en base :
```bash
docker compose exec php bin/console dbal:run-sql "SELECT target_minutes FROM work_day WHERE date = 'DATE'"
```
Expected: `420`.

- [ ] **Step 2: Commit**

```bash
git add -A
git status
```

Si `git status` ne montre aucun changement non commité (le code a déjà été committé en Task 4), ne rien committer ici — cette étape ne fait que confirmer que le comportement de `patch()` est correct.

---

## Task 7: Branchement dans `JiraSyncController::sync`

**Files:**
- Modify: `src/Controller/Api/JiraSyncController.php`

**Interfaces:**
- Consumes: `App\Service\DayMaterializer::materialize()` (Task 4).
- Produces: `POST /api/days/{date}/jira-sync` matérialise désormais un jour encore virtuel depuis les règles avant de synchroniser, au lieu de retourner `error.day_not_found`.

- [ ] **Step 1: Modifier `JiraSyncController`**

1. Remplacer l'import `use App\Repository\WorkDayRepository;` par `use App\Service\DayMaterializer;`.
2. Remplacer `private readonly WorkDayRepository $dayRepository,` par `private readonly DayMaterializer $materializer,` dans le constructeur.
3. Remplacer :
   ```php
   $day = $this->dayRepository->findByDate($parsedDate);

   if (null === $day) {
       return $this->json(
           ['error' => $this->translator->trans('error.day_not_found')],
           Response::HTTP_NOT_FOUND,
       );
   }
   ```
   par :
   ```php
   $day = $this->materializer->materialize($parsedDate);
   ```

- [ ] **Step 2: Vérifier la cohérence du câblage**

Run:
```bash
docker compose exec php bin/console debug:container App\\Controller\\Api\\JiraSyncController
```
Expected: la commande affiche les informations du service sans erreur (confirme que l'autowiring de `DayMaterializer` fonctionne — la nouvelle dépendance est résolue correctement).

Run (comportement inchangé quand JIRA n'est pas configuré — c'est le cas dans cet environnement de dev, `JIRA_API_TOKEN` est vide dans `.env`) :
```bash
curl -sk -X POST https://daytrack.localhost/api/days/2026-08-30/jira-sync
```
Expected: `503`, `{"error":"JIRA n'est pas configuré"}` — confirme que le contrôleur route et boot toujours correctement après le changement (la vérification `isConfigured()` intervient avant la résolution du jour, donc le nouveau chemin de matérialisation n'est atteignable qu'avec JIRA configuré — la logique de `DayMaterializer::materialize()` elle-même a déjà été vérifiée de façon exhaustive en Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/Controller/Api/JiraSyncController.php
git commit -m "feat: matérialiser le jour depuis les règles avant la synchro JIRA"
```

---

## Récapitulatif

À l'issue de ce plan :
- Les règles récurrentes sont créables/modifiables/supprimables via `/api/template-rules`.
- `GET /api/days/{date}` prévisualise un jour vide sans jamais créer de ligne en base.
- `POST /api/days/{date}/materialize`, la création d'une entrée, le `PATCH` de l'objectif, et la synchro JIRA matérialisent tous un jour vide de la même façon, une seule fois, de façon idempotente.
- Aucune règle ne peut jamais affecter rétroactivement un jour antérieur à sa création (`activeFrom` figé).
- Un plan frontend séparé consommera cette API pour construire la vue "Modèles".
