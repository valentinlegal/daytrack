<?php

namespace App\Tests\Installation;

use App\Installation\InstallationKey;
use App\Jira\TokenCipher;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/**
 * La clé d'installation et le jeton qu'elle chiffre. La clé vit hors de la base, se crée
 * seule, ne se remplace jamais ; le jeton chiffré ne se lit qu'avec elle.
 */
final class InstallationKeyTest extends KernelTestCase
{
    private const string TOKEN = 'ATATT3xFfGF0-jeton-de-test';

    private string $directory;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir().'/daytrack-cle-'.bin2hex(random_bytes(6));
    }

    protected function tearDown(): void
    {
        $files = glob($this->directory.'/{,.}*', \GLOB_BRACE);
        foreach (false === $files ? [] : $files as $file) {
            if (is_file($file)) {
                unlink($file);
            }
        }
        if (is_dir($this->directory)) {
            rmdir($this->directory);
        }
        parent::tearDown();
    }

    public function testLaCleSeCreeAuPremierBesoinLisibleParSonSeulProprietaire(): void
    {
        $path = $this->directory.'/installation.key';

        new InstallationKey($path)->derive(InstallationKey::JIRA_TOKEN);

        self::assertFileExists($path);
        self::assertSame(0o600, fileperms($path) & 0o777);
        self::assertSame(0o700, fileperms($this->directory) & 0o777);
        self::assertSame(SODIUM_CRYPTO_KDF_KEYBYTES, filesize($path));
        self::assertSame([$path], glob($this->directory.'/{,.}*.key*', \GLOB_BRACE), 'Le brouillon de la clé ne reste pas à côté.');
    }

    public function testLaCleResteLaMemeDUnUsageAUnAutre(): void
    {
        $path = $this->directory.'/installation.key';

        $first = new InstallationKey($path)->derive(InstallationKey::JIRA_TOKEN);
        $again = new InstallationKey($path)->derive(InstallationKey::JIRA_TOKEN);

        self::assertSame($first, $again);
        self::assertNotSame($first, new InstallationKey($path)->derive(InstallationKey::APP_SECRET), 'Un usage, une clé.');
    }

    public function testUneCleIllisibleNEstJamaisRemplacee(): void
    {
        mkdir($this->directory, 0o700);
        $path = $this->directory.'/installation.key';
        file_put_contents($path, 'tronquée');

        try {
            new InstallationKey($path)->derive(InstallationKey::JIRA_TOKEN);
            self::fail('Une clé illisible doit arrêter DayTrack.');
        } catch (\RuntimeException $exception) {
            self::assertStringContainsString('illisible', $exception->getMessage());
        }

        self::assertSame('tronquée', file_get_contents($path));
    }

    public function testLeJetonChiffreNeSeLitQuAvecLaCleDeSonInstallation(): void
    {
        $cipher = new TokenCipher(new InstallationKey($this->directory.'/installation.key'));
        $other = new TokenCipher(new InstallationKey($this->directory.'/autre.key'));

        $encrypted = $cipher->encrypt(self::TOKEN);

        self::assertStringNotContainsString(self::TOKEN, $encrypted);
        self::assertStringNotContainsString(base64_encode(self::TOKEN), $encrypted);
        self::assertSame(self::TOKEN, $cipher->decrypt($encrypted));
        self::assertNull($other->decrypt($encrypted));
    }

    public function testDeuxChiffrementsDuMemeJetonDifferent(): void
    {
        $cipher = new TokenCipher(new InstallationKey($this->directory.'/installation.key'));

        self::assertNotSame($cipher->encrypt(self::TOKEN), $cipher->encrypt(self::TOKEN));
    }

    public function testUnChiffreAltereNeSeLitPas(): void
    {
        $cipher = new TokenCipher(new InstallationKey($this->directory.'/installation.key'));
        $encrypted = $cipher->encrypt(self::TOKEN);
        $tampered = substr($encrypted, 0, -4).('AAAA' === substr($encrypted, -4) ? 'BBBB' : 'AAAA');

        self::assertNull($cipher->decrypt($tampered));
        self::assertNull($cipher->decrypt('v1:pas du base64 !'));
        self::assertNull($cipher->decrypt('v1:'.base64_encode('court')));
        self::assertNull($cipher->decrypt(self::TOKEN));
    }

    public function testLeSecretDeSymfonyVientDeLaCleDInstallation(): void
    {
        $kernel = self::bootKernel();
        $secret = self::getContainer()->getParameter('kernel.secret');
        $path = $_SERVER['DAYTRACK_KEY_FILE'] ?? $_ENV['DAYTRACK_KEY_FILE'] ?? null;
        self::assertIsString($path);

        self::assertIsString($secret);
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $secret);
        self::assertSame(bin2hex(new InstallationKey(str_replace('%kernel.project_dir%', $kernel->getProjectDir(), $path))->derive(InstallationKey::APP_SECRET)), $secret);
    }
}
