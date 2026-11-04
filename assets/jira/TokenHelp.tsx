import { type ReactNode, useEffect, useId, useState } from 'react';

import { Button } from '../components/Button';
import { ExternalLink } from '../components/ExternalLink';
import { CheckIcon, CopyIcon, DisclosureIcon } from '../components/icons';
import { Tooltip } from '../components/Tooltip';

/** Les périmètres que l'aide fait cocher, dans l'ordre d'Atlassian. */
export const SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user'] as const;

/** Combien de temps « Copié » reste affiché à côté du périmètre copié. */
const COPIED_DURATION = 2000;

const API_TOKENS_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';
const ATLASSIAN_HELP =
    'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/';

/**
 * « Comment créer un jeton », sous le champ du jeton : un lien d'action qui déplie l'aide
 * juste en dessous de lui, comme un élément <details>, fermée au premier affichage. Elle
 * reste ouverte tant qu'on ne la referme pas : on fait l'aller-retour avec l'onglet
 * d'Atlassian sans la perdre.
 */
export function TokenHelp() {
    const [open, setOpen] = useState(false);
    const panelId = useId();

    return (
        <div className="-mt-1 flex flex-col items-start gap-2">
            <Button
                variant="link"
                className="text-ink-2"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => {
                    setOpen(!open);
                }}
            >
                <DisclosureIcon />
                Comment créer un jeton
            </Button>
            {open && (
                <div
                    id={panelId}
                    className="self-stretch rounded-2 border border-line bg-bg-side p-4 text-sm leading-(--lh) text-ink-2"
                >
                    <ol className="flex flex-col gap-3">
                        <Step number={1}>
                            <span>
                                Ouvrez <ExternalLink href={API_TOKENS_PAGE} label="la page des jetons d'API" /> de votre
                                compte Atlassian.
                            </span>
                        </Step>
                        <Step number={2}>
                            <span>
                                Choisissez «{'\u{a0}'}
                                <b className="font-semibold text-ink">Créer un jeton d'API avec périmètres</b>
                                {"\u{a0}», puis l'application Jira."}
                            </span>
                        </Step>
                        <Step number={3}>
                            <span>Cochez ces trois périmètres.</span>
                            <ScopeButtons />
                        </Step>
                        <Step number={4}>
                            <span>
                                {
                                    "Copiez le jeton créé et collez-le dans le champ Jeton d'API. Atlassian ne le montre qu'une fois."
                                }
                            </span>
                        </Step>
                    </ol>
                    <p className="mt-3 border-t border-line pt-3 text-ink-3">
                        {"La page d'Atlassian a changé\u{a0}? "}
                        <ExternalLink href={ATLASSIAN_HELP} label="Son aide" muted /> décrit la marche à suivre.
                    </p>
                </div>
            )}
        </div>
    );
}

/** Une étape de l'aide : son numéro dans un disque, puis ce qu'il faut faire. */
function Step({ number, children }: { number: number; children: ReactNode }) {
    return (
        <li className="token-step">
            <span
                aria-hidden="true"
                className="first-line-disc flex size-5 items-center justify-center rounded-pill border border-line-strong bg-bg-raise text-xs leading-(--lh) font-semibold text-ink-2"
            >
                {number}
            </span>
            {children}
        </li>
    );
}

/**
 * Un bouton par périmètre : un clic copie son nom, l'icône devient une coche et
 * « Copié » s'affiche à droite, deux secondes.
 */
function ScopeButtons() {
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        if (copied === null) {
            return;
        }
        const timer = window.setTimeout(() => {
            setCopied(null);
        }, COPIED_DURATION);

        return () => {
            window.clearTimeout(timer);
        };
    }, [copied]);

    return (
        <div className="flex flex-wrap gap-2">
            {SCOPES.map((scope) => {
                const button = (
                    <Button
                        size="sm"
                        aria-label={`Copier ${scope}`}
                        onClick={() => {
                            void navigator.clipboard.writeText(scope).then(
                                () => {
                                    setCopied(scope);
                                },
                                () => undefined,
                            );
                        }}
                    >
                        <span className="font-mono text-sm">{scope}</span>
                        {copied === scope ? (
                            <CheckIcon />
                        ) : (
                            <span className="flex text-ink-3">
                                <CopyIcon />
                            </span>
                        )}
                    </Button>
                );

                return (
                    <Tooltip key={scope} label="Copié" side="right" open={copied === scope}>
                        {button}
                    </Tooltip>
                );
            })}
            {/* L'infobulle se voit, ce message s'entend. */}
            <span role="status" className="sr-only">
                {copied === null ? '' : `${copied} copié`}
            </span>
        </div>
    );
}
