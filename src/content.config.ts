import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const tags = z.array(z.string().transform(t => t.toLowerCase().trim())).default([]);

// Short, dated learnings. Mostly written by the /til command in Claude Code.
const log = defineCollection({
    loader: glob({ pattern: '**/[^_]*.md', base: './src/content/log' }),
    schema: z.object({
        title: z.string(),
        date: z.coerce.date(),
        tags,
        source: z.string().optional(), // e.g. "claude session · jobhunt-agent"
        draft: z.boolean().default(false),
    }),
});

// Evergreen, one page per topic. Grows as log entries get folded in.
const notes = defineCollection({
    loader: glob({ pattern: '**/[^_]*.md', base: './src/content/notes' }),
    schema: z.object({
        title: z.string(),
        summary: z.string().optional(),
        updated: z.coerce.date(),
        tags,
        draft: z.boolean().default(false),
    }),
});

// Occasional long-form posts.
const writing = defineCollection({
    loader: glob({ pattern: '**/[^_]*.md', base: './src/content/writing' }),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
        date: z.coerce.date(),
        tags,
        draft: z.boolean().default(false),
    }),
});

// Links worth keeping: one line on why.
const library = defineCollection({
    loader: file('./src/content/library.yaml'),
    schema: z.object({
        title: z.string(),
        url: z.string().url(),
        author: z.string().optional(),
        kind: z.enum(['article', 'video', 'talk', 'paper', 'repo', 'tool', 'book', 'thread']).default('article'),
        why: z.string(),
        added: z.coerce.date(),
        tags,
    }),
});

export const collections = { log, notes, writing, library };
