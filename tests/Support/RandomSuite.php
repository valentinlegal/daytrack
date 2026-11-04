<?php

namespace App\Tests\Support;

use Random\Engine\Mt19937;
use Random\Randomizer;

/**
 * Les suites de gestes tirées au hasard, côté serveur.
 *
 * Chaque test reçoit un tirage né d'une graine : une graine neuve à chaque passage,
 * pour chercher plus loin, ou celle de RANDOM_SEED pour rejouer un échec à
 * l'identique. Un échec affiche la commande qui le rejoue.
 */
trait RandomSuite
{
    private ?int $seed = null;

    protected function randomizer(): Randomizer
    {
        $seed = getenv('RANDOM_SEED');
        $this->seed = false !== $seed && '' !== $seed ? (int) $seed : random_int(1, \PHP_INT_MAX);

        return new Randomizer(new Mt19937($this->seed));
    }

    protected function onNotSuccessfulTest(\Throwable $t): never
    {
        if (null !== $this->seed) {
            fwrite(\STDERR, \sprintf(
                "\nSuite tirée au hasard en échec. Pour la rejouer à l'identique :\n  RANDOM_SEED=%d bin/phpunit --filter '%s'\n",
                $this->seed,
                addslashes(static::class.'::'.$this->name()),
            ));
        }

        parent::onNotSuccessfulTest($t);
    }
}
