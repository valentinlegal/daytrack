import { useEffect, useRef, useState } from 'react';
import { Download, ArrowRight } from 'lucide-react';
import { t } from '@/i18n/fr';
import type { VersionInfo } from '@/types/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { getVersionInfo, getVersionInfoCached } from '@/services/versionService';

const UPDATE_COMMAND = 'docker compose pull && docker compose up -d';

// Marge négative pour compenser le padding horizontal de l'<aside> parent (ps-2 pe-4)
// et faire porter la bordure sur toute la largeur du panneau, dans les deux états.
const FOOTER_WRAPPER_CLASS = 'shrink-0 -ms-2 -me-4 pt-3 border-t border-gray-200';

/** Préfixe "v" uniquement pour un semver reconnu ("develop"/"dev" en local restent tels quels. */
function formatVersion(version: string): string {
    return /^\d+\.\d+\.\d+$/.test(version) ? `v${version}` : version;
}

/**
 * Pied du panneau des favoris affichant la version courante de DayTrack, et signalant
 * qu'une nouvelle version est disponible sur le registre d'images le cas échéant.
 * Vérifie au chargement, puis au retour de focus de l'onglet (le cache côté service
 * limite les appels réseau réels).
 */
export default function VersionFooter() {
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [copied, setCopied] = useState(false);
    const [isTitleTruncated, setIsTitleTruncated] = useState(false);
    const titleRef = useRef<HTMLParagraphElement>(null);

    function checkTitleTruncation() {
        const el = titleRef.current;
        if (el) setIsTitleTruncated(el.scrollWidth > el.clientWidth);
    }

    // Re-vérification au retour de focus — throttlée par le cache sessionStorage (~1h)
    function checkVersionOnFocus() {
        getVersionInfoCached().then(setVersionInfo).catch(() => {
            // Vérification silencieuse — pas d'erreur intrusive pour l'utilisateur
        });
    }

    // Ref stable pour éviter de re-enregistrer le listener à chaque render (cf. CLAUDE.md).
    const checkVersionOnFocusRef = useRef(checkVersionOnFocus);
    checkVersionOnFocusRef.current = checkVersionOnFocus;

    useEffect(() => {
        // Toujours un appel frais au chargement — reflète immédiatement l'état réel
        // (ex : l'utilisateur vient de mettre à jour puis a rechargé la page).
        getVersionInfo().then(setVersionInfo).catch(() => {
            // Vérification silencieuse — pas d'erreur intrusive pour l'utilisateur
        });

        function onVisibilityChange() {
            if (document.visibilityState === 'visible') checkVersionOnFocusRef.current();
        }

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('focus', onVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('focus', onVisibilityChange);
        };
    }, []);

    if (!versionInfo) return null;

    if (!versionInfo.updateAvailable || null === versionInfo.latest) {
        return (
            <div className={FOOTER_WRAPPER_CLASS}>
                <p className="px-3 text-[10px] text-gray-400 font-mono">{formatVersion(versionInfo.current)}</p>
            </div>
        );
    }

    function handleCopy() {
        void navigator.clipboard.writeText(UPDATE_COMMAND);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        <div className={FOOTER_WRAPPER_CLASS}>
            <div className="px-3">
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="w-full flex items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left hover:bg-gray-50 transition-colors"
                        >
                            <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-md border border-gray-200">
                                <Download className="w-4 h-4 text-gray-700" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <p
                                            ref={titleRef}
                                            onMouseEnter={checkTitleTruncation}
                                            className="text-xs font-semibold text-gray-900 truncate"
                                        >
                                            {t('update.available')}
                                        </p>
                                    </TooltipTrigger>
                                    {isTitleTruncated && (
                                        <TooltipContent side="top">{t('update.available')}</TooltipContent>
                                    )}
                                </Tooltip>
                                <p className="text-[10px] text-gray-400 font-mono">
                                    {formatVersion(versionInfo.latest)}
                                </p>
                            </div>
                            <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" align="end" className="w-72 flex flex-col gap-2">
                        <p className="text-xs font-semibold text-gray-700">
                            {t('update.current_to_latest')
                                .replace('{current}', formatVersion(versionInfo.current))
                                .replace('{latest}', formatVersion(versionInfo.latest))}
                        </p>
                        <p className="text-xs text-gray-500">{t('update.how_to')}</p>
                        <code className="block rounded-md bg-neutral-100 px-2 py-1.5 text-[11px] font-mono break-all">
                            {UPDATE_COMMAND}
                        </code>
                        <Button
                            variant="outline"
                            size="sm"
                            className="self-start"
                            onClick={handleCopy}
                        >
                            {copied ? t('update.copied') : t('update.copy')}
                        </Button>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}
