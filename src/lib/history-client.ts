// Reading history in this browser: which pieces you opened and when. Private, never sent anywhere.
// Powers "read" dimming and spaced revisits ("you read this a week ago").
export interface Read { u: string; t: string; at: number }

const KEY = 'reading:history';
const OLD_KEY = 'reading:read'; // earlier format: just a list of links

export function getHistory(): Read[] {
    try {
        const h = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Read[] | null;
        if (h) return h;
        // Migrate the old link-only list (no timestamps, so it can't drive revisits).
        const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? '[]') as string[];
        const migrated = old.map(u => ({ u, t: '', at: 0 }));
        localStorage.setItem(KEY, JSON.stringify(migrated));
        localStorage.removeItem(OLD_KEY);
        return migrated;
    } catch { return []; }
}

export function recordRead(u: string, t: string) {
    const h = getHistory().filter(r => r.u !== u);
    h.push({ u, t: t.slice(0, 200), at: Date.now() });
    try { localStorage.setItem(KEY, JSON.stringify(h.slice(-3000))); } catch {}
}

/** Pieces read roughly a week and a month ago: the best moments to revisit. */
export function dueForRevisit(now = Date.now()) {
    const day = 864e5;
    const inWindow = (lo: number, hi: number) => getHistory()
        .filter(r => r.at && r.t && now - r.at >= lo * day && now - r.at <= hi * day)
        .sort((a, b) => b.at - a.at);
    return { week: inWindow(6, 10), month: inWindow(27, 35) };
}
