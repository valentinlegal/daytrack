// @ts-check

/**
 * Aucune valeur visuelle en dur, du côté des classes de Tailwind. Son thème par défaut
 * est retiré, mais trois familles de classes portent leur valeur en elles-mêmes, et le
 * thème n'y peut rien : ESLint les refuse ici.
 *
 * - une valeur arbitraire : « w-[13px] » ;
 * - une propriété arbitraire : « [color:red] », « hover:[background:#f00] » ;
 * - une valeur nue sur une propriété visuelle : « opacity-45 », « border-2 »,
 *   « duration-300 », « z-10 ». Un token s'y passe entre parenthèses :
 *   « opacity-(--o-disabled) », « duration-(--dur-panel) ».
 *
 * Un compte n'est pas une valeur visuelle : « grid-cols-7 » passe. Un état non
 * plus : la variante d'un attribut, « data-[state=open]: » ou « aria-[sort=ascending]: »,
 * celle dont Radix a besoin, passe, comme celle d'un groupe nommé
 * (« group-data-[menu=open]/card: ») — sa classe, elle, reste vérifiée.
 */
// Le nom d'un groupe suit sa barre oblique, écrite \x2f : le sélecteur d'ESLint
// s'arrête à la première « / » de son expression.
const STATE = '(?:(?:group|peer)-)?(?:data|aria)-\\[[^\\]\\s]+\\](?:\\x2f[\\w-]+)?:';
const VARIANTS = `(?:[\\w-]+(?:\\x2f[\\w-]+)?:|${STATE})*`;

const PATTERNS = [
    {
        pattern: `(^|\\s)${VARIANTS}(?!${STATE})[a-z][\\w-]*-\\[`,
        message: 'Pas de valeur arbitraire Tailwind (« w-[13px] ») : passez par un token de tokens.css.',
    },
    {
        pattern: `(^|\\s)${VARIANTS}\\[[a-z-]+:`,
        message: 'Pas de propriété arbitraire Tailwind (« [color:red] ») : passez par un token de tokens.css.',
    },
    {
        pattern: `(^|\\s)${VARIANTS}-?(opacity|border(-[xytrbl])?|outline(-offset)?|ring(-offset)?|duration|delay|z|scale(-[xy])?|rotate|skew-[xy]|translate-[xy]|leading|tracking|blur|brightness|contrast|saturate)-\\d`,
        message: 'Pas de valeur nue Tailwind (« opacity-45 ») : passez par un token, « opacity-(--o-disabled) ».',
    },
];

/** @type {{ selector: string, message: string }[]} */
export const TAILWIND_RESTRICTIONS = PATTERNS.flatMap(({ pattern, message }) => [
    { selector: `Literal[value=/${pattern}/]`, message },
    { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
]);
