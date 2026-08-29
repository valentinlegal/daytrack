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
