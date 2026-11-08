import { useEffect, useRef, useState } from 'react';

import { Button } from './Button';
import { CheckIcon, CopyIcon } from './icons';

const COPIED_DURATION = 2000;
const LAYER = 'col-start-1 row-start-1 inline-flex items-center justify-center gap-2';

export type CopyState = 'none' | 'copied' | 'refused';

/** Ce que le bouton copie, dit à l'écran : son libellé, sa confirmation, et le refus du navigateur. */
export interface CopyWording {
    readonly copy: string;
    readonly copied: string;
    readonly refused: string;
}

export const COMMANDS: CopyWording = {
    copy: 'Copier les commandes',
    copied: 'Commandes copiées',
    refused: 'Copie impossible\u{a0}: sélectionnez les commandes à la main.',
};

/** Des lignes à écrire dans un fichier, et non des commandes à lancer. */
export const LINES: CopyWording = {
    copy: 'Copier les lignes',
    copied: 'Lignes copiées',
    refused: 'Copie impossible\u{a0}: sélectionnez les lignes à la main.',
};

/**
 * Copier des commandes : « copiées » s'efface tout seul, deux secondes après la dernière
 * copie. Recopier pendant qu'il s'affiche relance les deux secondes. La minuterie se
 * relance dans la copie elle-même : laissée à un effet, l'ancienne pouvait s'éteindre
 * entre la copie et sa relance, et effacer « copiées » aussitôt.
 */
export function useCopyCommands(commands: string): {
    copy: CopyState;
    run: () => void;
    reset: () => void;
} {
    const [copy, setCopy] = useState<CopyState>('none');
    const timerRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        const timers = timerRef;

        return () => {
            window.clearTimeout(timers.current);
        };
    }, []);

    return {
        copy,
        run: () => {
            void copyToClipboard(commands).then((state) => {
                window.clearTimeout(timerRef.current);
                setCopy(state);
                if (state === 'copied') {
                    timerRef.current = window.setTimeout(() => {
                        setCopy('none');
                    }, COPIED_DURATION);
                }
            });
        },
        reset: () => {
            window.clearTimeout(timerRef.current);
            setCopy('none');
        },
    };
}

export function CopyCommandsButton({
    copy,
    onCopy,
    wording = COMMANDS,
}: {
    copy: CopyState;
    onCopy: () => void;
    wording?: CopyWording;
}) {
    return (
        <Button size="sm" variant="primary" onClick={onCopy}>
            {/* Les deux contenus occupent la même place, chacun centré : le bouton ne
                bouge pas sous le pointeur, et la coche reste contre son texte. */}
            <span className="grid">
                <span className={`${LAYER} ${copy === 'copied' ? 'invisible' : ''}`}>
                    <CopyIcon />
                    {wording.copy}
                </span>
                <span className={`${LAYER} ${copy === 'copied' ? '' : 'invisible'}`}>
                    <CheckIcon onPrimary />
                    {wording.copied}
                </span>
            </span>
        </Button>
    );
}

/** Une seule région, là dès l'ouverture : c'est ce qui se dit quand elle change. */
export function CopyCommandsStatus({ copy, wording = COMMANDS }: { copy: CopyState; wording?: CopyWording }) {
    return (
        <p aria-live="polite" className={copy === 'refused' ? 'text-sm text-inc' : 'sr-only'}>
            {copy === 'copied' ? wording.copied : copy === 'refused' ? wording.refused : ''}
        </p>
    );
}

/** Un navigateur peut refuser, et ne propose rien hors HTTPS : le texte reste là, à sélectionner. */
async function copyToClipboard(commands: string): Promise<CopyState> {
    try {
        await navigator.clipboard.writeText(commands);

        return 'copied';
    } catch {
        return 'refused';
    }
}
