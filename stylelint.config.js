/**
 * Aucune valeur visuelle en dur : une couleur, une taille ou une durée passe par un token
 * de tokens.css, et seulement par lui. tokens.css est le seul fichier qui écrit des
 * valeurs.
 */
const STRICT_PROPERTIES = [
    '/color$/',
    'background',
    'fill',
    'stroke',
    'box-shadow',
    'text-shadow',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'opacity',
    'border-radius',
    '/^border(-(top|right|bottom|left))?(-width)?$/',
    '/^outline(-width|-offset)?$/',
    '/^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)/',
    '/^(min-|max-)?(width|height)$/',
    'z-index',
    '/^(transition|animation)(-duration|-delay)?$/',
];

export default {
    extends: ['stylelint-config-standard'],
    plugins: ['stylelint-declaration-strict-value'],
    rules: {
        // Les directives de Tailwind.
        'at-rule-no-unknown': [
            true,
            { ignoreAtRules: ['theme', 'utility', 'variant', 'custom-variant', 'apply', 'source', 'reference'] },
        ],
        'at-rule-no-deprecated': [true, { ignoreAtRules: ['apply'] }],
        'import-notation': 'string',
        // « --*: initial » retire le thème par défaut de Tailwind (app.css).
        'custom-property-pattern': [
            '^(\\*|[a-z][a-z0-9]*(-[a-z0-9]+)*)$',
            { message: 'Un token s’écrit en kebab-case.' },
        ],
        // Les tokens se groupent par famille, séparés d'une ligne vide.
        'custom-property-empty-line-before': null,
        'scale-unlimited/declaration-strict-value': [
            STRICT_PROPERTIES,
            {
                ignoreFunctions: false,
                ignoreValues: [
                    'inherit',
                    'initial',
                    'unset',
                    'currentcolor',
                    'transparent',
                    'none',
                    'auto',
                    '0',
                    '100%',
                    'solid',
                    'dashed',
                    'dotted',
                ],
                disableFix: true,
                message: 'Valeur en dur : passez par un token de tokens.css (« ${property}: ${value} »).',
            },
        ],
    },
    overrides: [
        {
            files: ['assets/styles/tokens.css'],
            rules: {
                'scale-unlimited/declaration-strict-value': null,
                // Les teintes sont groupées par quatre sur une ligne.
                'declaration-block-single-line-max-declarations': null,
                'color-hex-length': null,
                'alpha-value-notation': null,
                'color-function-notation': null,
                'color-function-alias-notation': null,
                'value-keyword-case': null,
                'custom-property-empty-line-before': null,
                'number-max-precision': null,
            },
        },
    ],
};
