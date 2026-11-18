<?php

namespace App\Recurrence;

use App\Day\SlotKind;
use App\Entity\Recurrence;

/**
 * Une récurrence que le serveur refuse, sous son champ : un jour qui n'est plus travaillé,
 * une fin avant le jour du bloc. L'écran l'empêche déjà ; un onglet resté ouvert sur
 * d'anciens réglages, ou un appelant qui ne passe pas par l'écran, non.
 */
final class RecurrenceRefused extends \RuntimeException
{
    private const array DAYS = [1 => 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    private const array MONTHS = [1 => 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

    private function __construct(public readonly string $field, string $message)
    {
        parent::__construct($message);
    }

    public static function notWorking(int $weekday): self
    {
        return new self('recurrence.weekdays', \sprintf('Le %s n\'est plus travaillé. Rechargez la page.', self::DAYS[$weekday] ?? ''));
    }

    /**
     * Le premier jour possible ; d'une autre année que celle d'aujourd'hui, avec la sienne,
     * comme la fenêtre le dit.
     */
    public static function endsBefore(\DateTimeImmutable $date, \DateTimeImmutable $today): self
    {
        $year = $date->format('Y') === $today->format('Y') ? '' : ' '.$date->format('Y');

        return new self('recurrence.until', \sprintf('Choisissez un jour à partir du %s%s.', self::day($date), $year));
    }

    /**
     * Une récurrence coupée qu'on colle, dont la coupe a été annulée depuis : elle est revenue à
     * sa place, et la coller en ferait deux. L'écran retire la récurrence du presse-papier quand
     * on annule la coupe ; un onglet dupliqué avant, non.
     */
    public static function cutUndone(): self
    {
        return new self('follows', 'La coupe de cette récurrence a été annulée. Rien n\'est collé.');
    }

    /**
     * Rétablir le collage d'une récurrence coupée dont la coupe a été annulée : elles iraient
     * toutes deux au-delà de la coupe. Rétablir la coupe d'abord le permet.
     */
    public static function cutFirst(\DateTimeImmutable $cutOn): self
    {
        return new self('recurrences', \sprintf('Rétablissez d\'abord la coupe du %s.', self::day($cutOn)));
    }

    /**
     * Annuler la coupe d'une récurrence alors que son collage est encore là, ou la prolonger
     * depuis sa fenêtre au-delà de lui : elles iraient toutes deux au-delà de la coupe. Annuler le
     * collage d'abord le permet.
     */
    public static function pasteFirst(\DateTimeImmutable $pastedOn, string $field = 'recurrences'): self
    {
        return new self($field, \sprintf('Annulez d\'abord le collage du %s.', self::day($pastedOn)));
    }

    /**
     * Une récurrence coupée qu'on colle, déjà collée ailleurs et encore là : un onglet dupliqué
     * après la coupe la collerait deux fois.
     */
    public static function pastedElsewhere(\DateTimeImmutable $pastedOn): self
    {
        return new self('follows', \sprintf('Cette récurrence a déjà été collée le %s. Rien n\'est collé.', self::day($pastedOn)));
    }

    /**
     * Le créneau revient déjà, par une autre récurrence. La fenêtre le dit en direct, avec son
     * rythme et les fois prises ; ce refus-ci arrive à un onglet qui ne la connaissait pas
     * encore, qui relit alors la journée.
     */
    public static function taken(Recurrence $other): self
    {
        $content = $other->content();

        return new self('recurrence.rhythm', SlotKind::Pause === $content->kind
            ? 'Ce créneau est déjà pris par la pause.'
            : \sprintf("Ce créneau est déjà pris par la récurrence «\u{a0}%s\u{a0}».", $content->comment ?? $content->ticket));
    }

    /** Un rythme mensuel que le jour du bloc ne permet pas : la fenêtre ne le propose jamais. */
    public static function notPermitted(): self
    {
        return new self('recurrence.rhythm', 'Ce rythme ne tombe pas le jour du bloc. Rechargez la page.');
    }

    public static function notOneRange(): self
    {
        return new self('changes', 'Une récurrence couvre une seule plage, d\'un seul ticket.');
    }

    /** « mardi 24 novembre », « mardi 1er décembre ». */
    private static function day(\DateTimeImmutable $date): string
    {
        $day = (int) $date->format('j');

        return \sprintf('%s %s %s', self::DAYS[(int) $date->format('N')], 1 === $day ? '1er' : (string) $day, self::MONTHS[(int) $date->format('n')]);
    }
}
