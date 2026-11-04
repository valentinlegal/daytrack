<?php

namespace App\Day;

use App\Sending\SendState;

/**
 * La marque d'un jour dans le calendrier : une par jour, et « Incomplet » l'emporte. Les
 * autres disent où en est son envoi sur Jira, comme son bouton.
 */
enum DayMark: string
{
    case Incomplete = 'incomplete';
    case Unsent = 'unsent';
    case Sent = 'sent';
    case Modified = 'modified';

    /**
     * La seule définition d'« incomplet » : un jour passé et travaillé selon les réglages,
     * sous son objectif, et commencé — un créneau saisi, pause comprise — ou vide après le
     * point de départ des jours vides. Avant lui, un jour vide n'a aucune marque : rien n'y
     * distinguait un oubli d'un congé. Un jour déclaré non travaillé a 0h00 pour objectif :
     * il n'est jamais sous son objectif. Ensuite, l'état de son envoi, hors d'un envoi en
     * cours : « Non envoyé » pour ce que le bouton propose d'envoyer, essai partiel ou
     * échoué compris.
     *
     * @param int  $objective celui de la journée, l'habituel si elle le suit
     * @param bool $past      avant aujourd'hui, dans le fuseau de l'utilisateur
     * @param bool $working   travaillé selon les réglages d'aujourd'hui
     * @param bool $watched   après le jour du point de départ des jours vides (EmptyDayWatch)
     */
    public static function of(Grid $grid, int $objective, bool $past, bool $working, bool $watched, SendState $send): ?self
    {
        if ($past && $working && ($watched || !$grid->isEmpty()) && $grid->workedMinutes() < $objective) {
            return self::Incomplete;
        }

        return match ($send) {
            SendState::Nothing => null,
            SendState::Sent => self::Sent,
            SendState::Modified => self::Modified,
            SendState::Unsent, SendState::Sending, SendState::Partial, SendState::Unverified, SendState::Failed => self::Unsent,
        };
    }
}
