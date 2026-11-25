import { getCollection } from 'astro:content';
import { XMLParser } from 'fast-xml-parser';
import { makeBrief, mapLimit, type Brief } from './summarize';

export interface FeedItem {
    feedId: string;
    feedTitle: string;
    category: string;
    title: string;
    link: string;
    date: Date;
    summary: string;
    embedText?: string;  // title + start of article, for topic matching
    weight?: number;     // source-level ranking nudge from feeds.yaml
    movedFrom?: string;  // original desk when the article was moved to the desk its topic belongs to (roadmap.ts)
    skill?: import('./roadmap').SkillMatch; // closest Roadmap topic (build time)
    meta?: { description?: string; image?: string; thumb?: string }; // the article's own description and preview thumbnail
    classic?: { id: string; title: string; url: string; author: string; sim: number }; // closest Canon read (Old meets new)
    brief?: Brief;       // build-time summary (learning tracks only)
    content?: string;    // full feed HTML, used for summarising then dropped
    comments?: string;   // discussion link (Hacker News)
    points?: number;
}

export const CATEGORIES = [
    { id: 'research', slug: 'research', label: 'CS Research', short: 'Research', blurb: 'Algorithms, theory, performance and the papers behind tomorrow\'s systems' },
    { id: 'systems', slug: 'systems', label: 'Distributed Systems & Databases', short: 'Systems & DBs', blurb: 'Consensus, replication, consistency, storage engines, Postgres internals' },
    { id: 'backend', slug: 'architecture', label: 'System Design & Architecture', short: 'System Design', blurb: 'Designing systems at scale: architecture, trade-offs, reliability patterns, APIs' },
    { id: 'swe', slug: 'software-engineering', label: 'Software Engineering', short: 'Software Eng', blurb: 'The craft of building software: design, testing, debugging, performance, compilers, languages and tools' },
    { id: 'ai-eng', slug: 'ai-engineering', label: 'Agentic AI & AI Engineering', short: 'Agentic AI', blurb: 'Agents, evals, retrieval, tool use and LLMs in production' },
    { id: 'ml', slug: 'foundations', label: 'ML & LLM Foundations', short: 'ML Foundations', blurb: 'How transformers, training, fine-tuning and inference actually work' },
    { id: 'security', slug: 'security', label: 'Security', short: 'Security', blurb: 'How attacks work and how to build systems that survive them: web, crypto, cloud, detection' },
    { id: 'hft', slug: 'hft', label: 'HFT & Low-Latency Engineering', short: 'HFT tech', blurb: 'Trading systems where microseconds matter: CPU caches, kernel bypass, lock-free queues, exchanges and market microstructure' },
    { id: 'quant', slug: 'quant', label: 'Quantitative Finance', short: 'Quant', blurb: 'Markets as systems: probability, pricing, risk, microstructure and the engineering behind trading' },
    { id: 'macro', slug: 'macro', label: 'Macro & Markets', short: 'Macro', blurb: 'Central banks, inflation, growth, jobs and trade, from the data and the people who produce it' },
    { id: 'math', slug: 'math', label: 'Applied Mathematics', short: 'Applied Maths', blurb: 'Probability, optimisation, numerical methods and the maths behind systems, ML and markets' },
    { id: 'postmortems', slug: 'postmortems', label: 'Postmortems', short: 'Postmortems', blurb: 'Real failures, explained. The fastest way to learn how systems break' },
] as const;
export const PULSE = { id: 'pulse', slug: 'pulse', label: 'Pulse', short: 'Pulse', blurb: "The week's headlines, in one short page" };
export const STARTUPS = { id: 'startups', slug: 'startups', label: 'Startups', short: 'Startups', blurb: 'What the best new companies are building' };
/** Side pages that aren't learning tracks: no summaries, not on Today. */
export const SIDE = new Set(['pulse', 'startups']);
export const categoryLabel = (id: string) => CATEGORIES.find(c => c.id === id)?.label ?? (id === 'pulse' ? PULSE.label : id === 'startups' ? STARTUPS.label : id);
export const categoryShort = (id: string) => CATEGORIES.find(c => c.id === id)?.short ?? (id === 'pulse' ? PULSE.short : id);

export interface FeedStatus {
    id: string;
    title: string;
    url: string;
    site?: string;
    category: string;
    ok: boolean;
    count: number;
    error?: string;
}

const TIMEOUT_MS = 15_000;

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: name => ['item', 'entry', 'link'].includes(name),
});

const arr = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

const text = (x: unknown): string => {
    if (x == null) return '';
    if (typeof x === 'string' || typeof x === 'number') return String(x);
    if (typeof x === 'object' && '#text' in (x as any)) return String((x as any)['#text']);
    return '';
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s: string) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
        e[0] === '#'
            ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
            : ENTITIES[e.toLowerCase()] ?? m);

const clean = (html: string, max = 220) => {
    const s = decode(decode(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + '…' : s;
};

function atomLink(links: any[]): string {
    const alt = links.find(l => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate'));
    const l = alt ?? links[0];
    return typeof l === 'string' ? l : l?.['@_href'] ?? '';
}

type Parsed = Omit<FeedItem, 'feedId' | 'feedTitle' | 'category'> & { tags?: string[] };

function parseFeed(xml: string): Parsed[] {
    const doc = parser.parse(xml);
    if (doc.rss?.channel || doc['rdf:RDF']) {
        const items = arr(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
        return items.map((i: any) => {
            const raw = text(i.description) || text(i['content:encoded']);
            const base = {
                title: clean(text(i.title), 200),
                link: text(arr(i.link)[0]) || text(i.guid),
                date: new Date(text(i.pubDate) || text(i['dc:date'])),
                summary: clean(raw),
                content: text(i['content:encoded']) || raw,
                tags: arr(i.category).map((c: any) => text(c).trim()).filter(Boolean),
            };
            // lobste.rs: description is only a comments link.
            if (/^Comments$/.test(base.summary)) return { ...base, summary: '', comments: text(i.comments) || undefined };
            // hnrss: description is just "Article URL / Comments URL / Points" boilerplate.
            const hn = raw.match(/Comments URL:\s*<a href="([^"]+)"/) ?? raw.match(/Comments URL:\s*(\S+)/);
            if (hn) {
                const pts = raw.match(/Points:\s*(\d+)/);
                return { ...base, summary: '', comments: decode(hn[1]), points: pts ? Number(pts[1]) : undefined };
            }
            return base;
        });
    }
    if (doc.feed) {
        return arr(doc.feed.entry).map((e: any) => ({
            title: clean(text(e.title), 200),
            link: atomLink(arr(e.link)),
            date: new Date(text(e.published) || text(e.updated)),
            summary: clean(text(e.summary) || text(e.content)),
            content: text(e.content) || text(e.summary),
        }));
    }
    throw new Error('not an RSS or Atom feed');
}

async function load(): Promise<{ items: FeedItem[]; status: FeedStatus[]; fetchedAt: Date }> {
    const feeds = await getCollection('feeds');

    const results = await Promise.all(feeds.map(async ({ id, data }) => {
        const base: FeedStatus = { id, title: data.title, url: data.url, site: data.site, category: data.category, ok: false, count: 0 };
        const cutoff = Date.now() - data.maxAgeDays * 864e5;
        try {
            const res = await fetch(data.url, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { 'User-Agent': 'reading-room feed reader (+https://sunny-dubey.github.io/reading-room/)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const items = parseFeed(await res.text())
                .filter(i => i.link && i.title && !isNaN(+i.date) && +i.date >= cutoff && +i.date <= Date.now() + 864e5)
                .filter(i => !data.onlyTags || (i.tags ?? []).some(t => data.onlyTags!.includes(t)))
                .filter(i => !data.skipTitles || !new RegExp(data.skipTitles, 'i').test(i.title))
                .sort((a, b) => +b.date - +a.date)
                .slice(0, data.limit)
                .map(({ tags, ...i }) => ({ ...i, feedId: id, feedTitle: data.title, category: data.category, weight: data.weight }));
            return { status: { ...base, ok: true, count: items.length }, items };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.warn(`[feeds] ${id}: ${error}`);
            return { status: { ...base, error }, items: [] as FeedItem[] };
        }
    }));

    // Summarise learning items at build time (cached on disk), then drop raw HTML.
    // Drop duplicate links (the same post can appear in two feeds).
    const seenLinks = new Set<string>();
    const all = results.flatMap(r => r.items).filter(i => !seenLinks.has(i.link) && !!seenLinks.add(i.link));
    const learning = all.filter(i => !SIDE.has(i.category));
    const started = Date.now();
    await mapLimit(learning, 8, async i => {
        try {
            const b = await makeBrief(i);
            i.embedText = `${i.title}. ${b.text || i.summary}`.slice(0, 1400);
            delete b.text;
            i.brief = b;
        } catch (err) { console.warn(`[brief] ${i.link}: ${err}`); }
    });
    for (const i of all) delete i.content;
    console.log(`[brief] summarised ${learning.length} articles in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    return {
        items: all.sort((a, b) => +b.date - +a.date),
        status: results.map(r => r.status),
        fetchedAt: new Date(),
    };
}

// Fetch once per build, shared by every page that asks.
let cached: ReturnType<typeof load> | undefined;
export const getFeeds = () => (cached ??= load());
