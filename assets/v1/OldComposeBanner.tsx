import { useRef, useState } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { Button } from '../components/Button';
import { CopyCommandsButton, CopyCommandsStatus, useCopyCommands } from '../components/CopyCommands';
import { Popover } from '../components/Popover';
import { tokenPixels } from '../components/tokenPixels';

/** « -f » et « && » : une adresse qui ne répond pas ne remplace pas le fichier par une page d'erreur. */
const DOWNLOAD = 'curl -fO https://raw.githubusercontent.com/valentinlegal/daytrack/main/docker-compose.yml';

/** L'ancien fichier de la v1 : tel qu'elle le fournissait, ou changé par l'utilisateur. */
export type OldCompose = 'default' | 'custom';

/**
 * Un fichier changé ne relance pas DayTrack : ses ports et ses volumes se reportent entre
 * le remplacement et le redémarrage, sinon DayTrack repartirait vide, ou sur des ports pris.
 */
const COMMANDS: Record<OldCompose, string> = {
    default: `${DOWNLOAD} &&\ndocker compose up -d`,
    custom: `cp docker-compose.yml docker-compose.v1.yml &&\n${DOWNLOAD}`,
};

/**
 * Le docker-compose.yml de la v1 est encore là : DayTrack marche, mais répond à tout le
 * réseau, et le jeton Jira reste en clair dans ce fichier. L'application ne peut pas le
 * changer : il est hors de son conteneur. Le bandeau reste tant qu'il est là, et ne
 * bloque rien : qui met à jour retrouve ses journées sans geste.
 */
export function OldComposeBanner({ kind }: { kind: OldCompose }) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const laterRef = useRef<HTMLButtonElement>(null);
    const commands = COMMANDS[kind];
    const { copy, run, reset } = useCopyCommands(commands);

    const close = () => {
        reset();
        setOpen(false);
    };

    return (
        <>
            <AlertBanner
                action="Voir comment le remplacer"
                actionRef={buttonRef}
                expanded={open}
                detail="Il ouvre DayTrack au réseau, et votre jeton Jira peut y être en clair."
                onAction={() => {
                    setOpen((current) => !current);
                }}
            >
                Votre fichier docker-compose.yml date de la v1.
            </AlertBanner>
            <Popover
                open={open}
                anchor={buttonRef}
                side="bottom"
                align="end"
                overRecap
                sideOffset={tokenPixels('--s-2')}
                width="pop-md"
                title="Remplacer docker-compose.yml"
                onCancel={close}
                onOutside={close}
                initialFocus={laterRef}
                returnFocus={() => buttonRef.current?.focus()}
                footerEnd={
                    <>
                        <Button ref={laterRef} size="sm" onClick={close}>
                            Plus tard
                        </Button>
                        <CopyCommandsButton copy={copy} onCopy={run} />
                    </>
                }
            >
                <p className="text-sm text-ink-2">
                    {kind === 'default' ? (
                        <>
                            Lancez ces commandes dans le dossier de DayTrack, sur la machine qui l&apos;héberge.
                            Rechargez ensuite cette page.
                        </>
                    ) : (
                        <>
                            Votre fichier avait été modifié. Ces commandes en gardent une copie, docker-compose.v1.yml,
                            puis le remplacent. Lancez-les dans le dossier de DayTrack, sur la machine qui
                            l&apos;héberge.
                        </>
                    )}
                </p>
                <pre className="rounded-2 border border-line bg-bg-sel p-3 font-mono text-sm break-all whitespace-pre-wrap text-ink select-all">
                    {commands}
                </pre>
                <CopyCommandsStatus copy={copy} />
                {kind === 'default' ? (
                    <p className="text-sm text-ink-2">
                        Vos journées, vos favoris et votre connexion à Jira sont déjà dans DayTrack&nbsp;: le nouveau
                        fichier n&apos;en a pas besoin.
                    </p>
                ) : (
                    <>
                        <p className="text-sm text-inc">
                            Reportez ensuite dans le nouveau fichier les noms de volumes que vous aviez changés&nbsp;:
                            sans eux, DayTrack repartirait vide. Faites de même pour les ports, en gardant 127.0.0.1
                            devant&nbsp;: sans lui, DayTrack s&apos;ouvrirait à tout le réseau.
                        </p>
                        <p className="text-sm text-ink-2">
                            Lancez enfin <code className="font-mono text-ink">docker compose up -d</code>. DayTrack ne
                            s&apos;ouvrira plus que sur la machine qui l&apos;héberge, à l&apos;adresse
                            https://localhost, suivie de votre port HTTPS s&apos;il n&apos;est pas 443. Supprimez alors
                            la copie, où votre jeton Jira peut être en clair.
                        </p>
                    </>
                )}
            </Popover>
        </>
    );
}
