<?php

namespace App\Tests\Support;

use PHPUnit\Framework\Assert;

/**
 * Lire une réponse JSON dans un test en vérifiant chaque étape du chemin : une clé
 * absente échoue sur son nom, au lieu d'un « null » qui passerait plus loin.
 */
trait ReadsJson
{
    protected static function at(mixed $data, string|int ...$path): mixed
    {
        foreach ($path as $key) {
            Assert::assertIsArray($data, \sprintf('« %s » : pas un tableau.', $key));
            Assert::assertArrayHasKey($key, $data);
            $data = $data[$key];
        }

        return $data;
    }

    /**
     * @return array<mixed>
     */
    protected static function arrayAt(mixed $data, string|int ...$path): array
    {
        $value = self::at($data, ...$path);
        Assert::assertIsArray($value);

        return $value;
    }

    /**
     * @return list<array<mixed>>
     */
    protected static function listAt(mixed $data, string|int ...$path): array
    {
        $value = self::arrayAt($data, ...$path);
        Assert::assertTrue(array_is_list($value), 'Une liste était attendue.');

        $items = [];
        foreach ($value as $item) {
            Assert::assertIsArray($item);
            $items[] = $item;
        }

        return $items;
    }

    protected static function stringAt(mixed $data, string|int ...$path): string
    {
        $value = self::at($data, ...$path);
        Assert::assertIsString($value);

        return $value;
    }

    protected static function intAt(mixed $data, string|int ...$path): int
    {
        $value = self::at($data, ...$path);
        Assert::assertIsInt($value);

        return $value;
    }
}
