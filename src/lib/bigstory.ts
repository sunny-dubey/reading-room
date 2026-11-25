// The big story: when several independent sources write about the same thing within a few days,
// that is the story of the moment, whatever each source's own ranking says.
// Items are grouped by meaning (local embeddings of titles) AND a shared distinctive word (a product,
// paper or project name), so two posts that are merely on the same topic don't count as one story.
import { embed, cosine } from './embed';
import type { FeedItem } from './feeds';

const DAY = 864e5;
const SIM = 0.6;           // title-embedding similarity to count as the same story (checked by hand on real editions)
const MIN_SOURCES = 3;     // independent sources needed

export interface BigStory { lead: FeedItem; items: FeedItem[]; sources: number }

const STOP = new Set('with from that this have been what your into more than about after over will when where which their they them there these those just like using used make made does into here only also some most much very year years week today first last best ways things introducing announcing release released launch launches launched update updates new now how why'.split(' '));
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{2,}/g) ?? []).filter(w => !STOP.has(w) && !/^\d{1,2}$/.test(w)));

/** Groups of the same story: pairs from different sources whose titles are close in meaning (cosine ≥ sim)
 *  AND share a distinctive word (in ≤ ~2% of titles, 4+ letters). Returns index groups (singletons included). */
export function groupSame(titles: string[], sources: string[], vecs: number[][], sim = SIM): number[][] {
    const ws = titles.map(words);
    const df = new Map<string, number>();
    for (const w of ws) for (const x of w) df.set(x, (df.get(x) ?? 0) + 1);
    const rare = Math.max(2, Math.ceil(titles.length * 0.02));
    const shares = (a: number, b: number) => { for (const x of ws[a]) if (ws[b].has(x) && (df.get(x) ?? 0) <= rare && x.length >= 4) return true; return false; };
    const parent = titles.map((_, k) => k);
    const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    for (let a = 0; a < titles.length; a++) for (let b = a + 1; b < titles.length; b++) {
        if (sources[a] === sources[b]) continue;
        if (cosine(vecs[a], vecs[b]) >= sim && shares(a, b)) parent[find(a)] = find(b);
    }
    const groups = new Map<number, number[]>();
    titles.forEach((_, k) => { const r = find(k); groups.set(r, [...(groups.get(r) ?? []), k]); });
    return [...groups.values()];
}

export async function bigStories(items: FeedItem[], now: number, days = 3, max = 3): Promise<BigStory[]> {
    const pool = items.filter(i => now - +i.date < days * DAY && +i.date <= now + DAY);
    if (pool.length < MIN_SOURCES) return [];
    const vecs = await embed(pool.map(i => i.title));
    if (!vecs) return [];
    const out: BigStory[] = [];
    for (const ks of groupSame(pool.map(i => i.title), pool.map(i => i.feedId), vecs)) {
        const list = ks.map(k => pool[k]);
        const sources = new Set(list.map(i => i.feedId)).size;
        if (sources < MIN_SOURCES) continue;
        // Lead with the original: the earliest post from a desk source (not a headline aggregator or a newsletter roundup).
        const side = (i: FeedItem) => Number(['pulse', 'startups'].includes(i.category)) + Number(/^\[[^\]]+\]|roundup|newsletter|this week/i.test(i.title));
        const lead = [...list].sort((a, b) => side(a) - side(b) || +a.date - +b.date)[0];
        out.push({ lead, items: [...list].sort((a, b) => +a.date - +b.date), sources });
    }
    return out.sort((a, b) => b.sources - a.sources || +b.lead.date - +a.lead.date).slice(0, max);
}
