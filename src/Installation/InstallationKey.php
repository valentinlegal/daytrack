<?php

namespace App\Installation;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * La clé propre à une installation de DayTrack, d'où se tirent celle qui chiffre le
 * jeton Jira et le secret de Symfony.
 *
 * Elle vit dans un fichier hors de la base — le volume /data, celui du certificat —
 * pour qu'une copie de la base ne livre pas le jeton. DayTrack la crée lui-même au
 * premier besoin : rien à faire à l'installation, et rien dans l'image. Elle n'est
 * jamais remplacée : une clé nouvelle rendrait illisible le jeton déjà chiffré.
 *
 * Elle se relit à chaque usage, sans rester en mémoire d'une requête à l'autre : un
 * volume recréé est vu tout de suite.
 */
final readonly class InstallationKey
{
    /** Les identifiants des clés qu'on en tire : un usage, une clé. */
    public const int JIRA_TOKEN = 1;
    public const int APP_SECRET = 2;

    /** @var array<int, string> le contexte de chaque clé tirée, huit octets comme le veut libsodium */
    private const array CONTEXTS = [
        self::JIRA_TOKEN => 'jiratokn',
        self::APP_SECRET => 'appsecrt',
    ];

    public function __construct(
        #[Autowire('%env(resolve:DAYTRACK_KEY_FILE)%')]
        private string $path,
    ) {
    }

    /**
     * Une clé de 32 octets tirée de celle de l'installation, pour un seul usage.
     *
     * @param self::JIRA_TOKEN|self::APP_SECRET $usage
     */
    public function derive(int $usage): string
    {
        return sodium_crypto_kdf_derive_from_key(SODIUM_CRYPTO_SECRETBOX_KEYBYTES, $usage, self::CONTEXTS[$usage], $this->read());
    }

    private function read(): string
    {
        if (!is_file($this->path)) {
            $this->create();
        }

        $key = file_get_contents($this->path);

        if (false === $key || SODIUM_CRYPTO_KDF_KEYBYTES !== \strlen($key)) {
            throw new \RuntimeException(\sprintf('La clé d\'installation %s est illisible. Elle n\'est pas remplacée : le jeton Jira chiffré avec elle serait perdu.', $this->path));
        }

        return $key;
    }

    /**
     * Écrite à côté puis liée à sa place : deux requêtes qui la créent en même temps
     * n'en gardent qu'une, et aucune ne lit un fichier à moitié écrit.
     */
    private function create(): void
    {
        $directory = \dirname($this->path);

        if (!is_dir($directory) && !mkdir($directory, 0o700, true) && !is_dir($directory)) {
            throw new \RuntimeException(\sprintf('Le dossier %s ne peut pas être créé.', $directory));
        }

        $draft = $directory.'/.'.basename($this->path).'.'.bin2hex(random_bytes(8));
        $handle = fopen($draft, 'x');

        if (false === $handle) {
            throw new \RuntimeException(\sprintf('La clé d\'installation ne peut pas être écrite dans %s.', $directory));
        }

        try {
            chmod($draft, 0o600);
            fwrite($handle, sodium_crypto_kdf_keygen());
            fflush($handle);
        } finally {
            fclose($handle);
        }

        // link() échoue si une autre requête l'a créée entre-temps : c'est la sienne
        // qui reste. Sur un système de fichiers sans liens, elle prend sa place.
        if (!@link($draft, $this->path) && !is_file($this->path)) {
            rename($draft, $this->path);

            return;
        }

        unlink($draft);
    }
}
