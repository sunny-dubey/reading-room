// What's coming in macro: central-bank decisions and the US inflation print, with where things stand now.
// FOMC and ECB dates are read from their official calendars at build time; RBI and US CPI dates are
// hand-kept in src/content/macro-calendar.yaml (BLS blocks automated access). Current values: FRED
// (Fed target, ECB deposit rate, US CPI) and the RBI's own homepage (repo rate). Cached in .cache/macro-calendar.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'yaml';

const DAY = 864e5;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; reading-room macro calendar)' };
const get = async (url: string) => {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface MacroEvent { id: string; who: string; what: string; start: number; end: number; now?: string; url: string; moves?: string; short?: string; signal?: string; kind?: string }

// One line for the front page: what the event is and what it moves.
const SHORT: Record<string, string> = {
    rbi: 'Moves loan and deposit rates (EMIs), bond yields and the rupee.',
    fomc: 'Moves Treasury yields and the dollar, and with them the rupee and stocks.',
    uscpi: 'A hot print makes Fed cuts less likely: yields and the dollar up, stocks down.',
    ecb: 'Moves euro bond yields and the euro, and through EUR/USD the dollar.',
};
// What each decision or print moves: the standard transmission, written once, not generated. Informative, not advice.
const MOVES: Record<string, string> = {
    rbi: 'Repo rate → bank loan and deposit rates (home-loan EMIs), India bond yields and the rupee; rate-sensitive stocks (banks, autos, real estate) react most.',
    fomc: 'Fed funds rate → US Treasury yields and the dollar, then global risk appetite; a stronger dollar pulls money out of emerging markets, the rupee included.',
    uscpi: 'Above expectations: Fed cuts look less likely, so yields and the dollar rise and stocks usually fall. Below: the reverse. The biggest scheduled data point for the Fed.',
    ecb: 'Deposit rate → euro-area bond yields (Bunds), the euro and bank margins; through EUR/USD it moves the dollar too.',
};

/** FOMC: "<year> FOMC Meetings" panels, each meeting a month + "27-28" (or "Jan/Feb 31-1"). Decision on the last day. */
async function fomc(): Promise<MacroEvent[]> {
    const s = await get('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm');
    const out: MacroEvent[] = [];
    const heads = [...s.matchAll(/(\d{4}) FOMC Meetings/g)];
    heads.forEach((h, k) => {
        const year = Number(h[1]);
        const seg = s.slice(h.index!, heads[k + 1]?.index ?? h.index! + 15000);
        for (const m of seg.matchAll(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g)) {
            const months = m[1].split('/').map(x => MONTHS.findIndex(M => M.startsWith(x.trim().slice(0, 3))));
            const d = m[2].match(/(\d{1,2})\s*-\s*(\d{1,2})/);
            if (!d || months[0] < 0) continue;
            const start = Date.UTC(year, months[0], +d[1]);
            const end = Date.UTC(year, months.at(-1)!, +d[2]);
            out.push({ id: `fomc-${start}`, who: 'Fed (FOMC)', what: 'Rate decision', start, end, url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' });
        }
    });
    return out;
}

/** ECB: monetary policy meetings (the decision is announced on the last day). */
async function ecb(): Promise<MacroEvent[]> {
    const t = (await get('https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html')).replace(/<[^>]+>/g, '\n');
    const days = [...t.matchAll(/(\d{2})\/(\d{2})\/(\d{4})\s*\n\s*Governing Council of the ECB: monetary policy meeting[^\n]*/g)]
        .map(m => ({ at: Date.UTC(+m[3], +m[2] - 1, +m[1]), day2: /Day 2|followed by/.test(m[0]) }));
    const out: MacroEvent[] = [];
    for (const d of days) {
        const prev = out.at(-1);
        if (prev && d.at - prev.end <= DAY) { prev.end = d.at; continue; }
        out.push({ id: `ecb-${d.at}`, who: 'ECB', what: 'Rate decision', start: d.at, end: d.at, url: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html' });
    }
    return out;
}

async function fred(series: string) {
    const csv = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`);
    return csv.trim().split('\n').slice(1).map(l => l.split(',')).map(([d, v]) => ({ d, v: Number(v) })).filter(p => p.v > 0 && Number.isFinite(p.v)); // blank months (e.g. the 2025 shutdown gap) read as 0
}

/** Year-on-year % for each month that has a value 12 months earlier (FRED has gaps). Newest last. */
function yoy(p: { d: string; v: number }[]) {
    const by = new Map(p.map(x => [x.d, x.v]));
    return p.flatMap(l => { const y = by.get(`${Number(l.d.slice(0, 4)) - 1}${l.d.slice(4)}`); return y ? [{ d: l.d, v: (l.v / y - 1) * 100 }] : []; });
}
const monthName = (d: string) => new Date(d).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fresh = (d: string, months: number) => Date.now() - +new Date(d) < months * 31 * DAY;

/** What the data says now, per event kind: computed from FRED, omitted when a series is missing or stale. */
async function signals(fedUpper?: number) {
    const out: Record<string, string> = {};
    const inflation = (series: string, key: string, target: string, maxAgeMonths: number) => fred(series).then(p => {
        const y = yoy(p); const l = y.at(-1); if (!l || !fresh(l.d, maxAgeMonths)) return;
        const d3 = new Date(l.d); d3.setUTCMonth(d3.getUTCMonth() - 3);
        const back = y.find(x => x.d === d3.toISOString().slice(0, 10)) ?? y.at(-4); // three months earlier
        const trend = back ? `, ${l.v > back.v + 0.15 ? 'up' : l.v < back.v - 0.15 ? 'down' : 'little changed'} from ${back.v.toFixed(1)}% in ${monthName(back.d).split(' ')[0]}` : '';
        out[key] = `Inflation ${l.v.toFixed(1)}% a year (${monthName(l.d)})${trend}; target ${target}.`;
    });
    await Promise.all([
        // Two-year Treasury vs the Fed's target midpoint: what bond markets price for the policy rate over the next couple of years.
        fedUpper ? fred('DGS2').then(p => {
            const l = p.at(-1); if (!l || !fresh(l.d, 1)) return;
            const mid = fedUpper - 0.125, gap = l.v - mid;
            const lean = gap <= -0.25 ? 'bond markets are pricing rate cuts over the next two years' : gap >= 0.25 ? 'bond markets are pricing rate hikes over the next two years' : 'bond markets see little change in rates';
            out.fomc = `2-year Treasury ${l.v.toFixed(2)}% vs target midpoint ${mid.toFixed(2)}%: ${lean}.`;
        }) : Promise.resolve(),
        inflation('CPIAUCSL', 'uscpi', '2% (the Fed targets it on PCE, a close cousin)', 4),
        inflation('CP0000EZ19M086NEST', 'ecb', '2%', 4),
        inflation('INDCPIALLMINMEI', 'rbi', '4% (band 2–6%)', 8),
    ].map(p => p.catch(e => console.warn(`[macro-calendar] signal: ${(e as Error).message}`))));
    return out;
}

async function current() {
    const out: Record<string, string> = {};
    const pct = (v: number) => `${v.toFixed(2)}%`;
    await Promise.all([
        fred('DFEDTARU').then(p => { const l = p.at(-1)!; const lo = l.v - 0.25; out.fed = `Target ${pct(lo)}–${pct(l.v)}`; out.fedUpper = String(l.v); }),
        fred('ECBDFR').then(p => { out.ecb = `Deposit rate ${pct(p.at(-1)!.v)}`; }),
        fred('CPIAUCSL').then(p => {
            // Latest month that has a value a year earlier (FRED has gaps, e.g. Oct 2025).
            const by = new Map(p.map(x => [x.d, x.v]));
            for (const l of [...p].reverse()) {
                const y = by.get(`${Number(l.d.slice(0, 4)) - 1}${l.d.slice(4)}`);
                if (!y) continue;
                const month = new Date(l.d).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
                out.uscpi = `Last: ${((l.v / y - 1) * 100).toFixed(1)}% a year (${month})`;
                break;
            }
        }),
        get('https://www.rbi.org.in/').then(h => {
            const m = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/Policy Repo Rate\s*:\s*([\d.]+)%/);
            if (m) out.rbi = `Repo rate ${m[1]}%`;
        }),
    ].map(p => p.catch(e => console.warn(`[macro-calendar] ${(e as Error).message}`))));
    return out;
}

let cache: Promise<MacroEvent[]> | undefined;
export const getMacroCalendar = () => (cache ??= build());
async function build(): Promise<MacroEvent[]> {
    const file = '.cache/macro-calendar.json';
    let prev: { events: Record<string, MacroEvent[]>; now: Record<string, string> } = { events: {}, now: {} };
    try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
    const events: Record<string, MacroEvent[]> = {};
    for (const [id, load] of [['fomc', fomc], ['ecb', ecb]] as const) {
        try { events[id] = await load(); if (!events[id].length) throw new Error('no dates found'); }
        catch (e) { console.warn(`[macro-calendar] ${id}: ${(e as Error).message}; using the last good dates`); events[id] = prev.events[id] ?? []; }
    }
    const hand = parse(await readFile('src/content/macro-calendar.yaml', 'utf8')) ?? {};
    const day = (d: string | Date) => +new Date(d);
    events.rbi = (hand.rbi ?? []).map((r: any) => ({ id: `rbi-${day(r.start)}`, who: 'RBI (MPC)', what: 'Rate decision', start: day(r.start), end: day(r.end), url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62422' }));
    events.uscpi = (hand.uscpi ?? []).map((c: any) => ({ id: `uscpi-${day(c.date)}`, who: 'US CPI', what: `Inflation for ${c.covers}`, start: day(c.date), end: day(c.date), url: 'https://www.bls.gov/cpi/' }));
    for (const k of ['rbi', 'uscpi']) {
        const last = Math.max(0, ...events[k].map(e => e.end));
        if (last < Date.now()) console.warn(`[macro-calendar] ${k}: every hand-kept date has passed; add next year's to src/content/macro-calendar.yaml`);
    }
    const now = { ...prev.now, ...(await current()) };
    // Signals: fresh ones replace cached ones; a cached signal older than 10 days is dropped rather than shown stale.
    const fresh10 = (prev as any).signalsAt && Date.now() - (prev as any).signalsAt < 10 * DAY;
    const got = await signals(now.fedUpper ? Number(now.fedUpper) : undefined);
    const sig: Record<string, string> = { ...(fresh10 ? (prev as any).signals ?? {} : {}), ...got };
    try { await mkdir('.cache', { recursive: true }); await writeFile(file, JSON.stringify({ events: { fomc: events.fomc, ecb: events.ecb }, now, signals: sig, signalsAt: Object.keys(got).length ? Date.now() : (prev as any).signalsAt })); } catch {}
    const label: Record<string, string | undefined> = { fomc: now.fed, ecb: now.ecb, rbi: now.rbi, uscpi: now.uscpi };
    return Object.entries(events).flatMap(([k, list]) => list.map(e => ({ ...e, kind: k, now: label[k], moves: MOVES[k], short: SHORT[k], signal: sig[k] }))).sort((a, b) => a.end - b.end);
}

/** The next n events still ahead (the decision day not yet past), from the edition's time. */
export const upcoming = (all: MacroEvent[], now: number, n = 6) => all.filter(e => e.end + DAY > now).slice(0, n);

/** "Dec 8–9", "Dec 10", "Jan 31–Feb 1". */
export function fmtDays(e: MacroEvent) {
    const f = (t: number, withMonth: boolean) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC' });
    if (e.start === e.end) return f(e.end, true);
    const sameMonth = new Date(e.start).getUTCMonth() === new Date(e.end).getUTCMonth();
    return sameMonth ? `${f(e.start, false)}–${f(e.end, true)}` : `${f(e.start, true)}–${f(e.end, true)}`;
}
