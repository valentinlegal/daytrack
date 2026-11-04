<?php

namespace App\Installation;

use Symfony\Component\DependencyInjection\EnvVarProcessorInterface;

/**
 * Le secret de Symfony, propre à chaque installation : `%env(installation_secret:…)%`
 * le tire de la clé d'installation dont la variable nomme le fichier.
 *
 * Il n'est donc ni dans l'image, ni vide, ni à écrire dans un fichier de
 * configuration.
 */
final class InstallationSecretProcessor implements EnvVarProcessorInterface
{
    public function getEnv(string $prefix, string $name, \Closure $getEnv): string
    {
        $path = $getEnv($name);

        if (!\is_string($path) || '' === $path) {
            throw new \RuntimeException(\sprintf('La variable %s ne nomme pas le fichier de la clé d\'installation.', $name));
        }

        return bin2hex(new InstallationKey($path)->derive(InstallationKey::APP_SECRET));
    }

    public static function getProvidedTypes(): array
    {
        return ['installation_secret' => 'string'];
    }
}
