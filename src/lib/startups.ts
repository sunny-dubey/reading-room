// Startups: the last 24 hours of startup news, sorted into what a reader asks about it. Funding rounds (round and
// amount read from the headline), deep tech, impact (climate, health, education, inclusion), other news, and
// hiring (new postings in Hacker News's monthly "Who is hiring?" thread, official API). Rule-based, no AI.
// Sources: feeds with category `startups` whose id starts su-news-, su-deep-, su-impact- (feeds.yaml), plus
// TechCrunch Startups; launches (Launch HN, Show HN, Product Hunt) stay in reading.ts. Same story across outlets once.
import { getFeeds, type FeedItem } from './feeds';
import { groupSame } from './bigstory';
import { EDITION_WINDOW } from './edition';
import { embed, cosine } from './embed';
import { approach, type Approach } from './skills';
import type { Topic } from './roadmap';

// A funding word is required (an amount alone isn't a round: "$215 million plan").
const FUNDING = /\b(rais(es|ed|ing)|funding|fundraise|series [a-h]|seed (round|funding)|pre-seed|pre-series [a-h]|valuation|valued at|unicorn|(secures?|bags?|lands?|closes?|nabs?|gets?) \S*\s?(?:US)?[$€£₹])/i;
const MONEY = /((?:US)?\$|€|£|₹|Rs\.?\s?)\s?(\d+(?:[.,]\d+)?)\s?(k|m|mn|million|b|bn|billion|crore|cr|lakh)?\b/i;
const ROUND = /\b(pre-seed|seed|pre-series [a-h]|series [a-h]\d?|growth round|bridge round|debt (round|financing)|ipo)\b/i;
const DEEP = /\b(quantum|qubits?|fusion|fission|nuclear|semiconductors?|chips?|chipmakers?|lithograph\w*|foundr(y|ies)|robot\w*|humanoids?|space|satellites?|orbit\w*|rockets?|launch vehicles?|biotech\w*|drug discovery|proteins?|genom\w*|gene therap\w*|crispr|batter(y|ies)|hydrogen|materials science|photonic\w*|lidar|autonomous (vehicles?|driving)|drones?|superconduct\w*|neuromorphic|brain[- ]computer)\b/i;
const IMPACT = /\b(climate|carbon|emissions?|decarboni[sz]\w*|clean (energy|tech)|solar|wind (power|farm)|grid|heat pumps?|water|agri\w*|farm\w*|food security|health\w*|patients?|medical|hospitals?|clinic\w*|diagnos\w*|education|edtech|students?|learning platform|accessib\w*|financial inclusion|inclusion|rural|poverty|disaster|wildfire|recycl\w*|circular economy|refugees?)\b/i;

export interface StartupStory { item: FeedItem; also: FeedItem[]; amount?: string; round?: string; deep: boolean; impact: boolean }
export interface HiringPost { company: string; line: string; url: string; at: number; remote: boolean; where: 'India' | 'Remote · worldwide' }

// Sunny's hiring rule (2026-11-25): India in any form (onsite, hybrid, remote), or remote open worldwide.
// Remote limited to a country or region elsewhere ("Remote (US only)", "within EST") doesn't count.
const INDIA = /\b(india|bangalore|bengaluru|mumbai|pune|hyderabad|delhi|new delhi|ncr|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad|kochi|jaipur|indore)\b/i;
const REMOTE = /\bremote\b/i;
const WORLDWIDE = /\b(worldwide|world-?wide|global(ly)?|anywhere|any (country|timezone|location)|apac|asia)\b/i;
const RESTRICTED = /\b(us|usa|u\.s\.?|united states|canada|uk|u\.k\.|eu|europe|european|emea|americas|north america|latam|germany|france|spain|netherlands|australia|nz|est|pst|cet|et|pt)\b[^|]{0,15}\b(only|based|timezones?|hours|residents?|citizens?)\b|\b(remote|us|eu|uk)[\s\-–—:,(]{0,4}(us|usa|u\.s\.|canada|uk|eu|europe|emea|americas|north america)\b(?![^|]*\b(worldwide|global|anywhere)\b)|\bwithin (the )?(us|eu|uk|est|pst)\b/i;
export const whereFits = (line: string): HiringPost['where'] | null =>
    INDIA.test(line) ? 'India' : REMOTE.test(line) && (WORLDWIDE.test(line) || !RESTRICTED.test(line)) ? 'Remote · worldwide' : null;

const source = (i: FeedItem) => i.feedId.startsWith('su-deep-') ? 'deep' : i.feedId.startsWith('su-impact-') ? 'impact' : 'news';

/** A startup worth approaching for an engineering role: the signal, why it fits, and how to reach out. */
export interface Target { key: string; name: string; kind: 'funding' | 'hiring' | 'launch'; signal: string; headline: string; url: string; topic?: string; sim: number; approach: Approach; ai: boolean }
type RoadmapLike = { topics: Map<string, Topic>; topicVec: Map<string, number[]> };

let memo: ReturnType<typeof build> | undefined;
/** Called first by reading.ts (with the Roadmap, for matching); pages then get the same result. */
export const getStartups = (now?: number, roadmap?: RoadmapLike) => (memo ??= build(now, roadmap));

async function build(nowArg?: number, roadmapArg?: RoadmapLike) {
    const { items, fetchedAt } = await getFeeds();
    const now = nowArg ?? +fetchedAt;
    const roadmap = roadmapArg ?? (await (await import('./reading')).getReading()).roadmap;
    const seen = new Set<string>();
    const pool = items
        .filter(i => (i.feedId.startsWith('su-') || i.feedId === 'tc-startups') && +i.date <= now && now - +i.date < EDITION_WINDOW)
        .sort((a, b) => +b.date - +a.date)
        .filter(i => { const k = i.link.replace(/[?#].*$/, ''); return !seen.has(k) && !!seen.add(k); });
    const vecs = pool.length ? await embed(pool.map(i => i.title)) : null;
    const groups = vecs ? groupSame(pool.map(i => i.title), pool.map(i => i.feedTitle), vecs, 0.6) : pool.map((_, k) => [k]);

    const stories: StartupStory[] = groups.map(ks => {
        const list = ks.map(k => pool[k]).sort((a, b) => +a.date - +b.date);
        const lead = list[0], text = list.map(i => i.title).join(' · ');
        const money = text.match(MONEY);
        const isFunding = FUNDING.test(lead.title) && (!!money || ROUND.test(text));
        return {
            item: lead, also: list.slice(1),
            amount: isFunding && money ? `${money[1].replace(/^US/, '').replace(/^Rs\.?\s?/, '₹')}${money[2]}${money[3] ? (/^(m|mn|million)$/i.test(money[3]) ? 'M' : /^(b|bn|billion)$/i.test(money[3]) ? 'B' : /^cr(ore)?$/i.test(money[3]) ? ' crore' : ` ${money[3]}`) : ''}` : undefined,
            round: isFunding ? text.match(ROUND)?.[0].replace(/\b\w/g, c => c.toUpperCase()) : undefined,
            deep: list.some(i => source(i) === 'deep') || DEEP.test(text),
            impact: list.some(i => source(i) === 'impact') || IMPACT.test(text),
        };
    });
    const funding = stories.filter(s => s.amount || s.round);
    const rest = stories.filter(s => !funding.includes(s));
    const deep = rest.filter(s => s.deep);
    const impact = rest.filter(s => s.impact && !s.deep);
    const news = rest.filter(s => !s.deep && !s.impact);
    const byNew = (a: StartupStory, b: StartupStory) => +b.item.date - +a.item.date;
    // Funding: the biggest first when the amount is in dollars; others by recency.
    const usd = (s: StartupStory) => { const m = s.amount?.match(/^\$(\d+(?:\.\d+)?)(M|B)?/); return m ? Number(m[1]) * (m[2] === 'B' ? 1000 : 1) : 0; };
    funding.sort((a, b) => usd(b) - usd(a) || byNew(a, b));
    const hiring = await hiringPosts(now).catch(e => { console.warn(`[startups] hiring: ${(e as Error).message}`); return { thread: undefined, posts: [] as HiringPost[], all: [] as HiringPost[], total: 0 }; });
    const targets = await worthApproaching(items, hiring.all, now, roadmap);
    return { now, funding, deep: deep.sort(byNew), impact: impact.sort(byNew), news: news.sort(byNew), hiring, targets, total: pool.length };
}

// ---------------------------------------------------------------- worth approaching (engineering careers)
const ENGINEERING = /\b(engineers?|developers?|sre|devops|platform|infrastructure|infra|backend|back-end|full[- ]?stack|systems|distributed|data engineer|ml engineer|ai engineer|software)\b/i;
const CAREER_TRACKS = new Set(['systems', 'backend', 'swe', 'ai-eng', 'hft', 'ml']);
// When the model can't write a note: what each signal means and how to act on it.
const PLAYBOOK: Record<Target['kind'], Approach> = {
    funding: { why: 'Fresh money usually means hiring engineers in the next one to three months, before the roles are posted.', mention: 'Find the CTO or first engineers (team page, GitHub, LinkedIn) and send five lines tied to something they shipped and one system you built that matches it.' },
    hiring: { why: 'They are hiring now and wrote the posting themselves, so it says what they actually need.', mention: 'Reply through the contact in the posting; open with the one project of yours closest to the role, with a number (scale, latency, cost).' },
    launch: { why: 'A YC launch means a small team where early engineers shape the system and learn fast.', mention: 'Use the product, leave a useful technical comment or bug report in the launch thread, then email the founders with what you would build next.' },
};

async function worthApproaching(items: FeedItem[], hiringAll: HiringPost[], now: number, roadmap: RoadmapLike): Promise<Target[]> {
    const WEEK = 7 * 864e5;
    const name = (t: string) => t.replace(/^Launch HN:\s*/i, '').split(/\s+(raises?|raised|secures?|bags?|lands?|closes?|gets|nabs)\b|\s[–—-]\s|\s\(/i)[0].trim().slice(0, 60);
    const funded = items.filter(i => (i.feedId.startsWith('su-') || i.feedId === 'tc-startups') && now - +i.date < WEEK && FUNDING.test(i.title) && MONEY.test(i.title))
        .map(i => ({ key: i.link, name: name(i.title), kind: 'funding' as const, signal: `Raised ${i.title.match(MONEY)?.[0] ?? ''}${i.title.match(ROUND) ? `, ${i.title.match(ROUND)![0]}` : ''}`.trim(), headline: i.title, url: i.link, text: `${i.title}. ${i.summary}` }));
    const hiring = hiringAll.filter(h => ENGINEERING.test(h.line))
        .map(h => ({ key: h.url, name: h.company, kind: 'hiring' as const, signal: `Hiring on HN · ${h.where}`, headline: h.line, url: h.url, text: h.line }));
    const launches = items.filter(i => i.feedId === 'launch-hn' && now - +i.date < WEEK)
        .map(i => ({ key: i.link, name: name(i.title), kind: 'launch' as const, signal: `YC launch${i.title.match(/\(YC [A-Z]\d{2,4}\)/)?.[0] ? ` ${i.title.match(/\(YC [A-Z]\d{2,4}\)/)![0]}` : ''}`, headline: i.title.replace(/^Launch HN:\s*/i, ''), url: i.comments ?? i.link, text: `${i.title}. ${i.summary}` }));
    const cands = [...funded, ...hiring, ...launches];
    if (!cands.length) return [];
    // Relevance to an engineering career: closest Roadmap topic among the engineering tracks, by meaning.
    const topics = [...roadmap.topics.values()].filter(t => CAREER_TRACKS.has(t.track) && roadmap.topicVec.has(t.id));
    const vecs = await embed(cands.map(c => c.text.slice(0, 600)));
    const scored = cands.map((c, k) => {
        let best: Topic | undefined, sim = 0;
        if (vecs) for (const t of topics) { const x = cosine(vecs[k], roadmap.topicVec.get(t.id)!); if (x > sim) { sim = x; best = t; } }
        return { ...c, sim, topic: sim >= 0.35 ? best?.name : undefined };
    }).filter(c => c.kind === 'hiring' ? c.sim >= 0.3 : c.sim >= 0.33);
    // The best few of each signal, most relevant first.
    const pick = (k: Target['kind'], n: number) => scored.filter(c => c.kind === k).sort((a, b) => b.sim - a.sim).slice(0, n);
    const chosen = [...pick('funding', 4), ...pick('hiring', 4), ...pick('launch', 3)];
    const notes = await approach(chosen.map(c => ({ key: c.key, name: c.name, signal: c.signal, text: c.text })));
    return chosen.map(c => ({ key: c.key, name: c.name, kind: c.kind, signal: c.signal, headline: c.headline, url: c.url, topic: c.topic, sim: c.sim, approach: notes[c.key] ?? PLAYBOOK[c.kind], ai: !!notes[c.key] }));
}

/** New top-level posts in the current "Ask HN: Who is hiring?" thread (posted by the whoishiring account). */
async function hiringPosts(now: number) {
    const get = async (u: string) => { const r = await fetch(u, { signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<any>; };
    const d = await get('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5');
    const t = (d.hits ?? []).find((h: any) => /who is hiring/i.test(h.title));
    if (!t) return { thread: undefined, posts: [] as HiringPost[], all: [] as HiringPost[], total: 0 };
    const thread = await get(`https://hn.algolia.com/api/v1/items/${t.objectID}`);
    const strip = (h: string) => h.replace(/<p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x2F;/g, '/').replace(/&gt;/g, '>').replace(/&lt;/g, '<').trim();
    const all = (thread.children ?? []).filter((c: any) => c.text && c.author);
    // The first line of a posting is the header by convention: "Company | Role | Location | Remote | …".
    const posts: HiringPost[] = all.map((c: any) => {
        const first = strip(c.text).split('\n')[0].trim();
        return { company: first.split('|')[0].trim().slice(0, 60), line: first.slice(0, 160), url: `https://news.ycombinator.com/item?id=${c.id}`, at: Date.parse(c.created_at), remote: /\bremote\b/i.test(first), where: whereFits(first) };
    }).filter((p: HiringPost) => p.line.includes('|') && p.where); // India, or remote worldwide
    const fresh = posts.filter(p => now - p.at < EDITION_WINDOW).sort((a, b) => b.at - a.at);
    return { thread: { title: t.title, url: `https://news.ycombinator.com/item?id=${t.objectID}` }, posts: fresh, all: posts, total: posts.length };
}
