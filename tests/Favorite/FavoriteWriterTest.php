<?php

namespace App\Tests\Favorite;

use App\Favorite\DuplicateFavorite;
use App\Favorite\FavoriteWriter;
use App\Repository\FavoriteRepository;
use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Uid\Uuid;

/**
 * Le seul chemin d'écriture des favoris, appelé comme le fait l'API : ce qu'il refuse
 * sous le verrou, quand la validation n'a rien vu — un autre onglet a écrit entre les
 * deux —, il le refuse sans rien écrire.
 */
final class FavoriteWriterTest extends KernelTestCase
{
    private FavoriteWriter $writer;

    protected function setUp(): void
    {
        self::bootKernel();
        self::getContainer()->get(Connection::class)->executeStatement('DELETE FROM favorite');
        $this->writer = self::getContainer()->get(FavoriteWriter::class);
    }

    public function testUnDoublonSeRefuseSousLeVerrouSansRienEcrire(): void
    {
        $this->writer->add('SHOP-482', null, 0);

        try {
            $this->writer->add('SHOP-482', 'Export', 0);
            self::fail('Le doublon est passé.');
        } catch (DuplicateFavorite) {
        }

        self::assertSame([['SHOP-482', null, 0]], $this->rows());
    }

    public function testUnFavoriDisparuOuUnOrdrePerimeNEcriventRien(): void
    {
        $this->writer->add('SHOP-482', null, 0);
        $this->writer->add('OPS-12', null, 1);
        $gone = Uuid::v7();

        self::assertFalse($this->writer->rename($gone, 'Export'));
        self::assertFalse($this->writer->remove($gone));
        self::assertFalse($this->writer->reorder([$gone]));
        self::assertSame([['SHOP-482', null, 0], ['OPS-12', null, 1]], $this->rows());
    }

    /**
     * @return list<array{string, ?string, int}>
     */
    private function rows(): array
    {
        return array_map(
            static fn ($favorite): array => [$favorite->ticket, $favorite->name, $favorite->position],
            self::getContainer()->get(FavoriteRepository::class)->ordered(),
        );
    }
}
