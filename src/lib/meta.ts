// The article's own metadata: the description its author wrote (og:description / meta description) and
// its preview image (og:image). Images are downloaded once and shrunk into small WebP thumbnails served
// from this site, so readers never load third-party images. Cached in .cache/meta and .cache/thumbs.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

export interface PageMeta { description?: string; image?: string }
const META_DIR = join(process.cwd(), '.cache', 'meta');
export const THUMB_DIR = join(process.cwd(), '.cache', 'thumbs');
const DAYS = 30;
const UA = 'Mozilla/5.0 (compatible; reading-room; +https://github.com/sunny-dubey/reading-room)';
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 20);
const decode = (s: string) => s.replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2F;/g, '/').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function metaTag(html: string, names: string[]) {
    for (const n of names) {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i');
        const tag = html.match(re)?.[0];
        const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
        if (content) return decode(content);
    }
}

/** Description and preview image for a page (cached for 30 days, failures too). */
export async function getMeta(url: string): Promise<PageMeta> {
    if (/\.pdf($|\?)/i.test(url)) return {};
    const file = join(META_DIR, sha(url) + '.json');
    if (existsSync(file)) {
        try { const c = JSON.parse(await readFile(file, 'utf8')); if (Date.now() - c.at < DAYS * 864e5) return c.meta; } catch {}
    }
    let meta: PageMeta = {};
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
        if (res.ok && (res.headers.get('content-type') ?? '').includes('html')) {
            const head = (await res.text()).slice(0, 400_000);
            const description = metaTag(head, ['og:description', 'twitter:description', 'description']);
            let image = metaTag(head, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
            if (image) { try { image = new URL(image, res.url).href; } catch { image = undefined; } }
            meta = { description, image };
        }
    } catch {}
    try { await mkdir(META_DIR, { recursive: true }); await writeFile(file, JSON.stringify({ at: Date.now(), url, meta })); } catch {}
    return meta;
}

/** A small WebP thumbnail of the image, stored in .cache/thumbs and served at /thumbs/. Returns the file name. */
export async function makeThumb(imageUrl: string, width: number): Promise<string | undefined> {
    const name = `${sha(imageUrl)}-${width}.webp`;
    const file = join(THUMB_DIR, name);
    if (existsSync(file)) {
        try { if ((await stat(file)).size > 0) return name; return undefined; } catch {}
    }
    try {
        const res = await fetch(imageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
        if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('not an image');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 12_000_000) throw new Error('too large');
        const out = await sharp(buf, { animated: false }).resize({ width, height: Math.round(width / 2), fit: 'cover', position: 'attention' }).webp({ quality: 68 }).toBuffer();
        await mkdir(THUMB_DIR, { recursive: true });
        await writeFile(file, out);
        return name;
    } catch {
        try { await mkdir(THUMB_DIR, { recursive: true }); await writeFile(file, ''); } catch {} // remember the failure
        return undefined;
    }
}

/** A description worth showing: the author's own words, not boilerplate or a repeat of the title. */
export function cleanDescription(d: string | undefined, title: string) {
    if (!d) return undefined;
    // og:description is sometimes entity-encoded twice ("Silberman &#8211; T."): decode what's left.
    const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
    d = d.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m);
    const t = d.replace(/\s*(Read more|Continue reading|\[…\]|\.\.\.)\s*$/i, '').trim();
    if (t.length < 40 || t.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) return undefined;
    if (/cookies|subscribe|sign up|newsletter|javascript/i.test(t.slice(0, 80))) return undefined;
    return t.length > 190 ? t.slice(0, 187).replace(/\s+\S*$/, '') + '…' : t;
}
