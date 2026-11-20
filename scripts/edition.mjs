#!/usr/bin/env node
// Build a fresh edition locally and print what's in it.
//   npm run edition            build with fresh data, then summarise
//   npm run edition -- --serve  also start the preview at http://localhost:4321/reading-room/ if it isn't running
// Publishing is separate: push to main, or `gh workflow run deploy.yml`.
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

const t0 = Date.now();
const build = () => {
    const b = spawnSync('npx', ['astro', 'build'], { encoding: 'utf8' });
    const out = (b.stdout ?? '') + (b.stderr ?? '');
    if (b.status !== 0) { console.error(out.split('\n').filter(l => /error/i.test(l)).slice(0, 20).join('\n') || out.slice(-3000)); process.exit(1); }
    return out.match(/(\d+) page\(s\) built/)?.[1] ?? '?';
};
console.log('Building a fresh edition (feeds, outages, CVEs, papers)…');
const pages = build();


const html = readFileSync('dist/index.html', 'utf8');
const text = s => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const first = (re) => { const m = html.match(re); return m ? text(m[1]) : '—'; };
const all = (re) => [...html.matchAll(re)].map(m => text(m[1]));
const between = (start, end = '</section>') => { const i = html.indexOf(start); return i < 0 ? '' : html.slice(i, html.indexOf(end, i)); };

const dateline = text(between('class="fp-dateline"', '</div>').replace(/^[^>]*>/, ''));
const lead = first(/class="fp-lead"[^>]*>[\s\S]*?class="fp-lead-h[^"]*"><a[^>]*>([\s\S]*?)<\/a>/);
const fresh = [...between('Fresh this week').matchAll(/class="story-h"><a[^>]*>([\s\S]*?)<\/a>/g)].map(m => text(m[1]));
const puzzle = all(/class="pz-title">([\s\S]*?)<\/h3>/g)[0] ?? '—';
const question = first(/class="qotd-q">([\s\S]*?)<\/p>/);
const weather = first(/Internet weather<\/span>\s*<span class="fp-ear-v">([\s\S]*?)<\/span>/);
const outages = first(/class="out-front-stats">([\s\S]*?)<\/p>/);
const box = (name) => between(`>${name}`, '</ul>');
const count = (s) => (s.match(/<li/g) ?? []).length;
const releases = all(/<li><b>([^<]*)<\/b> <span class="mono">/g);

console.log(`\nEdition ready in ${Math.round((Date.now() - t0) / 1000)}s · ${pages} pages · ${dateline}`);
console.log(`\n  Lead:        ${lead}`);
console.log(`  Fresh (${fresh.length}):   ${fresh.slice(0, 4).join(' · ')}${fresh.length > 4 ? ' …' : ''}`);
console.log(`  Puzzle:      ${puzzle}`);
console.log(`  Question:    ${question}`);
console.log(`  Weather:     ${weather}`);
console.log(`  Outages:     ${outages}`);
console.log(`  Briefing:    ${releases.length} releases (${releases.slice(0, 4).join(', ')}) · ${count(box('Obituaries'))} end-of-life · ${count(box('CVE watch'))} CVEs · ${count(box('Paper drop'))} papers`);

// Is the preview server up? It serves dist/, so a running one already shows this edition.
const up = await new Promise(r => { const s = createConnection(4321, '127.0.0.1'); s.on('connect', () => { s.end(); r(true); }); s.on('error', () => r(false)); });
if (up) console.log('\nOn localhost now: http://localhost:4321/reading-room/ (reload the page)');
else if (process.argv.includes('--serve')) {
    spawn('npx', ['astro', 'preview', '--port', '4321'], { detached: true, stdio: 'ignore' }).unref();
    console.log('\nStarted the preview: http://localhost:4321/reading-room/');
} else console.log('\nPreview not running. Start it with: npm run preview -- --port 4321 (or npm run edition -- --serve)');
console.log('Not published. To publish: push to main, or run `gh workflow run deploy.yml`.');
