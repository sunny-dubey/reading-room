#!/usr/bin/env node
// Checks every Canon link (and chapter link) still resolves. Run: npm run check:links
// (CI runs it after deploy, non-blocking). A 429 means the site is rate-limiting the checker,
// not that the link is broken, so it's reported but doesn't fail the run.
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const canon = parse(await readFile('src/content/canon.yaml', 'utf8'));
const links = canon.flatMap(c => [
    { id: c.id, url: c.url },
    ...(c.parts ?? []).filter(p => p.url).map((p, j) => ({ id: `${c.id}/${j + 1}`, url: p.url })),
]);
// Chapter links often share a page with an anchor or time offset; check each page once.
const pages = [...new Map(links.map(l => [l.url.replace(/#.*$/, '').replace(/[?&]t=\d+s$/, ''), l])).entries()];
const UA = 'Mozilla/5.0 (compatible; reading-room link check)';
const bad = [], limited = [];
await Promise.all(pages.map(async ([url, l]) => {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
        if (res.status === 429) limited.push(`429  ${l.id}  ${url}`);
        else if (res.status >= 400) bad.push(`${res.status}  ${l.id}  ${url}`);
    } catch (err) {
        bad.push(`ERR  ${l.id}  ${url}  (${err.cause?.code ?? err.name})`);
    }
}));
console.log(`checked ${pages.length} links (${canon.length} canon reads + chapters): ${bad.length ? `${bad.length} broken` : 'all ok'}`);
bad.sort().forEach(b => console.log('  ' + b));
if (limited.length) {
    console.log(`rate-limited, not checked (${limited.length}):`);
    limited.sort().forEach(b => console.log('  ' + b));
}
if (bad.length) process.exitCode = 1;
