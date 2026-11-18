// "Editions": the site rebuilds every 3 hours (see the cron in .github/workflows/deploy.yml).
// Edition names follow Sunny's clock (IST); times are shown in each reader's own timezone.

/** Scheduled build slots in UTC minutes past midnight (00:17 UTC = 5:47 am IST). */
export const SLOTS_UTC = Array.from({ length: 8 }, (_, h) => h * 180 + 17); // 00:17, 03:17 … 21:17 UTC

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
