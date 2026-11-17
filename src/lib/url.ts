// Prefix internal paths with the site's base (e.g. /sunny-docs on GitHub Pages).
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const u = (path: string) => `${base}${path}`;
