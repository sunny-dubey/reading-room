#!/usr/bin/env node
// Quick capture without Claude:
//   npm run new log "Postgres SKIP LOCKED makes a table a safe queue" -- postgres,queues
//   npm run new note "Payments"
//   npm run new writing "Why idempotency keys matter"
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const [kind, title, tagArg = ''] = process.argv.slice(2);
const dirs = { log: 'src/content/log', note: 'src/content/notes', writing: 'src/content/writing' };
if (!dirs[kind] || !title) {
    console.error('usage: npm run new <log|note|writing> "Title" [tag1,tag2]');
    process.exit(1);
}
const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const tags = tagArg.split(',').map(t => t.trim()).filter(Boolean);
const file = join(dirs[kind], kind === 'log' ? `${today}-${slug}.md` : `${slug}.md`);

if (existsSync(file)) { console.error(`exists: ${file}`); process.exit(1); }
mkdirSync(dirs[kind], { recursive: true });
const dateField = kind === 'note' ? 'updated' : 'date';
writeFileSync(file, `---
title: ${JSON.stringify(title)}
${dateField}: ${today}
tags: [${tags.join(', ')}]
---

`);
console.log(file);
try { execSync(`code "${file}"`, { stdio: 'ignore' }); } catch {}
