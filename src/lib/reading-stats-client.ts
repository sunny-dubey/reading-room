// "Your reading" (streak, activity grid, 30-day stats) and the Sunday/Monday "Your week" recap.
// Everything comes from this browser: reading history + plan ticks. Nothing leaves the page.
import { getHistory } from './history-client';

interface ReadMap { topics: string[]; tracks: Record<string, string>; links: Record<string, [number, number, string]> }
const DAY = 864e5;
const ymd = (d: Date) => d.toLocaleDateString('en-CA');
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function readMap(): ReadMap {
    try { return JSON.parse(document.getElementById('read-map')?.textContent ?? ''); } catch { return { topics: [], tracks: {}, links: {} }; }
}

/** Days (yyyy-mm-dd) on which you ticked at least one plan step. */
function planDays(): Set<string> {
    const out = new Set<string>();
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i) ?? '';
            const m = k.match(/^plan:(\d{4}-\d{2}-\d{2})$/);
            if (m && JSON.parse(localStorage.getItem(k) ?? '[]').length) out.add(m[1]);
        }
    } catch {}
    return out;
}

export function mountReadingStats() {
    const map = readMap();
    const hist = getHistory();
    const plans = planDays();
    const now = Date.now();

    // Activity per day: reads + 1 if you followed the plan.
    const perDay = new Map<string, number>();
    for (const r of hist) { const d = ymd(new Date(r.at)); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
    for (const d of plans) perDay.set(d, (perDay.get(d) ?? 0) + 1);

    // Streak: consecutive active days ending today (or yesterday, if today hasn't started yet).
    let streak = 0;
    let cursor = new Date();
    if (!perDay.has(ymd(cursor))) cursor = new Date(now - DAY);
    while (perDay.has(ymd(cursor))) { streak++; cursor = new Date(+cursor - DAY); }

    const month = hist.filter(r => now - r.at < 30 * DAY);
    const topics = new Set(month.map(r => map.links[r.u]?.[1]).filter(i => i !== undefined && i >= 0));
    const tracks = new Set(month.map(r => map.links[r.u]?.[2]).filter(Boolean));
    // Numbers count up the first time they appear (unless the reader prefers less motion).
    const motion = matchMedia('(prefers-reduced-motion: no-preference)').matches;
    const set = (sel: string, v: number) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return;
        if (!motion || el.dataset.counted || v === 0) { el.textContent = String(v); return; }
        el.dataset.counted = '1';
        const t0 = performance.now(), dur = 700;
        const step = (t: number) => {
            const k = Math.min(1, (t - t0) / dur);
            el.textContent = String(Math.round(v * (1 - Math.pow(1 - k, 3))));
            if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };
    set('[data-rp-streak]', streak);
    set('[data-rp-month]', month.length);
    set('[data-rp-topics]', topics.size);
    set('[data-rp-tracks]', tracks.size);
    // The masthead ear: your streak, with a little flame once it's going.
    const ear = document.querySelector<HTMLElement>('[data-ear-streak]');
    if (ear && streak > 0) {
        ear.innerHTML = `${streak >= 2 ? '<svg class="flame" viewBox="0 0 12 14" aria-hidden="true"><path fill="currentColor" d="M6 0c.6 2.4 3.6 3.6 3.6 7.6A3.6 3.6 0 0 1 6 14a3.6 3.6 0 0 1-3.6-3.6c0-1.7 1-2.7 1.7-3.4.1 1 .6 1.7 1.3 2 0-2.4-.4-4.6.6-9z"/></svg>' : ''}${streak} ${streak === 1 ? 'day' : 'days'} in a row`;
    }

    // Grid: the last 18 weeks, one column per week (Monday on top), like a contribution graph.
    const grid = document.querySelector<HTMLElement>('[data-rp-grid]');
    if (grid) {
        const weeks = 18;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const mondayOffset = (today.getDay() + 6) % 7;
        const start = new Date(+today - (mondayOffset + (weeks - 1) * 7) * DAY);
        let html = '';
        for (let w = 0; w < weeks; w++) {
            html += '<span class="rp-col">';
            for (let d = 0; d < 7; d++) {
                const day = new Date(+start + (w * 7 + d) * DAY);
                if (+day > +today) { html += '<span class="rp-cell future"></span>'; continue; }
                const n = perDay.get(ymd(day)) ?? 0;
                const l = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
                html += `<span class="rp-cell" data-l="${l}" title="${day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${n ? `${n} ${n === 1 ? 'read' : 'reads'}` : 'nothing'}"></span>`;
            }
            html += '</span>';
        }
        grid.innerHTML = html;
    }

    const note = document.querySelector<HTMLElement>('[data-rp-note]');
    if (note && hist.length) {
        const byTrack = new Map<string, number>();
        for (const r of month) { const t = map.links[r.u]?.[2]; if (t) byTrack.set(t, (byTrack.get(t) ?? 0) + 1); }
        const top = [...byTrack.entries()].sort((a, b) => b[1] - a[1])[0];
        note.textContent = top ? `Most of your reading this month: ${map.tracks[top[0]] ?? top[0]}. Kept in this browser only.` : 'Kept in this browser only.';
    }

    mountYourWeek(map, hist, plans);
}

/** Sunday and Monday: a recap of the last 7 days. */
function mountYourWeek(map: ReadMap, hist: ReturnType<typeof getHistory>, plans: Set<string>) {
    const box = document.querySelector<HTMLElement>('[data-your-week]');
    if (!box) return;
    const now = new Date();
    const show = [0, 1].includes(now.getDay()) || new URLSearchParams(location.search).has('week');
    const weekKey = `week:dismissed:${ymd(new Date(+now - ((now.getDay() + 6) % 7) * DAY))}`;
    let dismissed = false;
    try { dismissed = localStorage.getItem(weekKey) === '1'; } catch {}
    const week = hist.filter(r => +now - r.at < 7 * DAY);
    if (!show || dismissed || !week.length) { box.hidden = true; return; }

    const minutes = week.reduce((a, r) => a + (map.links[r.u]?.[0] ?? 0), 0);
    const topicCount = new Map<string, number>();
    const trackCount = new Map<string, number>();
    for (const r of week) {
        const [, ti, tr] = map.links[r.u] ?? [0, -1, ''];
        if (ti >= 0) topicCount.set(map.topics[ti], (topicCount.get(map.topics[ti]) ?? 0) + 1);
        if (tr) trackCount.set(tr, (trackCount.get(tr) ?? 0) + 1);
    }
    const planCount = [...plans].filter(d => +now - +new Date(d) < 7 * DAY).length;
    const oldest = [...week].sort((a, b) => a.at - b.at)[0];
    const total = [...trackCount.values()].reduce((a, b) => a + b, 0);

    box.innerHTML = `
        <div class="wk-head"><span class="wk-label">Your week</span><button type="button" class="wk-close" aria-label="Hide until next week" data-wk-close>×</button></div>
        <p class="wk-big">${week.length} ${week.length === 1 ? 'read' : 'reads'}${minutes ? ` · about ${minutes >= 90 ? `${Math.round(minutes / 60)} hours` : `${minutes} min`}` : ''}${planCount ? ` · followed the plan on ${planCount} ${planCount === 1 ? 'day' : 'days'}` : ''}</p>
        ${total ? `<div class="wk-bar">${[...trackCount.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span data-cat="${esc(t)}" style="flex:${n}" title="${esc(map.tracks[t] ?? t)}: ${n}"></span>`).join('')}</div>
        <p class="wk-tracks">${[...trackCount.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span><span class="cat-dot" data-cat="${esc(t)}"></span>${esc(map.tracks[t] ?? t)} ${n}</span>`).join('')}</p>` : ''}
        ${topicCount.size ? `<p class="wk-topics"><span>Topics you moved forward</span>${[...topicCount.keys()].slice(0, 8).map(t => `<span class="concept">${esc(t)}</span>`).join('')}</p>` : ''}
        ${oldest ? `<p class="wk-revisit"><span>Before the week ends, revisit</span><a href="${esc(oldest.u)}" target="_blank" rel="noopener noreferrer">${esc(oldest.t || oldest.u)}</a></p>` : ''}`;
    box.hidden = false;
    box.querySelector('[data-wk-close]')?.addEventListener('click', () => {
        try { localStorage.setItem(weekKey, '1'); } catch {}
        box.hidden = true;
    });
}
