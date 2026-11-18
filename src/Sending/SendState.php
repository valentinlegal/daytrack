<?php

namespace App\Sending;

use App\Entity\DaySend;

/**
 * Ce que dit le bouton Jira d'un jour, et d'où vient la marque du calendrier.
 *
 * Il se déduit de ce qui est enregistré, jamais de la mémoire du navigateur : un
 * rechargement le retrouve tel quel.
 */
enum SendState: string
{
    /** Ni ticket à envoyer, ni heures que DayTrack aurait laissées dans Jira. */
    case Nothing = 'nothing';
    case Unsent = 'unsent';
    case Sending = 'sending';
    /** Jira, relu, a les heures de la journée telle qu'elle est. */
    case Sent = 'sent';
    /** Envoyée en entier, puis modifiée : ce qui est dans Jira n'est plus la journée. */
    case Modified = 'modified';
    case Partial = 'partial';
    /** Jira a accepté, puis n'a pas pu être relu : DayTrack ne sait pas ce qu'il a gardé. */
    case Unverified = 'unverified';
    case Failed = 'failed';

    /**
     * @param list<Worklog> $worklogs les saisies de la journée telle qu'elle est
     */
    public static function of(?DaySend $send, array $worklogs, \DateTimeImmutable $now): self
    {
        if (null !== $send && $send->isSending($now)) {
            return self::Sending;
        }

        return self::settled($send, $worklogs, $now);
    }

    /**
     * Ce qu'il dit en dehors d'un envoi en cours : la marque du calendrier ne bouge pas
     * pendant un envoi.
     *
     * @param list<Worklog> $worklogs
     */
    public static function settled(?DaySend $send, array $worklogs, \DateTimeImmutable $now): self
    {
        // Après un envoi partiel ou un échec, une journée modifiée rouvre la
        // confirmation : le résultat parlerait d'autres tickets que les siens.
        if (null !== $send?->result && Worklog::sameList($send->attempted(), $worklogs)) {
            return match ($send->result) {
                SendResult::Partial => self::Partial,
                SendResult::Unverified => self::Unverified,
                SendResult::Failed => self::Failed,
            };
        }

        // Une journée vidée après un envoi a encore des heures dans Jira : elle se renvoie.
        // Vidée et envoyée, mais Jira ne trouvait plus un de ses tickets : elle reste
        // envoyée, pour que son détail le redise.
        if ([] === $worklogs && (null === $send || $send->leavesNoHours())) {
            return self::Nothing;
        }

        if (null === $send?->sentAt) {
            return true === $send?->sentByV1 ? self::Modified : self::Unsent;
        }

        // Un essai qui a pu écrire depuis, ou un envoi interrompu : Jira ne se sait plus égal
        // à la journée, même revenue à ce qui avait été envoyé.
        $sent = $send->sent($now);

        return null !== $sent && Worklog::sameList($sent, $worklogs) ? self::Sent : self::Modified;
    }
}
