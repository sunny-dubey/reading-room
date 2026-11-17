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
    signals: Signal[];
    embedText?: string;  // title + start of article, for topic matching
    skill?: import('./roadmap').SkillMatch; // closest Roadmap topic (build time)
    brief?: Brief;       // build-time summary (learning tracks only)
    content?: string;    // full feed HTML, used for summarising then dropped
    comments?: string;   // discussion link (Hacker News)
    points?: number;
    reddit?: {           // Reddit top-of-day
        sub: string;
        rank: number;        // position in the day's top list for its feed
        score?: number;      // votes (only with API credentials)
        comments?: number;
        self: boolean;       // text post rather than a link
    };
    post?: {             // social posts (Bluesky)
        author: string;
        handle: string;
        avatar?: string;
        likes: number;
        reposts: number;
        replies: number;
        score: number;
        embed?: { title: string; url: string };
    };
}

export type Signal = 'outage' | 'model' | 'migration' | 'security' | 'controversy';

export const CATEGORIES = [
    { id: 'systems', slug: 'systems', label: 'Distributed Systems & Databases', short: 'Systems & DBs', blurb: 'Consensus, replication, consistency, storage engines, Postgres internals' },
    { id: 'backend', slug: 'architecture', label: 'Scalability & Architecture', short: 'Architecture', blurb: 'Scaling systems, architectural design and trade-offs, reliability patterns, APIs' },
    { id: 'ai-eng', slug: 'ai-engineering', label: 'AI Engineering & Agents', short: 'AI Engineering', blurb: 'Agents, evals, RAG, tool use, LLMs in production' },
    { id: 'ml', slug: 'foundations', label: 'ML & LLM Foundations', short: 'ML Foundations', blurb: 'How transformers, training, fine-tuning and inference actually work' },
    { id: 'math', slug: 'math', label: 'Mathematics', short: 'Math', blurb: 'Discrete math, probability, linear algebra and the maths behind systems and ML' },
    { id: 'postmortems', slug: 'postmortems', label: 'Postmortems', short: 'Postmortems', blurb: 'Real failures, explained. The fastest way to learn how systems break' },
] as const;
export const PULSE = { id: 'pulse', slug: 'pulse', label: 'Pulse', short: 'Pulse', blurb: "The week's headlines, in one short page" };
export const STARTUPS = { id: 'startups', slug: 'startups', label: 'Startups', short: 'Startups', blurb: 'What the best new companies are building' };
/** Side pages that aren't learning tracks: no summaries, not on Today. */
export const SIDE = new Set(['pulse', 'startups']);
export const categoryLabel = (id: string) => CATEGORIES.find(c => c.id === id)?.label ?? (id === 'pulse' ? PULSE.label : id === 'startups' ? STARTUPS.label : id);
export const categoryShort = (id: string) => CATEGORIES.find(c => c.id === id)?.short ?? (id === 'pulse' ? PULSE.short : id);

export const SIGNALS: { id: Signal; label: string; hint: string }[] = [
    { id: 'outage', label: 'Outages', hint: 'Incidents, downtime, post-mortems' },
    { id: 'model', label: 'New models', hint: 'Model and open-weights releases' },
    { id: 'migration', label: 'Migrations', hint: 'Moves, rewrites, deprecations, shutdowns' },
    { id: 'security', label: 'Security', hint: 'Breaches, CVEs, exploits, malware' },
    { id: 'controversy', label: 'Controversy', hint: 'Backlash, lawsuits, layoffs, bans' },
];

// Keyword rules, checked against the title (strong) and summary (weak).
const RULES: Record<Signal, RegExp> = {
    outage: /\b(outages?|downtime|went down|is down|goes down|degraded|disruptions? (with|to|of)|elevated errors?|error rates?|service interruption|post-?mortem|unable to|failing)\b/i,
    model: /\b(gpt-?\d[\w.-]*|o[1-9](-mini|-pro)?|claude (opus|sonnet|haiku|fable)( [\d.]+)?|claude [\d.]+|gemini [\d.]+[\w ]*|gemma ?\d+|llama ?\d[\d.]*|mistral (large|medium|small)|mixtral|codestral|qwen ?\d[\d.]*|deepseek[- ]?(v|r)\d+|grok ?\d[\d.]*|phi-?\d|kimi k\d|new (ai |language |reasoning )?models?|open[- ]weights?( models?)?|frontier models?|model release)\b/i,
    migration: /\b(migrat\w*|deprecat\w*|sunset(s|ting)?|end[- ]of[- ]life|shutting down|shuts down|moves? (off|away from)|moving (off|away from)|switch(ed|es|ing)? (from|away)|rewr(ite|itten|ote) in|ditch(es|ed|ing)?)\b/i,
    security: /\b(breach(es|ed)?|hack(ed|ers?)?|vulnerabilit(y|ies)|cve-\d{4}-\d+|zero-days?|0-day|ransomware|exploit(ed|s)?|data leak|leaked|malware|compromised|supply[- ]chain attack|backdoor|(cyber)?security incident)\b/i,
    controversy: /\b(lawsuits?|sues|sued|antitrust|fined|backlash|outrage|layoffs?|lays off|laid off|resigns?|ousted|banned|bans|probe|whistleblower)\b/i,
};

function detectSignals(title: string, category: string): Signal[] {
    // Status pages: every item is an incident, nothing else applies.
    if (category === 'status') return ['outage'];
    const found = (Object.entries(RULES) as [Signal, RegExp][]).filter(([, re]) => re.test(title)).map(([sig]) => sig);
    // A "security incident" is not an outage.
    return found.includes('security') ? found.filter(s => s !== 'outage') : found;
}

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

type Parsed = Omit<FeedItem, 'feedId' | 'feedTitle' | 'category' | 'signals'>;

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

// ---------- Bluesky: public API, no auth. Gives engagement counts and skips replies. ----------
async function loadBluesky(handle: string, limit: number, cutoff: number, minLikes: number): Promise<Omit<FeedItem, 'feedId' | 'feedTitle' | 'category' | 'signals'>[]> {
    const api = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&filter=posts_no_replies&limit=50`;
    const res = await fetch(api, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { feed } = await res.json() as { feed: any[] };
    return feed
        .filter(f => !f.reason) // skip reposts of other people
        .map(({ post: p }) => {
            const text = String(p.record?.text ?? '').trim();
            const ext = p.embed?.external ?? p.embed?.media?.external;
            const score = (p.likeCount ?? 0) + 2 * (p.repostCount ?? 0) + (p.replyCount ?? 0);
            return {
                title: text,
                link: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split('/').pop()}`,
                date: new Date(p.record?.createdAt ?? p.indexedAt),
                summary: '',
                post: {
                    author: p.author.displayName || p.author.handle,
                    handle: p.author.handle,
                    avatar: p.author.avatar,
                    likes: p.likeCount ?? 0, reposts: p.repostCount ?? 0, replies: p.replyCount ?? 0, score,
                    embed: ext?.uri ? { title: clean(ext.title || ext.uri, 140), url: ext.uri } : undefined,
                },
            };
        })
        .filter(i => i.title.length >= 40 && i.post.likes >= minLikes && +i.date >= cutoff)
        .sort((a, b) => b.post.score - a.post.score)
        .slice(0, limit);
}

// ---------- Reddit ----------
// With REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (a free "script" app at reddit.com/prefs/apps) we use the
// official API and get vote counts. Without them we fall back to the public top-of-day RSS (rank only),
// which Reddit often rate-limits. Requests are made one at a time either way.
type RedditItem = Omit<FeedItem, 'feedId' | 'feedTitle' | 'category' | 'signals'>;
const REDDIT_UA = 'web:reading-room:1.0 (personal reading page)';
let redditQueue: Promise<unknown> = Promise.resolve();
let redditToken: Promise<string | null> | undefined;

function redditCreds() {
    const id = process.env.REDDIT_CLIENT_ID ?? import.meta.env.REDDIT_CLIENT_ID;
    const secret = process.env.REDDIT_CLIENT_SECRET ?? import.meta.env.REDDIT_CLIENT_SECRET;
    return id && secret ? { id, secret } : null;
}

async function getRedditToken(): Promise<string | null> {
    const creds = redditCreds();
    if (!creds) return null;
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${creds.id}:${creds.secret}`).toString('base64'), 'User-Agent': REDDIT_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`reddit auth HTTP ${res.status}`);
    return (await res.json()).access_token ?? null;
}

async function loadReddit(subs: string, limit: number, perSub: number): Promise<RedditItem[]> {
    // Serialise all Reddit requests with a small gap to stay under rate limits.
    const run = redditQueue.then(async () => {
        const token = await (redditToken ??= getRedditToken());
        let items: RedditItem[];
        if (token) {
            const res = await fetch(`https://oauth.reddit.com/r/${subs}/top?t=day&limit=50&raw_json=1`, {
                headers: { Authorization: `Bearer ${token}`, 'User-Agent': REDDIT_UA }, signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const { data } = await res.json();
            items = data.children.map((c: any) => c.data)
                .filter((d: any) => !d.over_18 && !d.stickied)
                .map((d: any, n: number) => ({
                    title: clean(d.title, 300),
                    link: d.is_self ? `https://www.reddit.com${d.permalink}` : d.url,
                    date: new Date(d.created_utc * 1000),
                    summary: d.is_self ? clean(d.selftext ?? '', 240) : '',
                    comments: `https://www.reddit.com${d.permalink}`,
                    reddit: { sub: d.subreddit, rank: n + 1, score: d.score, comments: d.num_comments, self: !!d.is_self },
                }));
        } else {
            const res = await fetch(`https://www.reddit.com/r/${subs}/top/.rss?t=day&limit=50`, {
                headers: { 'User-Agent': REDDIT_UA }, signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) throw new Error(res.status === 429 ? 'rate limited by Reddit (add REDDIT_CLIENT_ID/SECRET for reliable access)' : `HTTP ${res.status}`);
            const doc = parser.parse(await res.text());
            items = arr(doc.feed?.entry).map((e: any, n: number) => {
                const html = decode(text(e.content));
                const linkHref = html.match(/<a href="([^"]+)">\[link\]<\/a>/)?.[1];
                const permalink = atomLink(arr(e.link));
                const self = !linkHref || linkHref.includes('reddit.com/r/');
                const body = html.split('submitted by')[0];
                return {
                    title: clean(text(e.title), 300),
                    link: self ? permalink : decode(linkHref!),
                    date: new Date(text(e.published) || text(e.updated)),
                    summary: self ? clean(body, 240) : '',
                    comments: permalink,
                    reddit: { sub: arr(e.category)[0]?.['@_term'] ?? '', rank: n + 1, self },
                };
            });
        }
        // At most `perSub` from any one subreddit so the big ones don't drown the rest.
        const perCount = new Map<string, number>();
        const out = items.filter(i => {
            const n = (perCount.get(i.reddit!.sub) ?? 0) + 1;
            perCount.set(i.reddit!.sub, n);
            return n <= perSub;
        }).slice(0, limit);
        out.forEach((i, n) => (i.reddit!.rank = n + 1));
        return out;
    });
    redditQueue = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, 1500)));
    return run;
}

async function load(): Promise<{ items: FeedItem[]; status: FeedStatus[]; fetchedAt: Date }> {
    const feeds = await getCollection('feeds');

    const results = await Promise.all(feeds.map(async ({ id, data }) => {
        const base: FeedStatus = { id, title: data.title, url: data.url, site: data.site, category: data.category, ok: false, count: 0 };
        const cutoff = Date.now() - data.maxAgeDays * 864e5;
        try {
            if (data.type === 'reddit') {
                const subs = data.url.match(/\/r\/([^/?#]+)/)?.[1];
                if (!subs) throw new Error('reddit url must look like https://www.reddit.com/r/a+b+c');
                const items = (await loadReddit(subs, data.limit, data.perSub))
                    .map(i => ({ ...i, feedId: id, feedTitle: data.title, category: data.category, signals: data.category === 'pulse' ? detectSignals(i.title, data.category) : [] }));
                return { status: { ...base, ok: true, count: items.length }, items };
            }
            if (data.type === 'bluesky') {
                const handle = data.url.split('/profile/')[1]?.replace(/\/.*$/, '');
                if (!handle) throw new Error('bluesky url must be https://bsky.app/profile/<handle>');
                const items = (await loadBluesky(handle, data.limit, cutoff, data.minLikes))
                    .map(i => ({ ...i, feedId: id, feedTitle: data.title, category: data.category, signals: data.category === 'pulse' ? detectSignals(i.title, data.category) : [] }));
                return { status: { ...base, ok: true, count: items.length }, items };
            }
            const res = await fetch(data.url, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { 'User-Agent': 'reading-room feed reader (+https://sunny-dubey.github.io/reading-room/)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const items = parseFeed(await res.text())
                .filter(i => i.link && i.title && !isNaN(+i.date) && +i.date >= cutoff && +i.date <= Date.now() + 864e5)
                .sort((a, b) => +b.date - +a.date)
                .slice(0, data.limit)
                .map(i => ({ ...i, feedId: id, feedTitle: data.title, category: data.category, signals: data.category === 'pulse' ? detectSignals(i.title, data.category) : [] }));
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
