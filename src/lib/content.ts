import { getCollection, type CollectionEntry } from 'astro:content';

const visible = ({ data }: { data: { draft?: boolean } }) =>
    import.meta.env.DEV || !data.draft;

export const getLog = async () =>
    (await getCollection('log', visible)).sort((a, b) => +b.data.date - +a.data.date);

export const getNotes = async () =>
    (await getCollection('notes', visible)).sort((a, b) => +b.data.updated - +a.data.updated);

export const getWriting = async () =>
    (await getCollection('writing', visible)).sort((a, b) => +b.data.date - +a.data.date);

export const getLibrary = async () =>
    (await getCollection('library')).sort((a, b) => +b.data.added - +a.data.added);

export type Kind = 'log' | 'note' | 'writing' | 'library';

export interface Item {
    kind: Kind;
    title: string;
    href: string;
    date: Date;
    tags: string[];
    external?: boolean;
    blurb?: string;
}

export async function getAllItems(): Promise<Item[]> {
    const [log, notes, writing, library] = await Promise.all([getLog(), getNotes(), getWriting(), getLibrary()]);
    const items: Item[] = [
        ...log.map(e => ({ kind: 'log' as const, title: e.data.title, href: `/log/${e.id}/`, date: e.data.date, tags: e.data.tags })),
        ...notes.map(e => ({ kind: 'note' as const, title: e.data.title, href: `/notes/${e.id}/`, date: e.data.updated, tags: e.data.tags, blurb: e.data.summary })),
        ...writing.map(e => ({ kind: 'writing' as const, title: e.data.title, href: `/writing/${e.id}/`, date: e.data.date, tags: e.data.tags, blurb: e.data.description })),
        ...library.map(e => ({ kind: 'library' as const, title: e.data.title, href: e.data.url, date: e.data.added, tags: e.data.tags, external: true, blurb: e.data.why })),
    ];
    return items.sort((a, b) => +b.date - +a.date);
}

export async function getTagCounts(): Promise<[string, number][]> {
    const counts = new Map<string, number>();
    for (const item of await getAllItems())
        for (const t of item.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

export const fmtMonth = (d: Date) =>
    d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });

export type { CollectionEntry };
