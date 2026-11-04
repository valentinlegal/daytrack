<?php

namespace App\Day;

/**
 * Une journée vue quart d'heure par quart d'heure : ce que chacun contient, ou rien.
 *
 * C'est la forme que la base enregistre — une ligne par quart d'heure occupé — et
 * celle d'où tout se déduit : les blocs affichés, le temps travaillé. Un quart
 * d'heure n'a qu'un contenu : deux saisies ne peuvent pas s'y superposer.
 */
final readonly class Grid
{
    /**
     * @param array<int, SlotContent> $quarters les quarts d'heure occupés, par leur début, dans l'ordre
     */
    private function __construct(private array $quarters)
    {
    }

    public static function empty(): self
    {
        return new self([]);
    }

    /**
     * @param array<int, SlotContent> $quarters les quarts d'heure occupés, par leur début
     */
    public static function of(array $quarters): self
    {
        foreach (array_keys($quarters) as $start) {
            if (!Quarter::isBoundary($start) || Quarter::DAY_END === $start) {
                throw new \InvalidArgumentException(\sprintf('%d ne commence pas un quart d\'heure de la grille.', $start));
            }
        }
        ksort($quarters);

        return new self($quarters);
    }

    /**
     * Les blocs affichés : les quarts d'heure voisins au même contenu, regroupés.
     *
     * @return list<Block>
     */
    public function blocks(): array
    {
        $blocks = [];
        $current = null;
        foreach ($this->quarters as $start => $content) {
            if (null !== $current && $current->end === $start && $current->content->equals($content)) {
                $current = new Block($current->start, $start + Quarter::MINUTES, $current->content);
                continue;
            }
            if (null !== $current) {
                $blocks[] = $current;
            }
            $current = new Block($start, $start + Quarter::MINUTES, $content);
        }
        if (null !== $current) {
            $blocks[] = $current;
        }

        return $blocks;
    }

    /** Aucun quart d'heure saisi, pause comprise. */
    public function isEmpty(): bool
    {
        return [] === $this->quarters;
    }

    /** Le temps travaillé, en minutes : les quarts d'heure saisis, pauses exclues. */
    public function workedMinutes(): int
    {
        return $this->workedBefore(Quarter::DAY_END);
    }

    /** Le temps travaillé avant une heure donnée, un quart d'heure entamé compté à la minute. */
    public function workedBefore(int $minute): int
    {
        $worked = 0;
        foreach ($this->quarters as $start => $content) {
            if ($start >= $minute) {
                break;
            }
            if ($content->isWork()) {
                $worked += min(Quarter::MINUTES, $minute - $start);
            }
        }

        return $worked;
    }

    /**
     * Les tickets de la journée, chacun une fois, dans l'ordre où ils apparaissent.
     *
     * @return list<string>
     */
    public function tickets(): array
    {
        $tickets = [];
        foreach ($this->quarters as $content) {
            if (null !== $content->ticket) {
                $tickets[$content->ticket] = true;
            }
        }

        return array_keys($tickets);
    }

    public function isPauseAt(int $minute): bool
    {
        $content = $this->quarters[$minute - $minute % Quarter::MINUTES] ?? null;

        return null !== $content && !$content->isWork();
    }
}
