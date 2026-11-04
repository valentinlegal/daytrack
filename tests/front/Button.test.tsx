// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../../assets/components/Button';

// React vérifie que ses rendus de test passent par act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(element: React.ReactElement): HTMLButtonElement {
    const container = document.createElement('div');
    document.body.append(container);
    act(() => {
        createRoot(container).render(element);
    });

    const button = container.querySelector('button');

    if (button === null) {
        throw new Error('Aucun bouton rendu.');
    }

    return button;
}

describe('Button', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('n’envoie jamais un formulaire par mégarde', () => {
        const submit = vi.fn((event: SubmitEvent) => {
            event.preventDefault();
        });
        const form = document.createElement('form');
        form.addEventListener('submit', submit);
        document.body.append(form);

        const button = render(<Button>Enregistrer</Button>);
        form.append(button);
        button.click();

        expect(button.type).toBe('button');
        expect(submit).not.toHaveBeenCalled();
    });

    it.each(['primary', 'secondary', 'ghost', 'danger'] as const)('porte sa variante %s', (variant) => {
        const button = render(<Button variant={variant}>Libellé</Button>);

        expect(button.dataset.variant).toBe(variant);
    });

    it('prend la hauteur des fenêtres et des listes en petite taille', () => {
        const button = render(<Button size="sm">Annuler</Button>);

        expect(button.className).toContain('h-ctl-sm');
        expect(button.className).not.toMatch(/(^|\s)h-ctl(\s|$)/);
    });

    it('n’agit pas une fois désactivé', () => {
        const onClick = vi.fn();
        const button = render(
            <Button disabled onClick={onClick}>
                Envoyer sur Jira
            </Button>,
        );

        button.click();

        expect(onClick).not.toHaveBeenCalled();
    });

    it('garde le libellé accessible d’un bouton d’icône', () => {
        const button = render(<Button iconOnly variant="ghost" aria-label="Réglages" />);

        expect(button.getAttribute('aria-label')).toBe('Réglages');
        expect(button.className).toContain('w-ctl');
    });

    it('ne donne pas de marge à un bouton d’icône, qui écraserait l’icône', () => {
        const button = render(<Button iconOnly size="sm" aria-label="Ajouter un ticket" />);

        expect(button.className).toContain('w-ctl-sm');
        expect(button.className).not.toMatch(/(^|\s)px-/);
    });
});
