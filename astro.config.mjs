import { defineConfig } from 'astro/config';
import notebookEditor from './integrations/notebook-editor.mjs';

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
    integrations: [notebookEditor()], // dev-only editor API for /write/
});
