import { defineConfig } from 'astro/config';
import { readdir, stat, mkdir, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Article thumbnails are made at build time into .cache/thumbs (src/lib/meta.ts).
// Copy the recent ones into the site, and serve them in dev.
const THUMBS = '.cache/thumbs';
const thumbs = {
    name: 'reading-room-thumbs',
    hooks: {
        'astro:server:setup': ({ server }) => {
            server.middlewares.use(async (req, res, next) => {
                const m = req.url?.match(/\/thumbs\/([a-f0-9]+-\d+\.webp)$/);
                if (!m) return next();
                try { res.setHeader('Content-Type', 'image/webp'); res.end(await readFile(join(THUMBS, m[1]))); } catch { next(); }
            });
        },
        'astro:build:done': async ({ dir }) => {
            const out = join(dir.pathname, 'thumbs');
            await mkdir(out, { recursive: true });
            let files = [];
            try { files = await readdir(THUMBS); } catch {}
            for (const f of files) {
                const st = await stat(join(THUMBS, f));
                if (st.size > 0 && Date.now() - st.mtimeMs < 45 * 864e5) await copyFile(join(THUMBS, f), join(out, f));
            }
        },
    },
};

export default defineConfig({
    // Served from https://sunny-dubey.github.io/reading-room/ — use u() from src/lib/url.ts for internal links.
    site: 'https://sunny-dubey.github.io',
    base: '/reading-room',
    markdown: {
        shikiConfig: {
            themes: { light: 'github-light', dark: 'github-dark-dimmed' },
            wrap: true,
        },
    },
    // Inline CSS into every page: a browser holding a cached page from an older deploy
    // would otherwise request a stylesheet that the new deploy has deleted (unstyled page).
    build: { format: 'directory', inlineStylesheets: 'always' },
    integrations: [thumbs],
});
