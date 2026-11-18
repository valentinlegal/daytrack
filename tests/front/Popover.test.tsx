// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '../../assets/components/Button';
import { type Measurable, Popover } from '../../assets/components/Popover';

// React vérifie que ses rendus de test passent par act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Radix suit la taille de la fenêtre ; jsdom ne la mesure pas.
(globalThis as Partial<Pick<typeof globalThis, 'ResizeObserver'>>).ResizeObserver ??= class {
    observe(): void {
        // Rien ne change de taille.
    }
    unobserve(): void {
        // Rien n'est observé.
    }
    disconnect(): void {
        // Rien n'est observé.
    }
};

function nothing(): void {
    // La fenêtre reste ouverte.
}

function open(): HTMLElement {
    const anchor = createRef<Measurable>();
    const container = document.createElement('div');
    document.body.append(container);
    act(() => {
        createRoot(container).render(
            <Popover
                open
                anchor={anchor}
                side="top"
                title="Nouveau ticket"
                subtitle="Mardi 6 octobre de 15:15 à 15:30"
                onCancel={nothing}
                onOutside={nothing}
                footerStart={<Button size="sm">Pause</Button>}
                footerEnd={<Button size="sm">Enregistrer</Button>}
            >
                <label>
                    Ticket
                    <input />
                </label>
            </Popover>,
        );
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog === null) {
        throw new Error('Aucune fenêtre rendue.');
    }

    return dialog;
}

/**
 * Plus haute que la place, une fenêtre en prend toute la hauteur, celle que Radix mesure :
 * l'en-tête et le pied restent, seul le contenu défile, et la molette arrivée à son bout ne
 * fait pas défiler la grille dessous. Le défilement lui-même se joue dans Chromium
 * (tests/e2e/window-scroll.spec.ts) : jsdom ne mesure rien.
 */
describe('Popover', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('prend au plus la hauteur que Radix lui laisse, en colonne', () => {
        const dialog = open();

        expect(dialog.className).toContain('max-h-(--radix-popover-content-available-height)');
        expect(dialog.className).toContain('flex-col');
    });

    it('garde son en-tête et son pied, et fait défiler son contenu entre les deux', () => {
        const [header, body, footer] = [...open().children] as HTMLElement[];

        expect(header?.textContent).toContain('Nouveau ticket');
        expect(header?.className).toContain('flex-none');
        expect(body?.querySelector('input')).not.toBeNull();
        expect(body?.className.split(' ')).toEqual(
            expect.arrayContaining(['popover-body', 'min-h-0', 'flex-auto', 'overflow-y-auto', 'overscroll-contain']),
        );
        expect(footer?.textContent).toContain('Enregistrer');
        expect(footer?.className).toContain('flex-none');
    });
});
