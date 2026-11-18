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
     * @param array<int, string>      $links    l'identifiant de la récurrence qui a posé chacun, s'il y en a une
     */
    private function __construct(private array $quarters, private array $links)
    {
    }

    public static function empty(): self
    {
        return new self([], []);
    }

    /**
     * @param array<int, SlotContent> $quarters les quarts d'heure occupés, par leur début
     * @param array<int, string>      $links    la récurrence qui a posé chacun, s'il y en a une
     */
    public static function of(array $quarters, array $links = []): self
    {
        foreach (array_keys($quarters) as $start) {
            if (!Quarter::isBoundary($start) || Quarter::DAY_END === $start) {
                throw new \InvalidArgumentException(\sprintf('%d ne commence pas un quart d\'heure de la grille.', $start));
            }
        }
        if ([] !== array_diff_key($links, $quarters)) {
            throw new \InvalidArgumentException('Une récurrence ne pose rien sur un quart d\'heure vide.');
        }
        ksort($quarters);

        return new self($quarters, $links);
    }

    /**
     * Les blocs affichés : les quarts d'heure voisins au même contenu, regroupés. Deux
     * contenus égaux posés par deux récurrences différentes — ou l'un par une récurrence,
     * l'autre à la main — restent deux blocs : chacun a sa flèche, ou n'en a pas.
     *
     * @return list<Block>
     */
    public function blocks(): array
    {
        $blocks = [];
        $current = null;
        foreach ($this->quarters as $start => $content) {
            $link = $this->links[$start] ?? null;
            if (null !== $current && $current->end === $start && $current->content->equals($content) && $current->recurrence === $link) {
                $current = new Block($current->start, $start + Quarter::MINUTES, $current->content, $link);
                continue;
            }
            if (null !== $current) {
                $blocks[] = $current;
            }
            $current = new Block($start, $start + Quarter::MINUTES, $content, $link);
        }
        if (null !== $current) {
            $blocks[] = $current;
        }

        return $blocks;
    }

    /**
     * La journée telle qu'elle se montre un jour à venir : ses saisies, et sur les quarts
     * d'heure qu'elles laissent libres, les fois prévues de ses récurrences, chacune à son
     * tour, quart d'heure par quart d'heure. Ce qui est saisi l'emporte, et une fois prévue
     * ne prend pas le quart d'heure d'une autre placée avant elle. Les tests du navigateur
     * éprouvent la même règle (tests/front/grid/support.ts, withPlanned) sur les cas de
     * tests/cases/day-figures.json.
     *
     * @param list<array{SlotContent, int, int, string}> $planned chaque fois prévue : son contenu, son début, sa fin, sa récurrence
     */
    public function withPlanned(array $planned): self
    {
        $quarters = $this->quarters;
        $links = $this->links;
        foreach ($planned as [$content, $start, $end, $recurrence]) {
            foreach (Quarter::between($start, $end) as $quarter) {
                if (!isset($quarters[$quarter])) {
                    $quarters[$quarter] = $content;
                    $links[$quarter] = $recurrence;
                }
            }
        }

        return self::of($quarters, $links);
    }

    /** Ce que contient ce quart d'heure, ou null s'il est vide. */
    public function contentAt(int $start): ?SlotContent
    {
        return $this->quarters[$start] ?? null;
    }

    /** La récurrence qui pose ce quart d'heure, ou null. */
    public function linkAt(int $start): ?string
    {
        return $this->links[$start] ?? null;
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

    /**
     * La même grille, sans les liens de ces récurrences : leurs quarts d'heure gardent leur
     * contenu, comme une saisie ordinaire.
     *
     * @param list<string> $recurrences
     */
    public function unlinking(array $recurrences): self
    {
        return [] === $recurrences ? $this : new self($this->quarters, array_filter($this->links, static fn (string $link): bool => !\in_array($link, $recurrences, true)));
    }

    /**
     * Les récurrences qui ont posé quelque chose ce jour-là, chacune une fois.
     *
     * @return list<string>
     */
    public function recurrences(): array
    {
        return array_values(array_unique($this->links));
    }

    public function isPauseAt(int $minute): bool
    {
        $content = $this->quarters[$minute - $minute % Quarter::MINUTES] ?? null;

        return null !== $content && !$content->isWork();
    }
}
