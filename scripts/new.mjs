#!/usr/bin/env node
// Quick note from the terminal:  npm run new "What I understood about MVCC" postgres,mvcc
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const [title, tagArg = ''] = process.argv.slice(2);
if (!title) { console.error('usage: npm run new "Title" [tag1,tag2]'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA');
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const tags = tagArg.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
const dir = 'src/content/notes';
const file = join(dir, `${today}-${slug}.md`);
if (existsSync(file)) { console.error(`exists: ${file}`); process.exit(1); }
mkdirSync(dir, { recursive: true });
writeFileSync(file, `---\ntitle: ${JSON.stringify(title)}\ndate: ${today}\ntags: [${tags.join(', ')}]\n---\n\n`);
console.log(file);
try { execSync(`code "${file}"`, { stdio: 'ignore' }); } catch {}
