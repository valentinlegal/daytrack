/**
 * Le jour et l'heure de l'utilisateur, comme côté serveur (src/Day/UserCalendar.php).
 *
 * Ils se lisent dans le fuseau réglé pour DayTrack, pas dans celui du poste : la fin
 * prévue et la ligne « maintenant » disent alors la même heure que le serveur. Une
 * date ne se forme jamais par toISOString(), qui rend le jour de l'heure universelle :
 * à 00:30 à Paris, c'est encore la veille pour elle.
 */
export interface UserMoment {
    /** Le jour, « AAAA-MM-JJ ». */
    readonly date: string;
    /** L'heure, en minutes depuis minuit. */
    readonly minute: number;
}

/** Le jour et l'heure qu'il est dans un fuseau, à un instant donné. */
export function momentAt(instant: Date, timeZone: string): UserMoment {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes): string => {
        const value = parts.find((candidate) => candidate.type === type)?.value;
        if (value === undefined) {
            throw new RangeError(`L'heure de ${timeZone} n'a pas de ${type}.`);
        }

        return value;
    };

    return {
        date: `${part('year')}-${part('month')}-${part('day')}`,
        minute: Number(part('hour')) * 60 + Number(part('minute')),
    };
}

/** L'heure qu'il est sur la grille, en minutes depuis minuit, si `date` est aujourd'hui ; null sinon. */
export function minuteOn(date: string, moment: UserMoment): number | null {
    return moment.date === date ? moment.minute : null;
}
