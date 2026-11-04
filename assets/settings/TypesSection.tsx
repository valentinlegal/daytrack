import { DropdownMenu } from 'radix-ui';
import type { FocusEvent, KeyboardEvent } from 'react';

import { Button } from '../components/Button';
import { ChevronDownIcon } from '../components/icons';
import { tokenPixels } from '../components/tokenPixels';
import { Unread } from './DaySection';
import type { IssueTypeSetting } from './settingsApi';
import type { EditorSnapshot, SettingsEditor } from './settingsEditor';
import { SettingsCard, SettingsError, SettingsRow, SettingsSection } from './SettingsSection';
import { isTint, type Tint, TINT_NAMES, TINTS } from './tints';

/** Combien de teintes par ligne dans la grille : les flèches haut et bas sautent d'une ligne. */
const PER_ROW = 4;

/** « de Story », « d'Epic » : la préposition s'élide devant une voyelle. */
export function of(name: string): string {
    return /^[aeiouàâäéèêëîïôöùûüœæ]/i.test(name) ? `d'${name}` : `de ${name}`;
}

/**
 * La section Types de ticket : les types des saisies et des favoris, du plus utilisé au
 * moins utilisé, chacun dans sa teinte, et le bouton qui la change.
 */
export function TypesSection({ editor, snapshot }: { editor: SettingsEditor; snapshot: EditorSnapshot }) {
    const types = snapshot.settings?.issueTypes ?? null;

    return (
        <SettingsSection
            id="reglages-types"
            title="Types de ticket"
            explanation="Les types et leurs noms viennent de votre Jira. Seuls ceux de vos saisies apparaissent."
        >
            <SettingsCard>
                {types === null ? (
                    snapshot.unread && <Unread />
                ) : types.length === 0 ? (
                    <p className="py-4 text-sm leading-(--lh) text-ink-3">Aucun type pour l'instant.</p>
                ) : (
                    types.map((type) => (
                        <SettingsRow key={type.id} compact>
                            <span
                                data-color={type.color}
                                className="inline-flex min-h-ctl-sm min-w-0 items-center rounded-1 border border-l-(length:--b-ty) border-ty-line border-l-ty-bar bg-ty-bg py-(--s-half) pr-3 pl-2 text-md leading-(--lh) font-semibold wrap-anywhere text-ty-id"
                            >
                                {type.name}
                            </span>
                            <TintMenu
                                type={type}
                                onChoose={(color) => {
                                    editor.recolor(type.id, color);
                                }}
                            />
                        </SettingsRow>
                    ))
                )}
                {snapshot.errors.types !== undefined && <SettingsError message={snapshot.errors.types} />}
            </SettingsCard>
        </SettingsSection>
    );
}

/**
 * Le bouton qui montre la teinte d'un type, et la grille des douze qu'il ouvre, quatre
 * par ligne, chacune avec son nom. Radix porte le menu ; les flèches y vont dans les
 * deux sens, comme dans la grille qu'on voit.
 */
function TintMenu({ type, onChoose }: { type: IssueTypeSetting; onChoose: (color: Tint) => void }) {
    return (
        // Sans voile : le reste de la page n'est pas caché au lecteur d'écran pendant
        // qu'on choisit, et un clic à côté ferme la grille sans rien choisir. Elle se pose
        // dans sa section, sans portail, pour que le lecteur d'écran la trouve dans un repère.
        <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
                <Button
                    size="sm"
                    aria-label={`Teinte ${of(type.name)}, ${TINT_NAMES[type.color].toLowerCase()}`}
                    className="tint-button flex-none justify-start pr-2 pl-3 aria-expanded:border-focus aria-expanded:ring aria-expanded:ring-focus"
                >
                    <i aria-hidden="true" data-color={type.color} className="size-3 flex-none rounded-1 bg-ty-bar" />
                    {TINT_NAMES[type.color]}
                    <span className="ml-auto flex text-ink-3">
                        <ChevronDownIcon />
                    </span>
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
                aria-label={`Teinte ${of(type.name)}`}
                side="bottom"
                align="end"
                sideOffset={tokenPixels('--s-3')}
                collisionPadding={tokenPixels('--s-2')}
                onKeyDownCapture={moveInGrid}
                onFocus={focusChosen}
                className="z-(--z-pop) w-menu rounded-2 border border-line bg-bg-raise p-2 text-ink shadow-pop"
            >
                <DropdownMenu.RadioGroup
                    value={type.color}
                    onValueChange={(value) => {
                        if (isTint(value)) {
                            onChoose(value);
                        }
                    }}
                    className="grid grid-cols-4 gap-1"
                >
                    {TINTS.map((tint) => (
                        <DropdownMenu.RadioItem
                            key={tint}
                            value={tint}
                            data-color={tint}
                            className="group/tint flex cursor-pointer flex-col items-center gap-2 rounded-1 py-2 outline-none data-highlighted:bg-bg-hover"
                        >
                            <i aria-hidden="true" className="tint-swatch size-5 rounded-2 bg-ty-bar" />
                            <span className="text-xs text-ink-2 group-data-[state=checked]/tint:font-semibold group-data-[state=checked]/tint:text-ink">
                                {TINT_NAMES[tint]}
                            </span>
                        </DropdownMenu.RadioItem>
                    ))}
                </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    );
}

/**
 * La grille s'ouvre sur la teinte choisie, comme une liste déroulante, à la souris comme
 * au clavier : Radix poserait le curseur sur la première, ou nulle part.
 */
function focusChosen(event: FocusEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) {
        return;
    }
    const chosen = event.currentTarget.querySelector<HTMLElement>('[role="menuitemradio"][data-state="checked"]');
    if (chosen !== null) {
        event.preventDefault();
        chosen.focus();
    }
}

/**
 * Les flèches dans la grille : gauche et droite d'une teinte, haut et bas d'une ligne,
 * sans sortir de la grille. Radix ne connaît qu'une colonne : la grille prend les
 * flèches avant lui.
 */
function moveInGrid(event: KeyboardEvent<HTMLDivElement>): void {
    const steps: Partial<Record<string, number>> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -PER_ROW,
        ArrowDown: PER_ROW,
    };
    const step = steps[event.key];
    if (step === undefined) {
        return;
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const from = items.findIndex((item) => item === document.activeElement);
    const to = from === -1 ? 0 : from + step;
    event.preventDefault();
    event.stopPropagation();
    items[to < 0 || to >= items.length ? from : to]?.focus();
}
