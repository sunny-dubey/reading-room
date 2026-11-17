import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const GET: APIRoute = async () => {
    const feeds = await getCollection('feeds');
    const byCat = new Map<string, typeof feeds>();
    for (const f of feeds) byCat.set(f.data.category, [...(byCat.get(f.data.category) ?? []), f]);
    const body = [...byCat].map(([cat, fs]) =>
        `    <outline text="${esc(cat)}">\n${fs.map(f =>
            `      <outline type="rss" text="${esc(f.data.title)}" xmlUrl="${esc(f.data.url)}"${f.data.site ? ` htmlUrl="${esc(f.data.site)}"` : ''}/>`).join('\n')}\n    </outline>`).join('\n');
    const opml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Sunny's feeds</title></head>\n  <body>\n${body}\n  </body>\n</opml>\n`;
    return new Response(opml, { headers: { 'Content-Type': 'text/x-opml; charset=utf-8' } });
};
