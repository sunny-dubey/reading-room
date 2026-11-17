import { u } from '../lib/url';
import type { APIRoute } from 'astro';
import { getLog, getNotes, getWriting, getLibrary } from '../lib/content';
import { getFeeds, categoryLabel } from '../lib/feeds';

const strip = (md = '') => md.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();

export const GET: APIRoute = async () => {
    const [log, notes, writing, library, feeds] = await Promise.all([getLog(), getNotes(), getWriting(), getLibrary(), getFeeds()]);
    const index = [
        ...log.map(e => ({ kind: 'log', title: e.data.title, href: u(`/log/${e.id}/`), tags: e.data.tags, text: strip(e.body) })),
        ...notes.map(e => ({ kind: 'note', title: e.data.title, href: u(`/notes/${e.id}/`), tags: e.data.tags, text: strip(`${e.data.summary ?? ''} ${e.body}`) })),
        ...writing.map(e => ({ kind: 'writing', title: e.data.title, href: u(`/writing/${e.id}/`), tags: e.data.tags, text: strip(`${e.data.description ?? ''} ${e.body}`) })),
        ...feeds.items.map(i => ({ kind: 'reading', title: i.title.slice(0, 200), href: i.link, tags: [categoryLabel(i.category).toLowerCase(), ...i.signals], text: `${i.post?.author ?? (i.reddit ? 'r/' + i.reddit.sub : i.feedTitle)} ${i.summary}` })),
        ...library.map(e => ({ kind: 'library', title: e.data.title, href: e.data.url, tags: e.data.tags, text: `${e.data.author ?? ''} ${e.data.why}` })),
    ];
    return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
};
