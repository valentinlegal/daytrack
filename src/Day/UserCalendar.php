<?php

namespace App\Day;

use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Le jour et l'heure de l'utilisateur, lus dans son fuseau.
 *
 * C'est le seul endroit du serveur qui dit quel jour on est : le conteneur vit en
 * heure universelle, et à 00:30 à Paris il est encore la veille pour lui.
 */
final readonly class UserCalendar
{
    /** Au-delà, un jour ne s'ouvre pas : l'adresse ramène à aujourd'hui. */
    public const int FUTURE_DAYS = 30;

    private \DateTimeZone $timezone;

    public function __construct(
        private ClockInterface $clock,
        #[Autowire('%env(DAYTRACK_TIMEZONE)%')]
        string $timezone,
    ) {
        $this->timezone = new \DateTimeZone($timezone);
    }

    /** Aujourd'hui, à minuit, dans le format des dates de la base. */
    public function today(): \DateTimeImmutable
    {
        return self::date($this->clock->now()->setTimezone($this->timezone)->format('Y-m-d'))
            ?? throw new \LogicException('L\'horloge rend une date illisible.');
    }

    /** L'heure qu'il est sur la grille, en minutes depuis minuit, si $date est aujourd'hui ; null sinon. */
    public function minuteOf(\DateTimeImmutable $date): ?int
    {
        $now = $this->clock->now()->setTimezone($this->timezone);

        return $now->format('Y-m-d') === $date->format('Y-m-d')
            ? (int) $now->format('G') * 60 + (int) $now->format('i')
            : null;
    }

    /** L'instant où commence ce quart d'heure de ce jour, dans le fuseau de l'utilisateur. */
    public function at(\DateTimeImmutable $date, int $minute): \DateTimeImmutable
    {
        return new \DateTimeImmutable($date->format('Y-m-d'), $this->timezone)->setTime(intdiv($minute, 60), $minute % 60);
    }

    /**
     * Le jour de l'utilisateur, de son premier instant au premier du lendemain : ce que
     * Jira y range.
     *
     * @return array{\DateTimeImmutable, \DateTimeImmutable}
     */
    public function bounds(\DateTimeImmutable $date): array
    {
        $start = new \DateTimeImmutable($date->format('Y-m-d'), $this->timezone);

        return [$start, $start->modify('+1 day')];
    }

    /** Un instant, lu dans le fuseau de l'utilisateur. */
    public function local(\DateTimeImmutable $instant): \DateTimeImmutable
    {
        return $instant->setTimezone($this->timezone);
    }

    /**
     * Le jour d'une adresse, « AAAA-MM-JJ », s'il existe au calendrier et s'ouvre :
     * n'importe quel jour passé, et jusqu'à 30 jours devant. Rend null sinon.
     */
    public function open(string $value): ?\DateTimeImmutable
    {
        $date = self::date($value);
        $limit = $this->today()->modify(\sprintf('+%d days', self::FUTURE_DAYS));

        // Des chaînes ISO se comparent dans l'ordre du calendrier, quel que soit le
        // fuseau que porte chaque objet.
        return null !== $date && $date->format('Y-m-d') <= $limit->format('Y-m-d') ? $date : null;
    }

    /**
     * Un instant tel que la base le garde : sans son fuseau, il s'y écrit, et s'en relit,
     * en heure universelle. Le seul endroit qui l'y ramène.
     */
    public static function universal(\DateTimeImmutable $instant): \DateTimeImmutable
    {
        return $instant->setTimezone(new \DateTimeZone('UTC'));
    }

    /**
     * Lit une date « AAAA-MM-JJ » qui existe au calendrier, à minuit en heure
     * universelle — c'est ainsi que la base rend ses dates. Rend null sinon.
     */
    public static function date(string $value): ?\DateTimeImmutable
    {
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, new \DateTimeZone('UTC'));

        return false !== $date && $date->format('Y-m-d') === $value ? $date : null;
    }
}
