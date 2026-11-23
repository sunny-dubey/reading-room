import { u } from '../lib/url';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getFeeds, categoryLabel } from '../lib/feeds';

// Everything searchable: roadmap topics, Canon reads, and recent articles.
export const GET: APIRoute = async () => {
    const [feeds, canon, roadmap] = await Promise.all([getFeeds(), getCollection('canon'), getCollection('roadmap')]);
    const seen = new Set<string>();
    const topics = roadmap.sort((a, b) => a.data.n - b.data.n).flatMap(a => a.data.topics
        .filter(t => !seen.has(t.id) && !!seen.add(t.id))
        .map(t => ({ kind: 'topic', title: t.name, href: u(`/roadmap/#${t.id}`), tags: [a.data.title.toLowerCase()], text: `${a.data.title}${t.group ? ` · ${t.group}` : ''}. ${t.why ?? a.data.why} ${t.about ?? ''}` })));
    const index = [
        ...topics,
        ...canon.map(c => ({ kind: 'canon', title: c.data.title, href: c.data.url, tags: [categoryLabel(c.data.track).toLowerCase(), c.data.kind], text: `${c.data.author}. ${c.data.why}` })),
        ...feeds.items.map(i => ({ kind: 'article', title: i.title.slice(0, 200), href: i.link, tags: [categoryLabel(i.category).toLowerCase(), ...(i.brief?.concepts ?? [])], text: `${i.feedTitle} ${i.summary}` })),
    ];
    return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
};
