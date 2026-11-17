import { getCollection, type CollectionEntry } from 'astro:content';

const visible = ({ data }: { data: { draft?: boolean } }) => import.meta.env.DEV || !data.draft;

export const getNotes = async () =>
    (await getCollection('notes', visible)).sort((a, b) => +b.data.date - +a.data.date);

export const getLibrary = async () =>
    (await getCollection('library')).sort((a, b) => +b.data.added - +a.data.added);

export async function getNoteTags(): Promise<[string, number][]> {
    const counts = new Map<string, number>();
    for (const n of await getNotes()) for (const t of n.data.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

export type Note = CollectionEntry<'notes'>;
