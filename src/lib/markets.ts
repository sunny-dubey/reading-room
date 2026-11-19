// Markets strip: a build-time snapshot (not live) of the numbers that matter to this reader.
// Sources allow automated access: FRED (Federal Reserve Bank of St. Louis) CSV downloads and the
// CoinGecko public API. Last good values are cached in .cache/markets.json so an offline build still works.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DAY = 864e5;
export interface Point { t: number; v: number }
export interface Market {
    id: string; name: string; group: string; why: string; unit: 'pct' | 'yield' | 'usd' | 'inr' | 'index';
    source: string; sourceUrl: string; freq: 'daily' | 'monthly';
    points: Point[];              // oldest first (about 45 days, or 24 months for monthly series)
    last?: Point; prev?: Point;   // latest value and the one it's compared with (≈1 week back, or 1 month for monthly)
    change?: number;              // % change, or for yields the change in basis points
    ok: boolean;
}

type Def = Omit<Market, 'points' | 'ok' | 'last' | 'prev' | 'change'> & { load: () => Promise<Point[]> };
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; reading-room markets)' };
const get = async (url: string) => {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
};
const fred = (series: string, days = 60) => async (): Promise<Point[]> => {
    const csv = await (await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`)).text();
    const cutoff = Date.now() - days * DAY;
    return csv.trim().split('\n').slice(1).map(l => l.split(','))
        .map(([d, v]) => ({ t: +new Date(`${d}T00:00:00Z`), v: Number(v) }))
        .filter(p => Number.isFinite(p.v) && p.v > 0 && p.t >= cutoff);
};
const gecko = (coin: string) => async (): Promise<Point[]> => {
    const j: any = await (await get(`https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=usd&days=45&interval=daily`)).json();
    return (j.prices ?? []).map(([t, v]: [number, number]) => ({ t, v }));
};
const FRED = (id: string) => `https://fred.stlouisfed.org/series/${id}`;

const DEFS: Def[] = [
    { id: 'spx', name: 'S&P 500', group: 'US stocks', why: 'The broad US market', unit: 'index', source: 'FRED (S&P Dow Jones Indices)', sourceUrl: FRED('SP500'), freq: 'daily', load: fred('SP500') },
    { id: 'ndx', name: 'Nasdaq-100', group: 'US stocks', why: 'The tech bellwether', unit: 'index', source: 'FRED (Nasdaq)', sourceUrl: FRED('NASDAQ100'), freq: 'daily', load: fred('NASDAQ100') },
    { id: 'vix', name: 'VIX', group: 'Risk', why: "The market's fear gauge", unit: 'index', source: 'FRED (Cboe)', sourceUrl: FRED('VIXCLS'), freq: 'daily', load: fred('VIXCLS') },
    { id: 'us10y', name: 'US 10Y yield', group: 'Rates', why: 'The price of money; moves tech valuations and funding', unit: 'yield', source: 'FRED (US Treasury)', sourceUrl: FRED('DGS10'), freq: 'daily', load: fred('DGS10') },
    { id: 'in10y', name: 'India 10Y yield', group: 'Rates', why: 'The price of money at home', unit: 'yield', source: 'FRED (OECD)', sourceUrl: FRED('INDIRLTLT01STM'), freq: 'monthly', load: fred('INDIRLTLT01STM', 760) },
    { id: 'usdinr', name: 'USD/INR', group: 'Currencies', why: 'Dollar salaries, dollar cloud bills', unit: 'inr', source: 'FRED (Federal Reserve H.10)', sourceUrl: FRED('DEXINUS'), freq: 'daily', load: fred('DEXINUS') },
    { id: 'gold', name: 'Gold', group: 'Commodities', why: 'Where money hides when it is scared', unit: 'usd', source: 'CoinGecko (PAX Gold, 1 token = 1 oz)', sourceUrl: 'https://www.coingecko.com/en/coins/pax-gold', freq: 'daily', load: gecko('pax-gold') },
    { id: 'copper', name: 'Copper', group: 'Commodities', why: 'Growth signal; demand from data centres and grids', unit: 'usd', source: 'FRED (IMF, $/tonne)', sourceUrl: FRED('PCOPPUSDM'), freq: 'monthly', load: fred('PCOPPUSDM', 760) },
    { id: 'brent', name: 'Brent crude', group: 'Commodities', why: 'Inflation and the macro mood', unit: 'usd', source: 'FRED (EIA)', sourceUrl: FRED('DCOILBRENTEU'), freq: 'daily', load: fred('DCOILBRENTEU') },
    { id: 'btc', name: 'Bitcoin', group: 'Crypto', why: 'Risk appetite at the speculative end', unit: 'usd', source: 'CoinGecko', sourceUrl: 'https://www.coingecko.com/en/coins/bitcoin', freq: 'daily', load: gecko('bitcoin') },
];

/** Latest value vs the last value at least 7 days earlier (daily) or the previous month (monthly). */
function compare(points: Point[], freq: Market['freq'], unit: Market['unit']) {
    const last = points.at(-1);
    if (!last) return {};
    const prev = freq === 'monthly' ? points.at(-2) : [...points].reverse().find(p => p.t <= last.t - 7 * DAY + DAY / 2);
    if (!prev) return { last };
    const change = unit === 'yield' ? Math.round((last.v - prev.v) * 100) : (last.v / prev.v - 1) * 100;
    return { last, prev, change };
}

let cache: Promise<Market[]> | undefined;
export const getMarkets = () => (cache ??= build());
async function build(): Promise<Market[]> {
    const file = '.cache/markets.json';
    let prev: Record<string, Point[]> = {};
    try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
    const out = await Promise.all(DEFS.map(async ({ load, ...d }) => {
        let points: Point[] = [], ok = true;
        try { points = (await load()).sort((a, b) => a.t - b.t); if (!points.length) throw new Error('no data'); }
        catch (e) { ok = false; points = prev[d.id] ?? []; console.warn(`[markets] ${d.id}: ${(e as Error).message}; using the last good values`); }
        return { ...d, points, ok, ...compare(points, d.freq, d.unit) } as Market;
    }));
    try {
        await mkdir('.cache', { recursive: true });
        await writeFile(file, JSON.stringify(Object.fromEntries(out.filter(m => m.points.length).map(m => [m.id, m.points]))));
    } catch {}
    return out.filter(m => m.last);
}

/** "7,323.63", "5.10%", "$92.94", "₹94.24". */
export function fmtValue(m: Market, v = m.last!.v) {
    const n = (d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    if (m.unit === 'yield') return `${n(2)}%`;
    if (m.unit === 'inr') return `₹${n(2)}`;
    if (m.unit === 'usd') return `$${v >= 1000 ? n(0) : n(2)}`;
    return v >= 1000 ? n(0) : n(2);
}
/** "+1.2%", "−8 bp". */
export function fmtChange(m: Market) {
    if (m.change === undefined) return '';
    const sign = m.change > 0 ? '+' : m.change < 0 ? '−' : '±';
    const abs = Math.abs(m.change);
    return m.unit === 'yield' ? `${sign}${abs} bp` : `${sign}${abs.toFixed(abs >= 10 ? 0 : 1)}%`;
}
/** Sparkline path for the last `n` points. */
export function sparkPath(points: Point[], w: number, h: number, n = 10) {
    const pts = points.slice(-n);
    if (pts.length < 2) return '';
    const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    return pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * w).toFixed(1)} ${(h - 2 - ((p.v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
}
