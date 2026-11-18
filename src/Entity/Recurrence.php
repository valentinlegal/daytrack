<?php

namespace App\Entity;

use App\Api\Input\EntryText;
use App\Day\Quarter;
use App\Day\SlotContent;
use App\Day\SlotKind;
use App\Recurrence\Rhythm;
use App\Recurrence\RhythmKind;
use App\Repository\RecurrenceRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Ce qui revient : un ticket et son commentaire, ou une pause, sur une plage de la
 * journée, à un rythme, depuis un premier jour et jusqu'à une fin facultative.
 *
 * Sa définition ne change jamais : changer une récurrence la coupe en deux, l'ancienne
 * finissant la veille du jour touché, comme dans Google Agenda. Seule sa fin bouge — la
 * couper, l'arrêter, la retirer, ou défaire tout cela —, et ce qu'elle a déjà posé est
 * une saisie comme une autre. Une récurrence retirée finit la veille de son premier
 * jour : elle ne tombe plus jamais, et rétablir n'a qu'à lui rendre sa fin.
 */
#[ORM\Entity(repositoryClass: RecurrenceRepository::class)]
class Recurrence
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    #[ORM\Column(length: 5, enumType: SlotKind::class)]
    private SlotKind $kind;

    #[ORM\Column(length: EntryText::TICKET_MAX, nullable: true)]
    private ?string $ticket;

    #[ORM\Column(length: Slot::COMMENT_MAX, nullable: true)]
    private ?string $comment;

    /** Le début de sa plage, en minutes depuis minuit, au quart d'heure. */
    #[ORM\Column(type: Types::SMALLINT)]
    public private(set) int $start;

    #[ORM\Column(type: Types::SMALLINT)]
    public private(set) int $end;

    #[ORM\Column(length: 20, enumType: RhythmKind::class)]
    private RhythmKind $rhythmKind;

    /** @var list<int> */
    #[ORM\Column(type: Types::JSON)]
    private array $weekdays;

    #[ORM\Column(type: Types::SMALLINT)]
    private int $everyWeeks;

    #[ORM\Column(type: Types::SMALLINT, nullable: true)]
    private ?int $monthWeek;

    #[ORM\Column(type: Types::SMALLINT, nullable: true)]
    private ?int $monthDay;

    /** Le jour du bloc d'où elle est née, ou celui où elle a été coupée. */
    #[ORM\Column(type: Types::DATE_IMMUTABLE)]
    public private(set) \DateTimeImmutable $firstDay;

    #[ORM\Column(type: Types::DATE_IMMUTABLE, nullable: true)]
    public private(set) ?\DateTimeImmutable $until;

    /**
     * Le dernier jour déjà traité (RecurrencePoser) : ceux d'avant ont reçu ce qu'ils
     * devaient, et un jour déjà venu ne reçoit jamais rien après coup.
     */
    #[ORM\Column(type: Types::DATE_IMMUTABLE)]
    public private(set) \DateTimeImmutable $posedThrough;

    /**
     * Collée après une coupe avec les suivantes : la récurrence coupée qu'elle continue
     * ailleurs (follow). Les deux ne vont jamais ensemble au-delà de la coupe : annuler l'une
     * ou rétablir l'autre se refuse tant que l'autre est encore là (DayWriter::assertMoved).
     */
    #[ORM\Column(type: UuidType::NAME, nullable: true)]
    public private(set) ?Uuid $follows = null;

    /** Le jour de cette coupe : toujours avec $follows, jamais sans. */
    #[ORM\Column(type: Types::DATE_IMMUTABLE, nullable: true)]
    public private(set) ?\DateTimeImmutable $cutOn = null;

    public function __construct(SlotContent $content, int $start, int $end, Rhythm $rhythm, \DateTimeImmutable $firstDay, ?\DateTimeImmutable $until, \DateTimeImmutable $posedThrough)
    {
        if (!Quarter::isBoundary($start) || !Quarter::isBoundary($end) || $start < Quarter::FIRST || $end > Quarter::DAY_END || $start >= $end) {
            throw new \InvalidArgumentException('Une récurrence couvre une plage de quarts d\'heure de la grille.');
        }
        $this->id = Uuid::v7();
        $this->kind = $content->kind;
        $this->ticket = $content->ticket;
        $this->comment = $content->comment;
        $this->start = $start;
        $this->end = $end;
        $this->rhythmKind = $rhythm->kind;
        $this->weekdays = $rhythm->weekdays;
        $this->everyWeeks = $rhythm->everyWeeks;
        $this->monthWeek = $rhythm->monthWeek;
        $this->monthDay = $rhythm->monthDay;
        $this->firstDay = $firstDay;
        $this->until = $until;
        $this->posedThrough = $posedThrough;
    }

    public function content(): SlotContent
    {
        return match ($this->kind) {
            SlotKind::Work => SlotContent::work($this->ticket ?? throw new \UnexpectedValueException(\sprintf('La récurrence %s porte du travail sans ticket.', $this->id)), $this->comment),
            SlotKind::Pause => SlotContent::pause(),
        };
    }

    public function rhythm(): Rhythm
    {
        return match ($this->rhythmKind) {
            RhythmKind::Weekly => Rhythm::weekly($this->weekdays, $this->everyWeeks),
            RhythmKind::MonthlyWeekday => Rhythm::monthlyWeekday($this->weekdays[0] ?? 1, $this->monthWeek ?? 1),
            RhythmKind::MonthlyDate => Rhythm::monthlyDate($this->monthDay ?? 1),
        };
    }

    /** Elle tombe ce jour-là, entre son premier jour et sa fin, selon son rythme. */
    public function fallsOn(\DateTimeImmutable $date): bool
    {
        $day = $date->format('Y-m-d');

        return $day >= $this->firstDay->format('Y-m-d')
            && (null === $this->until || $day <= $this->until->format('Y-m-d'))
            && $this->rhythm()->fallsOn($date, $this->firstDay);
    }

    /**
     * Elle va encore jusqu'à ce jour. Finie avant lui — arrêtée ou retirée depuis un autre
     * jour —, ce qu'elle y avait posé n'en est plus une fois : le bloc n'a plus sa flèche
     * (assets/grid/recurrence.ts, reaches).
     */
    public function reaches(\DateTimeImmutable $date): bool
    {
        return null === $this->until || $this->until->format('Y-m-d') >= $date->format('Y-m-d');
    }

    /**
     * Les débuts de ses quarts d'heure.
     *
     * @return list<int>
     */
    public function quarters(): array
    {
        return Quarter::between($this->start, $this->end);
    }

    /**
     * Collée, elle continue la coupée dont elle vient, qui ne va plus jusqu'à ce jour : la
     * coupe a eu lieu le lendemain de sa fin.
     */
    public function follow(Recurrence $source): void
    {
        if (null === $source->until || $source->until >= $this->firstDay) {
            throw new \InvalidArgumentException('Une récurrence collée continue une coupée qui ne va plus jusqu\'à son premier jour.');
        }
        $this->follows = $source->id;
        $this->cutOn = $source->until->modify('+1 day');
    }

    /** Retirée : elle finit la veille de son premier jour, et ne tombe plus jamais. */
    public function isWithdrawn(): bool
    {
        return null !== $this->until && $this->until < $this->firstDay;
    }

    /** La fin qui la retire : la veille de son premier jour, où elle ne tombe jamais. */
    public function withdrawnUntil(): \DateTimeImmutable
    {
        return $this->firstDay->modify('-1 day');
    }

    /** Sa fin change : coupée, arrêtée, retirée, ou rendue par annuler et rétablir. */
    public function endOn(?\DateTimeImmutable $until): void
    {
        if (null !== $until && $until < $this->withdrawnUntil()) {
            throw new \InvalidArgumentException('Une récurrence ne finit pas avant la veille de son premier jour.');
        }
        $this->until = $until;
    }

    /** Ce jour-là et ceux d'avant ont été traités. */
    public function posedUntil(\DateTimeImmutable $date): void
    {
        if ($date > $this->posedThrough) {
            $this->posedThrough = $date;
        }
    }
}
