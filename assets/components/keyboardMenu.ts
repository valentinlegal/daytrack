/**
 * Le menu du clic droit demandé au clavier — la touche Menu, ou Maj+F10 —, pour la grille
 * comme pour les favoris : l'écran l'ouvre lui-même là où il le pose, sous le créneau ou la
 * carte qui a le curseur, comme si on l'y avait demandé à la souris.
 */
export function openMenuAt(target: Element, clientX: number, clientY: number): void {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }));
}

/**
 * Le clic droit que le navigateur envoie de lui-même après la touche Menu ou Maj+F10 : un
 * événement de pointeur sans pointeur. Le menu est déjà ouvert là où l'écran l'a posé
 * (openMenuAt), et celui-ci, posé ailleurs, est ignoré. Celui que l'écran envoie n'est pas
 * « de confiance ».
 */
export function fromKeyboard(event: MouseEvent): boolean {
    return event.isTrusted && event instanceof PointerEvent && event.pointerType === '';
}
