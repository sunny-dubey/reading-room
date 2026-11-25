// "Editions": four a day (cron '47 0,6,12,18 * * *' in .github/workflows/deploy.yml = 06:17, 12:17, 18:17,
// 00:17 IST), plus one on every push. Every news section carries only the last 24 hours (EDITION_WINDOW).
// Edition names follow Sunny's clock (IST); times are shown in each reader's own timezone.

const DAY = 864e5;
/** Every news section shows only what was published in the 24 hours before the build (Sunny, 2026-11-25). */
export const EDITION_WINDOW = DAY;
/** For sources that give a date without a time (CISA, endoflife.date): dated today or yesterday. */
export const DATE_ONLY_WINDOW = EDITION_WINDOW + DAY;
/** Hours between scheduled editions; the stale notice appears when an edition is clearly overdue. */
export const EDITION_EVERY_HOURS = 6;

/** Edition name for a build time, by the hour in IST (late or manual builds keep their window's name). */
export function editionName(d: Date): string {
    const h = Number(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })) % 24;
    if (h >= 5 && h < 11) return 'Morning';
    if (h >= 11 && h < 17) return 'Midday';
    if (h >= 17 && h < 23) return 'Evening';
    return 'Late';
}

/** Build-time fallback text in IST, replaced in the browser with the reader's timezone. */
export const istTime = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase() + ' IST';
export const istDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
