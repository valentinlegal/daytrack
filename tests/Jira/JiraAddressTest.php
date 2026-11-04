<?php

namespace App\Tests\Jira;

use App\Jira\JiraAddress;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * L'adresse de Jira, comme l'utilisateur la tape ou la colle.
 */
final class JiraAddressTest extends TestCase
{
    private const string CLOUD_ID = '5d1e0c3a-7b42-4f8e-9c61-2a8f4b0d7e19';

    #[DataProvider('typed')]
    public function testUneAdresseTapeeRevientAuSiteEnHttps(string $typed, string $site): void
    {
        $address = JiraAddress::parse($typed);

        self::assertNotNull($address);
        self::assertSame($site, $address->site);
        self::assertFalse($address->isGateway());
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function typed(): iterable
    {
        yield 'telle quelle' => ['https://exemple.atlassian.net', 'https://exemple.atlassian.net'];
        yield 'sans https' => ['exemple.atlassian.net', 'https://exemple.atlassian.net'];
        yield 'en http' => ['http://exemple.atlassian.net', 'https://exemple.atlassian.net'];
        yield 'avec des espaces autour' => ["  https://exemple.atlassian.net/ \n", 'https://exemple.atlassian.net'];
        yield 'en majuscules' => ['HTTPS://Exemple.Atlassian.NET', 'https://exemple.atlassian.net'];
        yield 'collée depuis un ticket' => ['https://exemple.atlassian.net/browse/SHOP-482?focusedCommentId=1', 'https://exemple.atlassian.net'];
        yield 'avec un port' => ['https://jira.exemple.fr:8443/jira', 'https://jira.exemple.fr:8443'];
    }

    public function testLAdresseDeLaPasserelleSeGarde(): void
    {
        $address = JiraAddress::parse('https://api.atlassian.com/ex/jira/'.strtoupper(self::CLOUD_ID).'/');

        self::assertNotNull($address);
        self::assertTrue($address->isGateway());
        self::assertSame(self::CLOUD_ID, $address->cloudId);
        self::assertSame('https://api.atlassian.com/ex/jira/'.self::CLOUD_ID, $address->site);
    }

    #[DataProvider('refused')]
    public function testCeQuiNEstPasUneAdresseEstRefuse(string $typed): void
    {
        self::assertNull(JiraAddress::parse($typed));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function refused(): iterable
    {
        yield 'vide' => ['   '];
        yield 'deux mots' => ['mon jira'];
        yield 'un autre protocole' => ['ftp://exemple.atlassian.net'];
        yield 'sans hôte' => ['https://'];
        yield 'avec un identifiant dedans' => ['https://moi:secret@exemple.atlassian.net'];
    }
}
