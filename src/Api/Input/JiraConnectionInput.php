<?php

namespace App\Api\Input;

use App\Jira\JiraAddress;
use App\Jira\JiraTokenGiven;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * La connexion à Jira, telle que la bienvenue ou les réglages l'envoient : l'adresse,
 * l'e-mail, et le jeton s'il a été collé. Sans jeton, c'est celui qui est enregistré
 * qui sert : on corrige l'adresse sans recoller le jeton.
 */
#[JiraTokenGiven]
final readonly class JiraConnectionInput
{
    private const int TEXT_MAX = 255;
    private const int TOKEN_MAX = 1024;

    public ?string $site;
    public ?string $email;
    public ?string $token;

    public function __construct(
        ?string $site = null,
        ?string $email = null,
        #[\SensitiveParameter]
        ?string $token = null,
    ) {
        // Une espace insécable se tape sans la voir (Alt+Espace sur un Mac) : elle ne fait
        // pas refuser l'adresse ni l'e-mail.
        $this->site = EntryText::trimmed($site);
        $this->email = EntryText::trimmed($email);
        $this->token = self::trimmed($token);
    }

    #[Assert\Callback]
    public function validateFields(ExecutionContextInterface $context): void
    {
        if (null === $this->site) {
            $context->buildViolation('Indiquez l\'adresse de Jira.')->atPath('site')->addViolation();
        } elseif (mb_strlen($this->site) > self::TEXT_MAX || null === JiraAddress::parse($this->site)) {
            $context->buildViolation('Une adresse de Jira s\'écrit comme https://exemple.atlassian.net.')->atPath('site')->addViolation();
        }

        if (null === $this->email) {
            $context->buildViolation('Indiquez votre adresse e-mail.')->atPath('email')->addViolation();
        } else {
            $context->getValidator()->inContext($context)->atPath('email')->validate($this->email, [
                new Assert\Length(max: self::TEXT_MAX, maxMessage: EntryText::fitsIn('Une adresse e-mail', self::TEXT_MAX)),
                new Assert\Email(message: 'Une adresse e-mail s\'écrit comme camille.martin@exemple.fr.'),
            ]);
        }

        // Le jeton refusé n'est jamais recopié dans le message : il ne repart pas vers
        // le navigateur, pas même tel qu'on l'a collé.
        if (null !== $this->token && (\strlen($this->token) > self::TOKEN_MAX || 1 === preg_match('/[\s\p{Cc}]/u', $this->token))) {
            $context->buildViolation('Un jeton d\'API tient sur une ligne, sans espace.')->atPath('token')->setInvalidValue(null)->addViolation();
        }
    }

    public function address(): JiraAddress
    {
        return JiraAddress::parse($this->site ?? '') ?? throw new \LogicException('Une adresse de Jira invalide a passé la validation.');
    }

    public function email(): string
    {
        return $this->email ?? throw new \LogicException('Une connexion sans e-mail a passé la validation.');
    }

    /**
     * @return array<string, ?string>
     */
    public function __debugInfo(): array
    {
        return ['site' => $this->site, 'email' => $this->email, 'token' => null === $this->token ? null : '(masqué)'];
    }

    private static function trimmed(#[\SensitiveParameter] ?string $value): ?string
    {
        $value = null === $value ? null : trim($value);

        return '' === $value ? null : $value;
    }
}
