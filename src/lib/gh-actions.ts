// Live-site writing: hands notes and saves to GitHub's web editor (no backend, works on any device).
import { ghNewNote, ghEditFile } from './site';

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the reader's timezone
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'note';
const yamlStr = (s: string) => JSON.stringify(s);

function noteUrl(title: string, body: string, source?: string) {
    const fm = `---\ntitle: ${yamlStr(title)}\ndate: ${today()}\ntags: []\n${source ? `source: ${source}\n` : ''}---\n\n`;
    const filename = `${today()}-${slug(title)}.md`;
    return `${ghNewNote}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(fm + body)}`;
}

// Title/URL/author come from data-* on the button, or from the card it sits in (keeps pages small).
function context(el: HTMLElement) {
    const host = el.closest<HTMLElement>('[data-link]');
    const titleEl = host?.querySelector('.learn-title, .canon-title, .next-title, .plan-title');
    return {
        title: el.dataset.title ?? titleEl?.textContent?.trim() ?? document.title,
        url: el.dataset.url ?? host?.dataset.link ?? '',
        author: el.dataset.author ?? host?.querySelector('.learn-src')?.textContent?.trim() ?? '',
    };
}

const EXPLAIN = `## In my own words\n\n\n## What surprised me\n\n\n## Where I'd use this\n\n\n## Still unclear\n`;

document.addEventListener('click', async e => {
    const el = e.target as HTMLElement;

    const explain = el.closest<HTMLAnchorElement>('[data-gh-explain]');
    if (explain) {
        const c = context(explain);
        explain.href = noteUrl(`Understanding: ${c.title}`, EXPLAIN, c.url || undefined);
        return; // the link opens with the updated href
    }

    const fresh = el.closest<HTMLAnchorElement>('[data-gh-new]');
    if (fresh) {
        fresh.href = noteUrl('What I understood about …', '## In my own words\n\n');
        return;
    }

    const save = el.closest<HTMLButtonElement>('[data-gh-save]');
    if (save) {
        const c = context(save);
        const entry = `\n- id: ${slug(c.title)}\n  title: ${yamlStr(c.title)}\n  url: ${c.url}\n  author: ${yamlStr(c.author)}\n  kind: article\n  why: ${yamlStr('Why I kept this: …')}\n  added: ${today()}\n  tags: []\n`;
        try { await navigator.clipboard.writeText(entry); } catch {}
        save.textContent = 'Copied: paste at the end of the file';
        window.open(ghEditFile('src/content/library.yaml'), '_blank', 'noopener');
        setTimeout(() => (save.textContent = 'Save'), 4000);
    }
});
