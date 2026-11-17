import { defineConfig } from 'astro/config';

export default defineConfig({
    // Served from https://sunny-dubey.github.io/sunny-docs/ — use u() from src/lib/url.ts for internal links.
    site: 'https://sunny-dubey.github.io',
    base: '/sunny-docs',
    markdown: {
        shikiConfig: {
            themes: { light: 'github-light', dark: 'github-dark-dimmed' },
            wrap: true,
        },
    },
    build: { format: 'directory' },
});
