import { useRef, useState } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { Button } from '../components/Button';
import {
    COMMANDS,
    CopyCommandsButton,
    CopyCommandsStatus,
    type CopyWording,
    LINES,
    useCopyCommands,
} from '../components/CopyCommands';
import { Popover } from '../components/Popover';
import { tokenPixels } from '../components/tokenPixels';

/** « -f » et « && » : une adresse qui ne répond pas ne remplace pas le fichier par une page d'erreur. */
const DOWNLOAD = 'curl -fO https://raw.githubusercontent.com/valentinlegal/daytrack/main/docker-compose.yml';

/**
 * L'ancien fichier de la v1 : tel qu'elle le fournissait, changé par l'utilisateur, ou
 * servant DayTrack derrière son proxy.
 */
export type OldCompose = 'default' | 'custom' | 'proxy';

/** Ce que la fenêtre fait copier, et sous quel nom, selon le fichier. */
const KINDS: Record<
    OldCompose,
    {
        readonly title: string;
        readonly action: string;
        readonly detail: string;
        readonly copied: string;
        readonly wording: CopyWording;
    }
> = {
    default: {
        title: 'Remplacer docker-compose.yml',
        action: 'Voir comment le remplacer',
        detail: 'Il ouvre DayTrack au réseau, et votre jeton Jira peut y être en clair.',
        copied: `${DOWNLOAD} &&\ndocker compose up -d`,
        wording: COMMANDS,
    },
    /**
     * Un fichier changé ne relance pas DayTrack : ses ports et ses volumes se reportent entre
     * le remplacement et le redémarrage, sinon DayTrack repartirait vide, ou sur des ports pris.
     */
    custom: {
        title: 'Remplacer docker-compose.yml',
        action: 'Voir comment le remplacer',
        detail: 'Il ouvre DayTrack au réseau, et votre jeton Jira peut y être en clair.',
        copied: `cp docker-compose.yml docker-compose.v1.yml &&\n${DOWNLOAD}`,
        wording: COMMANDS,
    },
    /**
     * Derrière un proxy, le fichier se garde : le remplacer ferait perdre l'adresse du proxy.
     * Ce sont les deux lignes qu'il faut écrire exactement, la commande vient après. Un port
     * lié à 127.0.0.1 ou un proxy joint par un réseau Docker n'ouvrent pas DayTrack : le
     * bandeau dit « peut ».
     */
    proxy: {
        title: 'Adapter docker-compose.yml',
        action: "Voir comment l'adapter",
        detail: 'Il peut contenir votre jeton Jira en clair, et ouvrir DayTrack au réseau.',
        // Six espaces, comme les lignes sous « environment: » dans le fichier de la v1 :
        // collée sans eux, la seconde tomberait en colonne 0, et Docker refuserait le fichier.
        copied: '      SERVER_NAME: ":80"\n      TRUSTED_PROXIES: "private_ranges"',
        wording: LINES,
    },
};

const CODE = 'font-mono text-ink';

/**
 * Le docker-compose.yml de la v1 est encore là : DayTrack marche, mais peut répondre à tout
 * le réseau, et le jeton Jira rester en clair dans ce fichier. L'application ne peut pas le
 * changer : il est hors de son conteneur. Le bandeau reste tant qu'il est là, et ne bloque
 * rien : qui met à jour retrouve ses journées sans geste.
 */
export function OldComposeBanner({ kind }: { kind: OldCompose }) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const laterRef = useRef<HTMLButtonElement>(null);
    const { title, action, detail, copied, wording } = KINDS[kind];
    const { copy, run, reset } = useCopyCommands(copied);

    const close = () => {
        reset();
        setOpen(false);
    };

    return (
        <>
            <AlertBanner
                action={action}
                actionRef={buttonRef}
                expanded={open}
                detail={detail}
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
                title={title}
                onCancel={close}
                onOutside={close}
                initialFocus={laterRef}
                returnFocus={() => buttonRef.current?.focus()}
                footerEnd={
                    <>
                        <Button ref={laterRef} size="sm" onClick={close}>
                            Plus tard
                        </Button>
                        <CopyCommandsButton copy={copy} onCopy={run} wording={wording} />
                    </>
                }
            >
                {kind === 'default' && (
                    <p className="text-sm text-ink-2">
                        Lancez ces commandes dans le dossier de DayTrack, sur la machine qui l&apos;héberge. Rechargez
                        ensuite cette page.
                    </p>
                )}
                {kind === 'custom' && (
                    <p className="text-sm text-ink-2">
                        Votre fichier avait été modifié. Ces commandes en gardent une copie, docker-compose.v1.yml, puis
                        le remplacent. Lancez-les dans le dossier de DayTrack, sur la machine qui l&apos;héberge.
                    </p>
                )}
                {kind === 'proxy' && (
                    <p className="text-sm text-ink-2">
                        Votre fichier sert DayTrack derrière un proxy&nbsp;: gardez-le. Sous{' '}
                        <code className={CODE}>environment:</code>, remplacez toute la ligne{' '}
                        <code className={CODE}>SERVER_NAME</code>, espaces du début compris, par ces deux lignes.
                    </p>
                )}
                {/* Les commandes vont à la ligne n'importe où : l'adresse ne tient pas sur une
                    ligne. Les deux lignes du proxy tiennent, et se lisent mieux entières. */}
                <pre
                    className={`rounded-2 border border-line bg-bg-sel p-3 font-mono text-sm text-ink select-all ${
                        kind === 'proxy' ? 'whitespace-pre' : 'break-all whitespace-pre-wrap'
                    }`}
                >
                    {copied}
                </pre>
                <CopyCommandsStatus copy={copy} wording={wording} />
                {kind === 'default' && (
                    <p className="text-sm text-ink-2">
                        Vos journées, vos favoris et votre connexion à Jira sont déjà dans DayTrack&nbsp;: le nouveau
                        fichier n&apos;en a pas besoin.
                    </p>
                )}
                {kind === 'custom' && (
                    <>
                        <p className="text-sm text-inc">
                            Reportez ensuite dans le nouveau fichier les noms de volumes que vous aviez changés&nbsp;:
                            sans eux, DayTrack repartirait vide. Faites de même pour les ports, en gardant 127.0.0.1
                            devant&nbsp;: sans lui, DayTrack s&apos;ouvrirait à tout le réseau.
                        </p>
                        <p className="text-sm text-ink-2">
                            Lancez enfin <code className={CODE}>docker compose up -d</code>. DayTrack ne s&apos;ouvrira
                            plus que sur la machine qui l&apos;héberge, à l&apos;adresse https://localhost, suivie de
                            votre port HTTPS s&apos;il n&apos;est pas 443. Supprimez alors la copie, où votre jeton Jira
                            peut être en clair.
                        </p>
                    </>
                )}
                {kind === 'proxy' && (
                    <>
                        <p className="text-sm text-ink-2">
                            Retirez aussi les lignes <code className={CODE}>JIRA_…</code>&nbsp;: votre connexion à Jira
                            est déjà dans DayTrack, et votre jeton peut y être en clair.
                        </p>
                        <p className="text-sm text-inc">
                            Si votre fichier publie un port, mettez 127.0.0.1 devant, ou retirez ce port si votre proxy
                            joint DayTrack par un réseau Docker. Si votre proxy ouvre DayTrack au réseau, quiconque
                            l&apos;atteint agit en votre nom, jusque dans Jira.
                        </p>
                        <p className="text-sm text-ink-2">
                            Lancez ensuite <code className={CODE}>docker compose up -d</code> dans le dossier de
                            DayTrack, sur la machine qui l&apos;héberge, puis rechargez cette page. L&apos;adresse ne
                            change pas.
                        </p>
                    </>
                )}
            </Popover>
        </>
    );
}
