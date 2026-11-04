import fc from 'fast-check';

/**
 * Les suites tirées au hasard (fast-check) : une graine neuve à chaque passage,
 * affichée en cas d'échec ; FC_SEED la rejoue à l'identique.
 *
 *   FC_SEED=1234 npm test -- tests/front/theme.test.ts
 */
const seed = process.env.FC_SEED;

if (seed !== undefined && seed !== '') {
    fc.configureGlobal({ seed: Number(seed) });
}
