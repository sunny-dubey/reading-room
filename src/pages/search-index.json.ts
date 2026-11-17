import { u } from '../lib/url';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getNotes, getLibrary } from '../lib/content';
import { getFeeds, categoryLabel } from '../lib/feeds';

const strip = (md = '') => md.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();

// Everything searchable: roadmap topics, Canon reads, recent articles, notes and saved links.
export const GET: APIRoute = async () => {
    const [notes, library, feeds, canon, roadmap] = await Promise.all([getNotes(), getLibrary(), getFeeds(), getCollection('canon'), getCollection('roadmap')]);
    const seen = new Set<string>();
    const topics = roadmap.sort((a, b) => a.data.n - b.data.n).flatMap(a => a.data.topics
        .filter(t => !seen.has(t.id) && !!seen.add(t.id))
        .map(t => ({ kind: 'topic', title: t.name, href: u(`/roadmap/#${t.id}`), tags: [a.data.title.toLowerCase()], text: `${a.data.title}${t.group ? ` · ${t.group}` : ''}. ${t.why ?? a.data.why} ${t.about ?? ''}` })));
    const index = [
        ...topics,
        ...canon.map(c => ({ kind: 'canon', title: c.data.title, href: c.data.url, tags: [categoryLabel(c.data.track).toLowerCase(), c.data.kind], text: `${c.data.author}. ${c.data.why}` })),
        ...feeds.items.map(i => ({ kind: 'article', title: i.title.slice(0, 200), href: i.link, tags: [categoryLabel(i.category).toLowerCase(), ...(i.brief?.concepts ?? [])], text: `${i.feedTitle} ${i.summary}` })),
        ...notes.map(e => ({ kind: 'note', title: e.data.title, href: u(`/notebook/${e.id}/`), tags: e.data.tags, text: strip(e.body) })),
        ...library.map(e => ({ kind: 'saved', title: e.data.title, href: e.data.url, tags: e.data.tags, text: `${e.data.author ?? ''} ${e.data.why}` })),
    ];
    return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
};
