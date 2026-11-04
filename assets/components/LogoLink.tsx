import type { MouseEvent } from 'react';

import { Logo } from './icons';

/**
 * Le logo des barres : il mène à aujourd'hui, comme l'accueil d'un site. Un clic pour un
 * nouvel onglet reste au navigateur.
 */
export function LogoLink({ onOpen }: { onOpen: () => void }) {
    const onClick = (event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
            return;
        }
        event.preventDefault();
        onOpen();
    };

    return (
        <a href="/" aria-label="DayTrack, aller à aujourd'hui" className="flex rounded-1" onClick={onClick}>
            <Logo />
        </a>
    );
}
