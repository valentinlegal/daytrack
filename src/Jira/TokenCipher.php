<?php

namespace App\Jira;

use App\Installation\InstallationKey;

/**
 * Le jeton Jira chiffré pour la base, et déchiffré pour Jira seulement.
 *
 * La clé vient de l'installation, hors de la base : qui copie la base n'a pas le
 * jeton. Le chiffrement est authentifié (libsodium) : un jeton altéré ou chiffré par
 * une autre installation ne se déchiffre pas, il ne se lit pas de travers.
 */
final readonly class TokenCipher
{
    /** La forme du chiffré, pour qu'une autre puisse lui succéder sans ambiguïté. */
    private const string VERSION = 'v1:';

    public function __construct(
        private InstallationKey $key,
    ) {
    }

    public function encrypt(#[\SensitiveParameter] string $token): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);

        return self::VERSION.sodium_bin2base64($nonce.sodium_crypto_secretbox($token, $nonce, $this->key->derive(InstallationKey::JIRA_TOKEN)), SODIUM_BASE64_VARIANT_ORIGINAL);
    }

    /** Le jeton, ou null s'il ne se déchiffre pas avec la clé de cette installation. */
    public function decrypt(string $encrypted): ?string
    {
        if (!str_starts_with($encrypted, self::VERSION)) {
            return null;
        }

        try {
            $raw = sodium_base642bin(substr($encrypted, \strlen(self::VERSION)), SODIUM_BASE64_VARIANT_ORIGINAL);
        } catch (\SodiumException) {
            return null;
        }

        if (\strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            return null;
        }

        $token = sodium_crypto_secretbox_open(
            substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES),
            substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES),
            $this->key->derive(InstallationKey::JIRA_TOKEN),
        );

        return false === $token ? null : $token;
    }
}
