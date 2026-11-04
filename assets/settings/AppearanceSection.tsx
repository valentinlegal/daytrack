import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { choosePreference, onPreferenceChange, storedPreference, type ThemePreference } from '../theme';
import { RowLabel, SettingsCard, SettingsRow, SettingsSection } from './SettingsSection';

const THEMES: readonly { readonly value: ThemePreference; readonly label: string }[] = [
    { value: 'light', label: 'Clair' },
    { value: 'dark', label: 'Sombre' },
    { value: 'system', label: 'Système' },
];

/** Les flèches d'un groupe de boutons radio : la précédente ou la suivante, en boucle. */
const STEPS: Partial<Record<string, -1 | 1>> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/**
 * La section Apparence : le thème, choisi pour ce navigateur et posé aussitôt. Un choix
 * fait dans un autre onglet s'y voit aussi.
 */
export function AppearanceSection() {
    const [preference, setPreference] = useState<ThemePreference>(() => storedPreference(window));
    useEffect(() => onPreferenceChange(window, setPreference), []);
    const optionsRef = useRef<(HTMLButtonElement | null)[]>([]);

    // Un groupe de boutons radio, au sens d'ARIA : on y entre sur le choix actif, et les
    // flèches choisissent en se déplaçant.
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const step = STEPS[event.key];
        if (step === undefined) {
            return;
        }
        event.preventDefault();
        const next = (index + step + THEMES.length) % THEMES.length;
        const theme = THEMES[next];
        if (theme !== undefined) {
            choosePreference(window, theme.value);
            optionsRef.current[next]?.focus();
        }
    };

    return (
        <SettingsSection
            id="reglages-apparence"
            title="Apparence"
            explanation="L'affichage de DayTrack sur ce navigateur."
        >
            <SettingsCard>
                <SettingsRow>
                    <RowLabel id="reglages-theme" label="Thème" />
                    <div
                        role="radiogroup"
                        aria-labelledby="reglages-theme"
                        className="inline-flex flex-none gap-1 rounded-2 border border-line-strong bg-bg-raise p-1"
                    >
                        {THEMES.map(({ value, label }, index) => (
                            <button
                                key={value}
                                ref={(node) => {
                                    optionsRef.current[index] = node;
                                }}
                                type="button"
                                role="radio"
                                aria-checked={preference === value}
                                tabIndex={preference === value ? 0 : -1}
                                className="h-ctl-sm cursor-pointer rounded-1 px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors not-aria-checked:hover:bg-bg-hover aria-checked:bg-btn aria-checked:font-semibold aria-checked:text-on-btn"
                                onClick={() => {
                                    choosePreference(window, value);
                                }}
                                onKeyDown={(event) => {
                                    onKeyDown(event, index);
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </SettingsRow>
            </SettingsCard>
        </SettingsSection>
    );
}
