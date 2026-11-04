<?php

namespace App\Tests\Settings;

use App\Settings\Tint;
use PHPUnit\Framework\TestCase;

/**
 * La teinte qu'un type prend à sa première rencontre.
 */
final class TintTest extends TestCase
{
    public function testLesTypesDeDepartPrennentLeurTeinteEnAnglaisCommeEnFrancais(): void
    {
        $expected = [
            'Story' => Tint::Vert, 'story' => Tint::Vert, ' STORY ' => Tint::Vert,
            'Bug' => Tint::Rouge,
            'Task' => Tint::Bleu, 'Tâche' => Tint::Bleu, 'TÂCHE' => Tint::Bleu,
            'Epic' => Tint::Violet, 'Épopée' => Tint::Violet,
        ];

        foreach ($expected as $name => $tint) {
            self::assertSame($tint, Tint::forNewType($name, []), $name);
        }
    }

    public function testUnTypeDeDepartGardeSaTeinteMemeDejaPrise(): void
    {
        self::assertSame(Tint::Rouge, Tint::forNewType('Bug', [Tint::Rouge]));
    }

    public function testUnAutreTypePrendLaPremiereTeinteLibreDansLOrdreDeLaPalette(): void
    {
        self::assertSame(Tint::Rouge, Tint::forNewType('Support client', []));
        self::assertSame(Tint::Orange, Tint::forNewType('Support client', [Tint::Vert, Tint::Rouge, Tint::Bleu, Tint::Violet]));
        self::assertSame(Tint::Olive, Tint::forNewType('Incident', [Tint::Rouge, Tint::Orange, Tint::Ambre, Tint::Rouge]));
    }

    public function testQuandLesDouzeSontPrisesCEstLeGris(): void
    {
        self::assertSame(Tint::Gris, Tint::forNewType('Incident', array_slice(Tint::cases(), 0, 11)));
        self::assertSame(Tint::Gris, Tint::forNewType('Incident', Tint::cases()));
    }
}
