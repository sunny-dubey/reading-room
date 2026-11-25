// The site's own feed: each edition's worthwhile pieces (last 24 hours, worth ≥ 3, best first), so the paper
// can be read in any feed reader. Descriptions are the "What you'll get" line (kind, what it covers, the skill).
import type { APIRoute } from 'astro';
import { getReading, rank } from '../lib/reading';
import { categoryShort } from '../lib/feeds';
import { KIND } from '../lib/summarize';
import { u } from '../lib/url';

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site }) => {
    const { edition, now, fetchedAt } = await getReading();
    const base = new URL(u('/'), site ?? 'https://sunny-dubey.github.io').href;
    const items = edition.filter(i => (i.brief?.worth ?? 0) >= 3).sort((a, b) => rank(b, now) - rank(a, now)).slice(0, 40);
    const describe = (i: (typeof items)[number]) => {
        const k = i.brief?.kind ? KIND[i.brief.kind] : undefined;
        const covers = i.brief?.outline?.length ? `Covers: ${i.brief.outline.slice(0, 4).join(' · ')}.` : '';
        return [k && `${k.label}${i.brief?.minutes ? ` · ${i.brief.minutes} min` : ''}.`, i.learn ?? k?.intent, covers, i.skill && `You'll get better at ${i.skill.topic.name}.`, `${i.feedTitle} · ${categoryShort(i.category)}`].filter(Boolean).join(' ');
    };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>The Reading Room</title>
<link>${esc(base)}</link>
<atom:link href="${esc(new URL('rss.xml', base).href)}" rel="self" type="application/rss+xml"/>
<description>A daily paper for engineers who read like researchers: the last 24 hours from the best experts, four editions a day.</description>
<lastBuildDate>${new Date(fetchedAt).toUTCString()}</lastBuildDate>
${items.map(i => `<item>
<title>${esc(i.title)}</title>
<link>${esc(i.link)}</link>
<guid isPermaLink="true">${esc(i.link)}</guid>
<pubDate>${i.date.toUTCString()}</pubDate>
<category>${esc(categoryShort(i.category))}</category>
<description>${esc(describe(i))}</description>
</item>`).join('\n')}
</channel>
</rss>`;
    return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
