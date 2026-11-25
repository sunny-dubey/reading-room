// Business & economy: a Techmeme-style river of the last 24 hours from the outlets that break the news
// (feeds with category `business` in feeds.yaml). The same story across outlets is shown once, with the
// others as "also in". Grouping reuses the big story's rule (meaning + a shared distinctive word).
import { getFeeds, type FeedItem } from './feeds';
import { embed } from './embed';
import { groupSame } from './bigstory';
import { EDITION_WINDOW } from './edition';

export interface BizStory { lead: FeedItem; also: FeedItem[]; outlets: number }

/** "WSJ: Markets" and "WSJ: Business" are one outlet. */
const ALIAS: Record<string, string> = { FT: 'Financial Times' };
export const outlet = (i: FeedItem) => { const o = i.feedTitle.replace(/:.*$/, '').trim(); return ALIAS[o] ?? o; };
/** The outlet's one-line description, unless it only repeats the headline. */
export const bizDek = (i: FeedItem) => { const d = i.summary.replace(/\s+/g, ' ').trim(); const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ''); return d && !norm(d).startsWith(norm(i.title).slice(0, 40)) ? d : ''; };

let memo: ReturnType<typeof build> | undefined;
export const getBusiness = () => (memo ??= build());

async function build() {
    const { items, fetchedAt } = await getFeeds();
    const now = +fetchedAt;
    const seen = new Set<string>();
    const pool = items
        .filter(i => i.category === 'business' && +i.date <= now && now - +i.date < EDITION_WINDOW)
        .sort((a, b) => +b.date - +a.date)
        .filter(i => { const k = i.link.replace(/[?#].*$/, ''); return !seen.has(k) && !!seen.add(k); }); // one article in two feeds
    const vecs = pool.length ? await embed(pool.map(i => i.title)) : null;
    const groups = vecs ? groupSame(pool.map(i => i.title), pool.map(outlet), vecs, 0.6) : pool.map((_, k) => [k]);
    const stories: BizStory[] = groups.map(ks => {
        const list = ks.map(k => pool[k]).sort((a, b) => +a.date - +b.date);
        return { lead: list[0], also: list.slice(1), outlets: new Set(list.map(outlet)).size };
    });
    // Top: covered by two or more outlets, most outlets first. The river: everything else, newest first.
    const top = stories.filter(s => s.outlets >= 2).sort((a, b) => b.outlets - a.outlets || +b.lead.date - +a.lead.date);
    const river = stories.filter(s => s.outlets < 2).sort((a, b) => +b.lead.date - +a.lead.date);
    const outlets = [...new Set(pool.map(outlet))].sort();
    return { now, top, river, total: pool.length, outlets };
}
