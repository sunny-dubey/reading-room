// Dev-only API for the in-site editor (/write/). Lives inside `astro dev`, so it
// never exists on the deployed static site. Reads and writes markdown files in src/content.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse, stringify, parseDocument } from 'yaml';

// One kind of entry: a note. Files live in src/content/notes, pages at /notebook/<id>/.
const NOTES_DIR = 'src/content/notes';

const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60).replace(/-$/, '');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
const safeId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);

function split(md) {
    const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    return m ? { data: parse(m[1]) ?? {}, body: m[2].replace(/^\n/, '') } : { data: {}, body: md };
}

function frontmatter(input, existing = {}) {
    const tags = (input.tags ?? []).map(t => String(t).toLowerCase().trim().replace(/\s+/g, '-')).filter(Boolean);
    const fm = { title: input.title.trim(), date: existing.date || today(), tags };
    if (input.source && /^https?:\/\//.test(input.source)) fm.source = input.source;
    if (input.draft) fm.draft = true;
    return fm;
}

async function body(req) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return JSON.parse(raw || '{}');
}

const send = (res, status, obj) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
};

export default function notebookEditor() {
    let base = '';
    let root = process.cwd();
    return {
        name: 'notebook-editor',
        hooks: {
            'astro:config:done': ({ config }) => {
                base = (config.base || '/').replace(/\/$/, '');
                root = new URL(config.root).pathname;
            },
            'astro:server:setup': ({ server, logger }) => {
                server.middlewares.use(async (req, res, next) => {
                    const full = new URL(req.url ?? '/', 'http://localhost');
                    const api = `${base}/__notebook/`;
                    if (!full.pathname.startsWith(api) && !full.pathname.startsWith('/__notebook/')) return next();
                    // Normalise to /__notebook/... whether or not the base prefix was included.
                    const url = new URL(full.pathname.replace(base, '').replace(/^\/?/, '/') + full.search, 'http://localhost');
                    // Only accept requests from this machine.
                    const ip = req.socket.remoteAddress ?? '';
                    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return send(res, 403, { error: 'local only' });
                    try {
                        if (url.pathname === '/__notebook/load' && req.method === 'GET') {
                            const id = url.searchParams.get('id');
                            if (!safeId(id)) return send(res, 400, { error: 'bad id' });
                            const file = resolve(root, NOTES_DIR, `${id}.md`);
                            if (!existsSync(file)) return send(res, 404, { error: 'not found' });
                            const { data, body: md } = split(await readFile(file, 'utf8'));
                            return send(res, 200, { id, data, body: md });
                        }
                        if (url.pathname === '/__notebook/tags' && req.method === 'GET') {
                            const tags = new Set();
                            const abs = resolve(root, NOTES_DIR);
                            if (existsSync(abs)) for (const f of await readdir(abs)) if (f.endsWith('.md')) {
                                for (const t of split(await readFile(join(abs, f), 'utf8')).data.tags ?? []) tags.add(t);
                            }
                            return send(res, 200, { tags: [...tags].sort() });
                        }
                        if (url.pathname === '/__notebook/save' && req.method === 'POST') {
                            const input = await body(req);
                            if (!input.title?.trim()) return send(res, 400, { error: 'Title is required' });
                            const dir = resolve(root, NOTES_DIR);
                            await mkdir(dir, { recursive: true });
                            let id = input.id;
                            let existing = {};
                            if (id) {
                                if (!safeId(id)) return send(res, 400, { error: 'bad id' });
                                const f = join(dir, `${id}.md`);
                                if (existsSync(f)) existing = split(await readFile(f, 'utf8')).data;
                            } else {
                                const base0 = `${today()}-${slugify(input.title) || 'note'}`;
                                id = base0;
                                for (let n = 2; existsSync(join(dir, `${id}.md`)); n++) id = `${base0}-${n}`;
                            }
                            const fm = frontmatter(input, existing);
                            const yaml = stringify(fm, { lineWidth: 0 }).replace(/^tags:\n((?:  - .*\n?)*)/m, (_, l) => `tags: [${l.split('\n').filter(Boolean).map(x => x.replace(/^\s*- /, '')).join(', ')}]\n`);
                            await writeFile(join(dir, `${id}.md`), `---\n${yaml}---\n\n${(input.body ?? '').trim()}\n`);
                            logger.info(`saved ${NOTES_DIR}/${id}.md`);
                            return send(res, 200, { id, path: `${NOTES_DIR}/${id}.md`, url: `${base}/notebook/${id}/` });
                        }
                        if (url.pathname === '/__notebook/library' && req.method === 'POST') {
                            const input = await body(req);
                            if (!input.title || !/^https?:\/\//.test(input.url ?? '') || !input.why?.trim()) return send(res, 400, { error: 'title, url and why are required' });
                            const file = resolve(root, 'src/content/library.yaml');
                            const text = existsSync(file) ? await readFile(file, 'utf8') : '';
                            const list = parse(text) ?? [];
                            if (list.some(e => e.url === input.url)) return send(res, 409, { error: 'already saved' });
                            let id = slugify(input.title) || 'link';
                            const ids = new Set(list.map(e => e.id));
                            for (let n = 2; ids.has(id); n++) id = `${slugify(input.title)}-${n}`;
                            const entry = {
                                id, title: input.title, url: input.url,
                                ...(input.author ? { author: input.author } : {}),
                                kind: 'article', why: input.why.trim(), added: today(),
                                tags: (input.tags ?? []).map(t => String(t).toLowerCase().trim().replace(/\s+/g, '-')).filter(Boolean),
                            };
                            const block = stringify([entry]).replace(/^tags:\n((?:\s+- .*\n?)*)/m, m => m);
                            await writeFile(file, text.replace(/\s*$/, '\n\n') + block);
                            logger.info(`saved to library: ${input.title}`);
                            return send(res, 200, { id });
                        }
                        if (url.pathname === '/__notebook/library/remove' && req.method === 'POST') {
                            const { id } = await body(req);
                            if (!id || typeof id !== 'string') return send(res, 400, { error: 'id is required' });
                            const file = resolve(root, 'src/content/library.yaml');
                            if (!existsSync(file)) return send(res, 404, { error: 'no library file' });
                            // parseDocument keeps the file's comments intact.
                            const doc = parseDocument(await readFile(file, 'utf8'));
                            const idx = (doc.contents?.items ?? []).findIndex(n => n.get?.('id') === id);
                            if (idx < 0) return send(res, 404, { error: 'not found' });
                            doc.contents.items.splice(idx, 1);
                            await writeFile(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
                            logger.info(`removed from library: ${id}`);
                            return send(res, 200, { id });
                        }
                        return send(res, 404, { error: 'unknown endpoint' });
                    } catch (err) {
                        logger.error(String(err));
                        return send(res, 500, { error: String(err?.message ?? err) });
                    }
                });
            },
        },
    };
}
