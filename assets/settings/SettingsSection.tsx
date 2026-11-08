import type { ReactNode } from 'react';

/**
 * Une section des réglages : son titre et son explication à gauche, sur --w-side-narrow,
 * puis sa carte, à --s-7.
 */
export function SettingsSection({
    id,
    title,
    explanation,
    children,
}: {
    /** L'identifiant du titre, qui nomme la section. */
    id: string;
    title: string;
    explanation?: string;
    children: ReactNode;
}) {
    return (
        <section aria-labelledby={id} className="settings-section grid gap-7 border-t border-line py-5">
            <div>
                <h2 id={id} className="mt-2 text-lg font-bold">
                    {title}
                </h2>
                {explanation !== undefined && <p className="mt-2 text-sm leading-(--lh) text-ink-2">{explanation}</p>}
            </div>
            {children}
        </section>
    );
}

/** La carte d'une section de réglages qui s'appliquent sans bouton : une ligne par réglage. */
export function SettingsCard({ children }: { children: ReactNode }) {
    return <div className="flex flex-col rounded-3 border border-line bg-bg-raise px-6 py-1">{children}</div>;
}

/**
 * Une ligne de la carte : libellé et aide à gauche, contrôle à droite ; ou, quand le
 * contrôle est large, l'un sous l'autre (stack).
 */
export function SettingsRow({
    stack = false,
    compact = false,
    children,
}: {
    stack?: boolean;
    compact?: boolean;
    children: ReactNode;
}) {
    return (
        <div
            className={`flex gap-6 border-line not-first:border-t ${compact ? 'py-3' : 'py-4'} ${
                stack ? 'flex-col items-start gap-3' : 'items-center justify-between'
            }`}
        >
            {children}
        </div>
    );
}

/** Le libellé d'une ligne, et son aide dessous. */
export function RowLabel({
    id,
    label,
    help,
    helpId,
    hidden = false,
}: {
    id?: string;
    label: string;
    help?: string;
    /** L'identifiant de l'aide, que le contrôle désigne (aria-describedby). */
    helpId?: string;
    hidden?: boolean;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            {/* Masqué au lecteur d'écran quand le contrôle porte déjà ce nom (le pas à pas). */}
            <span id={id} aria-hidden={hidden || undefined} className="text-md font-semibold text-ink">
                {label}
            </span>
            {help !== undefined && (
                <p id={helpId} className="text-sm leading-(--lh) text-ink-2">
                    {help}
                </p>
            )}
        </div>
    );
}
