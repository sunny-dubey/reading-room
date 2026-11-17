import { u } from '../lib/url';
import type { APIRoute } from 'astro';
import { getNotes, getLibrary } from '../lib/content';
import { getFeeds, categoryLabel } from '../lib/feeds';

const strip = (md = '') => md.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();

export const GET: APIRoute = async () => {
    const [notes, library, feeds] = await Promise.all([getNotes(), getLibrary(), getFeeds()]);
    const index = [
        ...notes.map(e => ({ kind: 'note', title: e.data.title, href: u(`/notebook/${e.id}/`), tags: e.data.tags, text: strip(e.body) })),
        ...feeds.items.map(i => ({ kind: 'reading', title: i.title.slice(0, 200), href: i.link, tags: [categoryLabel(i.category).toLowerCase()], text: `${i.feedTitle} ${i.summary}` })),
        ...library.map(e => ({ kind: 'library', title: e.data.title, href: e.data.url, tags: e.data.tags, text: `${e.data.author ?? ''} ${e.data.why}` })),
    ];
    return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
};
