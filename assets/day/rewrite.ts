/**
 * Récrit ce qui vient d'être tapé dans un champ sans déplacer le curseur, que React
 * mettrait sinon en fin de champ : le texte qui le précède, récrit, dit où il revient.
 */
export function rewrite(field: HTMLInputElement | HTMLTextAreaElement, rule: (text: string) => string): string {
    const text = rule(field.value);
    if (text !== field.value) {
        const caret = Math.min(
            rule(field.value.slice(0, field.selectionStart ?? field.value.length)).length,
            text.length,
        );
        field.value = text;
        field.setSelectionRange(caret, caret);
    }

    return text;
}
