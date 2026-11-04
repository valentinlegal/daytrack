<?php

namespace App\Settings;

/**
 * Les douze teintes d'un type de ticket, dans l'ordre de la palette : c'est leur nom dans
 * data-color.
 */
enum Tint: string
{
    case Rouge = 'rouge';
    case Orange = 'orange';
    case Ambre = 'ambre';
    case Olive = 'olive';
    case Vert = 'vert';
    case Sarcelle = 'sarcelle';
    case Cyan = 'cyan';
    case Bleu = 'bleu';
    case Violet = 'violet';
    case Magenta = 'magenta';
    case Rose = 'rose';
    case Gris = 'gris';

    /** Les types de départ de Jira, reconnus par leur nom anglais ou français, et leur teinte. */
    private const array STARTING = [
        'story' => self::Vert,
        'bug' => self::Rouge,
        'task' => self::Bleu,
        'tâche' => self::Bleu,
        'epic' => self::Violet,
        'épopée' => self::Violet,
    ];

    /**
     * La teinte d'un type qu'on rencontre pour la première fois : celle de son nom pour
     * un type de départ, sinon la première qu'aucun type du même Jira n'a encore, puis
     * le gris.
     *
     * @param list<self> $taken celles des types déjà connus de ce Jira
     */
    public static function forNewType(string $name, array $taken): self
    {
        $starting = self::STARTING[mb_strtolower(trim($name))] ?? null;
        if (null !== $starting) {
            return $starting;
        }

        foreach (self::cases() as $tint) {
            if (!\in_array($tint, $taken, true)) {
                return $tint;
            }
        }

        return self::Gris;
    }
}
