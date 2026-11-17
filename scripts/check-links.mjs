#!/usr/bin/env node
// Checks every Canon link still resolves. Run: npm run check:links (CI runs it after deploy, non-blocking).
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const canon = parse(await readFile('src/content/canon.yaml', 'utf8'));
const UA = 'Mozilla/5.0 (compatible; reading-room link check)';
const bad = [];
await Promise.all(canon.map(async c => {
    try {
        const res = await fetch(c.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
        if (res.status >= 400) bad.push(`${res.status}  ${c.id}  ${c.url}`);
    } catch (err) {
        bad.push(`ERR  ${c.id}  ${c.url}  (${err.cause?.code ?? err.name})`);
    }
}));
console.log(`checked ${canon.length} canon links: ${bad.length ? `${bad.length} broken` : 'all ok'}`);
bad.sort().forEach(b => console.log('  ' + b));
if (bad.length) process.exitCode = 1;
