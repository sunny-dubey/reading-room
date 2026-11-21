import { CATEGORIES } from '../lib/feeds';
import { u } from '../lib/url';

// Service worker for offline reading (registered in Base.astro, production only).
// Pages and JSON: network first, cache when offline, so a fresh edition always wins and a
// cached one shows the stale-edition notice. Hashed assets, thumbnails and fonts: cache first.
// The cache is named after the build, and old editions' caches are deleted on activate.
export function GET() {
    const version = `rr-${Date.now().toString(36)}`;
    const base = u('/');
    const precache = [
        '/', '/briefing/', '/markets/', '/outages/', '/puzzles/', '/week/', '/roadmap/', '/canon/', '/search/', '/sources/',
        '/search-index.json',
        ...CATEGORIES.map(c => `/${c.slug}/`),
    ].map(u);

    const js = `
const VERSION = ${JSON.stringify(version)};
const BASE = ${JSON.stringify(base)};
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(VERSION);
        // One page failing must not stop the rest from being saved.
        const thumbs = new Set();
        await Promise.allSettled(PRECACHE.map(async url => {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (!res.ok) return;
            await cache.put(url, res.clone());
            // Save the thumbnails each page shows, so its cards have pictures offline too.
            if (url.endsWith('/')) for (const m of (await res.text()).matchAll(/src="([^"]*\\/thumbs\\/[^"]+\\.webp)"/g)) thumbs.add(m[1]);
        }));
        await Promise.allSettled([...thumbs].map(t => cache.add(t)));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) if (key.startsWith('rr-') && key !== VERSION) await caches.delete(key);
        await self.clients.claim();
    })());
});

const isStatic = url => /\\/(_astro|thumbs)\\//.test(url.pathname) || /\\.(woff2?|svg|png|webp|jpg)$/.test(url.pathname);

async function networkFirst(request) {
    const cache = await caches.open(VERSION);
    try {
        // no-cache: always check with the server, so a new edition shows at once
        // (GitHub Pages lets browsers reuse a page for 10 minutes otherwise).
        const res = await fetch(request.url, { cache: 'no-cache' });
        if (res.ok) cache.put(request, res.clone());
        return res;
    } catch (err) {
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) return hit;
        if (request.mode === 'navigate') {
            const front = await cache.match(BASE);
            if (front) return front;
        }
        throw err;
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
    if (url.pathname === BASE + 'sw.js') return;
    event.respondWith(isStatic(url) ? cacheFirst(request) : networkFirst(request));
});
`;
    return new Response(js, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
}
