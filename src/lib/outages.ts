// Incident lessons from public status pages, read at build time: what broke, the cause the provider
// stated, how long it took to fix, and the provider's own timeline. No AI: facts from the status pages only.
// Only incidents with a stated cause or a postmortem become case studies; the rest is a plain list.
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { XMLParser } from 'fast-xml-parser';
import { findPlaces, type Place } from './places';
import { getFeeds, type FeedItem } from './feeds';

export type Kind = 'cloud' | 'edge' | 'devtools' | 'ai' | 'comms';
export const KINDS: Record<Kind, string> = { cloud: 'Cloud', edge: 'Edge & CDN', devtools: 'Developer tools', ai: 'AI APIs', comms: 'Communication' };

export interface Update { at: number; status: string; text: string }
export interface Incident {
    id: string;
    provider: string;
    providerId: string;
    kind: Kind;
    title: string;
    url: string;
    start: number;
    end?: number;
    ongoing: boolean;
    updates: Update[];          // oldest first
    affected: string[];         // components named by the provider
    places: Place[];
    region: string;             // continent-level bucket for grouping
    severity: 'major' | 'minor';
    identifiedAfter?: number;   // ms from first update to "Identified"
    mitigatedAfter?: number;    // ms to "Monitoring"
    duration?: number;          // ms to "Resolved"
    timing: 'stated' | 'updates' | 'unknown'; // stated = the provider wrote the window; unknown = posted after the fact
    cause?: string;             // the provider's own sentence about the cause, when it gave one
    rca?: { title: string; url: string; source: string }; // investigation report, when published
}
interface Source { id: string; name: string; url: string; format: 'statuspage' | 'gcp' | 'aws'; kind: Kind }

const DAY = 864e5;
const WINDOW = 30 * DAY;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const txt = (x: any): string => (typeof x === 'string' ? x : x?.['#text'] ?? '');
const decode = (s: string) => s.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#xA;/g, '\n').replace(/&amp;/g, '&');
const strip = (s: string) => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const MAJOR = /\b(major outage|outage|unavailable|down|not loading|fail(ing|ures?)|cannot|unable to|inaccessible|disruption)\b/i;

function regionOf(places: Place[]): string {
    const p = places[0];
    if (!p) return 'Global or not stated';
    if (p.lon < -30) return p.lat > 13 ? 'North America' : 'Latin America';
    if (p.lon < 60) return p.lat > 35 ? 'Europe' : 'Middle East & Africa';
    return 'Asia-Pacific';
}

const TZ: Record<string, number> = { UTC: 0, GMT: 0, PST: -8, PDT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, EST: -5, EDT: -4, BST: 1, CET: 1, CEST: 2, EET: 2, EEST: 3, IST: 5.5, SGT: 8, JST: 9, KST: 9, AEST: 10, AEDT: 11 };

/** Statuspage update blocks: "<small>Nov <var>18</var>, <var>09:34</var> UTC</small><br><strong>Resolved</strong> - text". */
function statuspageUpdates(html: string, ref: Date): Update[] {
    const out: Update[] = [];
    // Some pages (Datadog) write "Nov  9, 20:35 UTC" without the <var> tags.
    const re = /<small>\s*([A-Z][a-z]{2})\s*(?:<var[^>]*>)?(\d{1,2})(?:<\/var>)?,\s*(?:<var[^>]*>)?(\d{1,2}:\d{2})(?:<\/var>)?\s*([A-Z]{2,5})\s*<\/small>\s*<br\s*\/?>\s*<strong>([^<]+)<\/strong>\s*-\s*([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(decode(html)))) {
        const mon = MONTHS.indexOf(m[1]);
        let year = ref.getUTCFullYear();
        if (mon > ref.getUTCMonth()) year--; // an update from December seen in January
        const [h, mi] = m[3].split(':').map(Number);
        const off = TZ[m[4]] ?? 0; // pages may report in their own time zone
        out.push({ at: Date.UTC(year, mon, Number(m[2]), h, mi) - off * 3600e3, status: m[5].trim(), text: strip(m[6]) });
    }
    return out.sort((a, b) => a.at - b.at);
}

async function fetchText(url: string) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; reading-room outage map)' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

/** The window the provider wrote in its own words ("between 09:40 UTC and 20:05 UTC"), anchored to the
 *  day of the first update. Status pages often post late, so this beats the first update's timestamp. */
function statedWindow(updates: Update[]): { start: number; end?: number } | undefined {
    const first = updates[0];
    if (!first) return;
    const T = String.raw`(\d{1,2}):(\d{2})\s*(?:UTC|GMT)?`;
    const anchor = (h: string, m: string) => {
        const d = new Date(first.at);
        let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +h, +m);
        if (t > first.at + 15 * 60e3) t -= DAY; // started the day before it was posted
        return t;
    };
    for (const u of updates) {
        if (!/UTC|GMT/.test(u.text)) continue;
        const w = u.text.match(new RegExp(String.raw`\b(?:between|from)\s+${T}\s*(?:to|and|until|-|–)\s*${T}`, 'i'));
        if (w) {
            const start = anchor(w[1], w[2]);
            let end = start - (start % DAY) + (+w[3] * 3600e3 + +w[4] * 60e3);
            if (end < start) end += DAY;
            if (end - start < 3 * DAY) return { start, end };
        }
        const b = u.text.match(new RegExp(String.raw`\b(?:began|started|starting|beginning|since|as of)\s+(?:at|around|approximately)?\s*${T}`, 'i'));
        if (b) return { start: anchor(b[1], b[2]) };
    }
}

/** The provider's own sentence about the cause, latest first (later updates are better informed). */
const CAUSE = /\b(caused by|root cause|due to (?:a|an)\b|triggered by|the result of|traced (?:it|this|the issue) to|resulted from|because (?:of )?(?:a|an)\b)/i;
// Sentences that only say a cause exists ("we have identified the root cause") don't count.
const VAGUE = { test: (x: string) => /due to (?:a|an) (?:issue|problem|incident)\b(?! with)/i.test(x)
    || (/root cause/i.test(x) && /identif|investigat|determin|working to|looking into|confirm/i.test(x)) };
function causeOf(updates: Update[]): string | undefined {
    for (const u of [...updates].reverse()) {
        const s = u.text.split(/(?<=[.!?])\s+/).find(x => CAUSE.test(x) && !VAGUE.test(x) && x.length > 50);
        if (s) return s.length > 260 ? s.slice(0, 257).replace(/\s+\S*$/, '') + '…' : s;
    }
}

function finish(i: Omit<Incident, 'ongoing' | 'region' | 'severity' | 'identifiedAfter' | 'mitigatedAfter' | 'duration' | 'timing' | 'cause'>, now: number): Incident {
    const at = (re: RegExp) => i.updates.find(u => re.test(u.status))?.at;
    let resolved = i.end ?? at(/^(resolved|postmortem)/i);
    const identified = at(/^identified/i), monitoring = at(/^monitoring/i);
    const all = `${i.title} ${i.updates.map(u => u.text).join(' ')}`;
    const stated = statedWindow(i.updates);
    let first = i.updates[0]?.at ?? i.start, timing: Incident['timing'] = 'updates';
    if (stated && stated.start <= first) { first = stated.start; timing = 'stated'; if (stated.end && (!resolved || stated.end <= resolved)) resolved = resolved ?? stated.end; }
    let duration = resolved ? (timing === 'stated' && stated?.end ? stated.end : resolved) - first : undefined;
    // One update, or "resolved" in the first post: it was written after the fact, so there's no real duration.
    const retro = i.updates.length < 2 || /^(resolved|postmortem)/i.test(i.updates[0]?.status ?? '') || duration === 0;
    if (retro && timing !== 'stated') { timing = 'unknown'; duration = undefined; }
    return {
        ...i,
        start: first,
        end: resolved,
        ongoing: !resolved && now - (i.updates.at(-1)?.at ?? i.start) < 3 * DAY,
        region: regionOf(i.places),
        severity: MAJOR.test(i.title) || /major outage/i.test(all) ? 'major' : 'minor',
        identifiedAfter: identified && timing !== 'unknown' ? identified - first : undefined,
        mitigatedAfter: monitoring && timing !== 'unknown' ? monitoring - first : undefined,
        duration,
        timing,
        cause: causeOf(i.updates),
    };
}

async function readSource(s: Source, now: number): Promise<Incident[]> {
    const x = parser.parse(await fetchText(s.url));
    const out: Incident[] = [];
    if (s.format === 'statuspage') {
        for (const e of arr<any>(x.feed?.entry)) {
            const html = txt(e.content);
            const ref = new Date(e.updated ?? e.published ?? now);
            let updates = statuspageUpdates(html, ref);
            const title = strip(txt(e.title));
            // incident.io pages (OpenAI, Fly.io): only the latest status, so: opened at "published", closed at "updated".
            let components: string[] = [];
            const io = decode(html).match(/Status:\s*([A-Za-z ]+?)\s*<\/b>/i);
            if (!updates.length && io) {
                const opened = +new Date(e.published ?? e.updated), last = +new Date(e.updated ?? e.published);
                const body = strip(decode(html).replace(/<b>Affected components[\s\S]*$/i, '').replace(/<b>Status:[^<]*<\/b>/i, ''));
                updates = [{ at: opened, status: 'Investigating', text: title }];
                if (/resolved/i.test(io[1])) updates.push({ at: last, status: 'Resolved', text: body });
                else if (last > opened) updates.push({ at: last, status: io[1].trim(), text: body });
                components = [...decode(html).matchAll(/<li>([^<]+?)\s*\([^)]*\)\s*<\/li>/g)].map(m => m[1].trim());
            }
            // Skip planned maintenance (Cloudflare lists every datacentre's maintenance window).
            // Security advisories aren't outages.
            if (!updates.length || updates.some(u => /^(scheduled|in progress|verifying|completed)$/i.test(u.status)) || /maintenance|security advisory|vulnerabilit/i.test(title)) continue;
            const start = updates[0].at;
            if (start > now || now - start > WINDOW) continue;
            const affected = components.length ? components : (decode(html).match(/This incident affected:\s*([^<]+)/i)?.[1] ?? '').split(/,\s*|\s+and\s+/).map(a => a.replace(/\.$/, '').trim()).filter(Boolean);
            const link = arr<any>(e.link).find(l => l['@_rel'] !== 'self')?.['@_href'] ?? s.url;
            out.push(finish({
                id: `${s.id}:${link.split('/').pop()}`, provider: s.name, providerId: s.id, kind: s.kind, title, url: link, start, updates, affected,
                places: findPlaces(`${title} ${affected.join(' ')} ${updates.map(u => u.text).join(' ')}`),
                rca: updates.some(u => /^postmortem/i.test(u.status)) ? { title: `${s.name} postmortem`, url: link, source: s.name } : undefined,
            }, now));
        }
    } else if (s.format === 'gcp') {
        const seen = new Set<string>();
        for (const e of arr<any>(x.feed?.entry)) {
            const link = arr<any>(e.link)[0]?.['@_href'] ?? s.url;
            if (seen.has(link)) continue;
            seen.add(link);
            const html = decode(txt(e.summary) || txt(e.content));
            const title = strip(txt(e.title)).replace(/^(RESOLVED|UPDATE|MITIGATED):\s*/i, '');
            const times = [...html.matchAll(/<strong>(\d{4}-\d{2}-\d{2} \d{2}:\d{2})<\/strong>/g)].map(m => m[1]);
            // Google reports US/Pacific times: UTC-7 in summer time, UTC-8 otherwise (close enough for a map).
            const toUtc = (t: string) => { const d = new Date(`${t.replace(' ', 'T')}:00Z`); const m = d.getUTCMonth(); return +d + ((m > 2 && m < 10) ? 7 : 8) * 3600e3; };
            const start = times[0] ? toUtc(times[0]) : +new Date(e.updated);
            if (start > now || now - start > WINDOW) continue;
            const end = /ended at/i.test(html) && times[1] ? toUtc(times[1]) : undefined;
            const report = /Incident Report/i.test(html);
            const updates: Update[] = [{ at: start, status: 'Began', text: title }];
            if (end) updates.push({ at: end, status: 'Resolved', text: report ? 'Google published a full incident report (summary, root cause, remediation).' : 'Incident ended.' });
            out.push(finish({
                id: `gcp:${link.split('/').pop()}`, provider: s.name, providerId: s.id, kind: s.kind, title, url: link, start, end, updates, affected: [],
                places: findPlaces(`${title} ${strip(html).slice(0, 1500)}`),
                rca: report ? { title: 'Google Cloud incident report', url: link, source: s.name } : undefined,
            }, now));
        }
    } else {
        // AWS: one RSS item per update; group by service-region, open at the first problem, close at "operating normally".
        const items = arr<any>(x.rss?.channel?.item).map(i => ({ key: String(txt(i.guid)).split('#').pop()!.split('_')[0], title: strip(txt(i.title)), text: strip(txt(i.description)), at: +new Date(i.pubDate) }))
            .filter(i => i.at <= now && now - i.at < WINDOW).sort((a, b) => a.at - b.at);
        const open = new Map<string, Incident>();
        for (const i of items) {
            const normal = /operating normally|resolved/i.test(i.title);
            const cur = open.get(i.key);
            if (cur) {
                cur.updates.push({ at: i.at, status: normal ? 'Resolved' : 'Update', text: i.text });
                if (normal) { out.push(finish({ ...cur, end: i.at }, now)); open.delete(i.key); }
            } else if (!normal) {
                open.set(i.key, {
                    id: `aws:${i.key}:${i.at}`, provider: s.name, providerId: s.id, kind: s.kind, title: `${i.title} (${i.key})`, url: 'https://health.aws.amazon.com/health/status',
                    start: i.at, updates: [{ at: i.at, status: 'Investigating', text: i.text }], affected: [i.key.replace(/-[a-z]{2}-[a-z]+-\d$/, '')],
                    places: findPlaces(`${i.key} ${i.text}`), ongoing: false, region: '', severity: 'minor', timing: 'updates',
                });
            }
        }
        for (const cur of open.values()) out.push(finish(cur, now));
    }
    return out;
}

/** Match an incident to a published postmortem: a monthly availability report for the incident's month,
 *  or a post from the same provider, within two weeks, that shares real words with the incident. */
const STOP = new Set(['with', 'from', 'that', 'this', 'have', 'been', 'some', 'users', 'issue', 'issues', 'incident', 'errors', 'error', 'elevated', 'degraded', 'service', 'services', 'affecting', 'performance', 'delays', 'investigating', 'resolved', 'update', 'about', 'their', 'were', 'will']);
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9][a-z0-9.-]{3,}/g) ?? []).filter(w => !STOP.has(w)));
function matchPostmortem(i: Incident, posts: FeedItem[]) {
    const name = i.provider.split(/[\s(]/)[0].toLowerCase();
    const mine = posts.filter(p => p.title.toLowerCase().includes(name) || p.feedTitle.toLowerCase().includes(name));
    const d = new Date(i.start);
    const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
    const monthly = mine.find(p => /availability report/i.test(p.title) && p.title.toLowerCase().includes(month) && p.title.includes(String(d.getUTCFullYear())));
    if (monthly) return monthly;
    const iw = words(`${i.title} ${i.affected.join(' ')} ${i.places.map(p => p.name).join(' ')} ${i.updates.map(u => u.text).join(' ').slice(0, 1500)}`);
    const scored = mine
        .filter(p => +p.date >= i.start - DAY && +p.date - i.start < 14 * DAY && !/availability report/i.test(p.title))
        .map(p => {
            const pw = words(`${p.title} ${(p.embedText ?? '').slice(0, 2000)}`);
            let shared = 0; for (const w of pw) if (iw.has(w) && !w.startsWith(name) && !/^(github|connection|connections|dashboard)$/.test(w)) shared++;
            return { p, shared };
        })
        .filter(x => x.shared >= 5)
        .sort((a, b) => b.shared - a.shared);
    return scored[0]?.p;
}

let cache: ReturnType<typeof build> | undefined;
export const getOutages = () => (cache ??= build());

async function build() {
    const now = Date.now();
    let sources: Source[] = [];
    try { sources = parse(await readFile('src/content/status-pages.yaml', 'utf8')) ?? []; } catch {}
    const status: { id: string; name: string; ok: boolean; count: number; error?: string }[] = [];
    const lists = await Promise.all(sources.map(async s => {
        try {
            const list = await readSource(s, now);
            status.push({ id: s.id, name: s.name, ok: true, count: list.length });
            return list;
        } catch (err) {
            status.push({ id: s.id, name: s.name, ok: false, count: 0, error: (err as Error).message });
            return [];
        }
    }));
    const incidents = lists.flat().sort((a, b) => b.start - a.start);

    // Investigation reports: the provider's own postmortem, else one published in the Postmortems track.
    const { items } = await getFeeds();
    const posts = items.filter(p => p.category === 'postmortems' || /post-?mortem|incident report|root cause|availability report/i.test(p.title));
    for (const i of incidents) {
        if (i.rca) continue;
        const p = matchPostmortem(i, posts);
        if (p) i.rca = { title: p.title, url: p.link, source: p.feedTitle };
    }

    // Case studies: resolved incidents you can learn from, i.e. a postmortem, or a stated cause with real impact.
    // Newer and bigger first; at most two per provider so one noisy status page can't fill the page.
    const lesson = (i: Incident) => !i.ongoing && (!!i.rca || (!!i.cause && (i.severity === 'major' || (i.duration ?? 0) >= 30 * 60e3)));
    const score = (i: Incident) => (i.rca ? 50 : 0) + (i.cause ? 20 : 0) + (i.severity === 'major' ? 10 : 0)
        + (i.kind === 'cloud' || i.kind === 'edge' ? 8 : i.kind === 'devtools' ? 4 : 0)
        + Math.min(10, (i.duration ?? 0) / 3600e3) + Math.min(4, i.updates.length / 2) - (now - i.start) / (3 * DAY);
    const perProvider = new Map<string, number>();
    const cases = incidents.filter(lesson).sort((a, b) => score(b) - score(a)).filter(i => {
        const n = perProvider.get(i.providerId) ?? 0;
        perProvider.set(i.providerId, n + 1);
        return n < 2;
    }).slice(0, 8);

    // Reliability over the window, per provider. Durations only where the timing is real.
    const median = (xs: number[]) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const reliability = [...new Set(incidents.map(i => i.providerId))].map(id => {
        const list = incidents.filter(i => i.providerId === id);
        const timed = list.filter(i => i.duration !== undefined).map(i => i.duration!);
        return {
            id, provider: list[0].provider, kind: list[0].kind, count: list.length,
            major: list.filter(i => i.severity === 'major').length,
            median: median(timed), longest: timed.length ? Math.max(...timed) : undefined, timed: timed.length,
            explained: list.filter(i => i.cause || i.rca).length,
        };
    }).sort((a, b) => b.major - a.major || b.count - a.count);

    return {
        now, incidents, cases, reliability, status: status.sort((a, b) => a.name.localeCompare(b.name)),
        stats: { ongoing: incidents.filter(i => i.ongoing).length, explained: incidents.filter(i => i.cause || i.rca).length },
    };
}

/** "4h 12m", "38 min", "2 days". */
export function fmtDuration(ms?: number) {
    if (ms === undefined || ms < 0) return '';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
    return `${Math.round(h / 24)} days`;
}
