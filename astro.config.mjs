import { defineConfig } from 'astro/config';

export default defineConfig({
    // TODO: set to your real domain once decided (and add public/CNAME)
    site: 'https://sunny-dubey.github.io',
    markdown: {
        shikiConfig: {
            themes: { light: 'github-light', dark: 'github-dark-dimmed' },
            wrap: true,
        },
    },
    build: { format: 'directory' },
});
