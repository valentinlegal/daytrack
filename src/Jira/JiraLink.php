<?php

namespace App\Jira;

use App\Database\LockedTransaction;
use App\Entity\JiraConnection;
use App\Repository\DaySendRepository;
use App\Repository\IssueTypeRepository;
use App\Repository\JiraConnectionRepository;
use App\Repository\TicketRepository;
use Doctrine\ORM\EntityManagerInterface;

/**
 * La connexion de DayTrack à Jira : la tester, la garder, savoir si elle tient.
 *
 * Une connexion ne se garde qu'une fois testée : un refus laisse l'ancienne en place,
 * une adresse à moitié tapée ne coupe rien. Le jeton enregistré ne part que vers
 * Jira : changé d'adresse sans être recollé, il ne suit que vers un site d'Atlassian
 * ou celui qu'il servait déjà.
 */
final readonly class JiraLink
{
    /** Les sites où un jeton Atlassian peut servir, et donc où le jeton enregistré peut suivre une nouvelle adresse. */
    private const string ATLASSIAN_HOSTS = '/(^|\.)atlassian\.net$|^api\.atlassian\.com$/';

    public function __construct(
        private JiraConnectionRepository $connections,
        private TicketRepository $tickets,
        private IssueTypeRepository $types,
        private DaySendRepository $sends,
        private EntityManagerInterface $entityManager,
        private LockedTransaction $transaction,
        private JiraClient $jira,
        private TokenCipher $cipher,
    ) {
    }

    public function current(): ?JiraConnection
    {
        return $this->connections->current();
    }

    /**
     * Les identifiants enregistrés ; null si DayTrack n'est pas relié. Un jeton qui ne
     * se déchiffre plus — la clé d'installation a été perdue — se dit comme un jeton
     * refusé : on le recolle dans les réglages.
     */
    public function credentials(): JiraCredentials|JiraFailure|null
    {
        $connection = $this->current();

        if (null === $connection) {
            return null;
        }

        $token = $this->cipher->decrypt($connection->encryptedToken);

        if (null === $token) {
            $this->record(JiraFailure::Refused);

            return JiraFailure::Refused;
        }

        return new JiraCredentials($connection->api, $connection->email, $token);
    }

    /**
     * Teste une connexion sans rien garder. Sans jeton, c'est celui qui est enregistré
     * qui se teste : on change l'adresse sans recoller le jeton.
     */
    public function test(JiraAddress $address, string $email, #[\SensitiveParameter] ?string $token): JiraConnected|JiraFailure|JiraLinkRefusal
    {
        $token ??= $this->storedTokenFor($address);

        return $token instanceof JiraLinkRefusal ? $token : $this->jira->connect($address, $email, $token);
    }

    /** Teste, puis garde si la connexion marche. */
    public function link(JiraAddress $address, string $email, #[\SensitiveParameter] ?string $token): JiraConnected|JiraFailure|JiraLinkRefusal
    {
        $token ??= $this->storedTokenFor($address);

        if ($token instanceof JiraLinkRefusal) {
            return $token;
        }

        $connected = $this->jira->connect($address, $email, $token);

        if (!$connected instanceof JiraConnected) {
            return $connected;
        }

        $encrypted = $this->cipher->encrypt($token);

        $this->write(function () use ($address, $email, $encrypted, $connected): void {
            $connection = $this->connections->current();

            if (null === $connection) {
                $instance = $connected->cloudId ?? $address->site;
                $this->entityManager->persist(new JiraConnection($address->site, $connected->api, $instance, $email, $encrypted, $connected->account));
                // Repris de la v1 sans Jira relié, l'envoi des journées attendait
                // celui-ci : l'ancienne base ne dit pas lequel, et on en a rarement deux.
                $this->sends->adoptUnclaimed($instance, $connected->account->id);

                return;
            }

            // Les titres et les types gardés venaient d'une autre adresse : ils se relisent.
            if ($connection->api !== $connected->api) {
                $this->tickets->forgetAll();
            }

            // Un site qui n'a pas dit son identifiant, cette fois, reste le Jira qu'il était.
            $instance = $connected->cloudId ?? ($address->site === $connection->site ? $connection->instance : $address->site);
            // Le même site, reconnu jusqu'ici à son adresse faute d'identifiant — une base
            // d'avant les réglages, un site muet à la première liaison — : c'est le même
            // Jira, ses types et leurs teintes le suivent, et l'état d'envoi de ses journées.
            if ($address->site === $connection->site && $connection->instance === $connection->site && $instance !== $connection->instance) {
                $this->types->moveToInstance($connection->instance, $instance);
                $this->sends->moveToInstance($connection->instance, $instance);
            }
            // Le compte de la v1 n'était pas connu : le même Jira — par le site ou par la
            // passerelle —, la même adresse e-mail, c'est le sien, et les journées reprises
            // avec lui. Sinon, elles restent sans compte : ce compte-là n'a rien reçu.
            if (!$connection->isConfirmed() && ($instance === $connection->instance || $address->site === $connection->site) && 0 === strcasecmp($email, $connection->email)) {
                $this->sends->moveToAccount($instance, JiraConnection::UNCONFIRMED, $connected->account->id);
            }
            $connection->relink($address->site, $connected->api, $instance, $email, $encrypted, $connected->account);
        });

        return $connected;
    }

    /** Le jeton enregistré passe-t-il toujours ? La réponse est notée, pour le bandeau. */
    public function check(): JiraAccount|JiraFailure|null
    {
        $credentials = $this->credentials();

        if (!$credentials instanceof JiraCredentials) {
            return $credentials;
        }

        $account = $this->jira->myself($credentials);
        $this->record($account);

        return $account;
    }

    /**
     * Ce qu'un appel fait avec le jeton enregistré a appris de lui : un refus s'inscrit,
     * une réponse de Jira l'efface. Un Jira muet ne dit rien du jeton.
     *
     * Un ticket lu n'efface pas un périmètre manquant : il ne demande que read:jira-work,
     * qu'un jeton de la v1 a. Seule la vérification du jeton, qui éprouve le compte, ou
     * une nouvelle connexion le lèvent.
     */
    public function record(JiraAccount|JiraIssue|JiraFailure $outcome): void
    {
        if (JiraFailure::Unreachable === $outcome || JiraFailure::NotFound === $outcome) {
            return;
        }

        $connection = $this->current();

        if (null === $connection || ($outcome instanceof JiraIssue && JiraFailure::MissingScope === $connection->refusal)) {
            return;
        }

        $refusal = $outcome instanceof JiraFailure ? $outcome : null;
        $renamed = $outcome instanceof JiraAccount && $outcome->id === $connection->accountId && $outcome->name !== $connection->accountName;

        $confirming = $outcome instanceof JiraAccount && !$connection->isConfirmed();

        if ($connection->refusal === $refusal && !$renamed && !$confirming) {
            return;
        }

        // Un périmètre manque : le bandeau dira lequel. Jira ne le nomme pas dans son
        // refus, il s'éprouve un par un, une fois, quand le refus apparaît.
        $missingScopes = [];
        if (JiraFailure::MissingScope === $refusal) {
            $credentials = $this->credentials();
            $missingScopes = $credentials instanceof JiraCredentials ? $this->jira->missingScopes($credentials) : [];
        }

        $this->write(function () use ($outcome, $missingScopes): void {
            $connection = $this->connections->current();

            if (null === $connection) {
                return;
            }

            if ($outcome instanceof JiraFailure) {
                $connection->refuse($outcome, $missingScopes);
            } else {
                if ($outcome instanceof JiraAccount && !$connection->isConfirmed()) {
                    $this->sends->moveToAccount($connection->instance, JiraConnection::UNCONFIRMED, $outcome->id);
                }
                $connection->accept($outcome instanceof JiraAccount ? $outcome : null);
            }
        });
    }

    /**
     * Le jeton enregistré, pour tester une nouvelle adresse : il ne suit que vers un
     * site d'Atlassian, ou vers celui qu'il servait déjà.
     */
    private function storedTokenFor(JiraAddress $address): string|JiraLinkRefusal
    {
        $connection = $this->current();

        if (null === $connection) {
            return JiraLinkRefusal::TokenMissing;
        }

        $host = (string) parse_url($address->site, \PHP_URL_HOST);

        if ($address->site !== $connection->site && 1 !== preg_match(self::ATLASSIAN_HOSTS, $host)) {
            return JiraLinkRefusal::TokenStaysHome;
        }

        return $this->cipher->decrypt($connection->encryptedToken) ?? JiraLinkRefusal::TokenMissing;
    }

    /**
     * Une écriture de la connexion, d'un seul tenant : la connexion lue ensuite est la
     * dernière.
     *
     * @param \Closure(): void $change
     */
    private function write(\Closure $change): void
    {
        $this->transaction->run($this->connections, $change);
    }
}
