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
        source: z.string().optional(), // optional, not shown on the site
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

// RSS/Atom feeds read on the Reading tab.
const feeds = defineCollection({
    loader: file('./src/content/feeds.yaml'),
    schema: z.object({
        title: z.string(),
        url: z.string().url(),
        site: z.string().url().optional(),
        category: z.string().default('other'),
        limit: z.number().int().positive().default(8),
        maxAgeDays: z.number().int().positive().default(45),
        type: z.enum(['rss', 'bluesky', 'reddit']).default('rss'),
        perSub: z.number().int().positive().default(3), // reddit only: max posts per subreddit
        minLikes: z.number().int().nonnegative().default(15), // bluesky only
    }),
});

// The Canon: foundational reads per learning track.
const canon = defineCollection({
    loader: file('./src/content/canon.yaml'),
    schema: z.object({
        track: z.enum(['systems', 'backend', 'ai-eng', 'ml', 'postmortems']),
        title: z.string(),
        author: z.string(),
        url: z.string().url(),
        kind: z.enum(['paper', 'article', 'book', 'video', 'course', 'docs']),
        minutes: z.number().int().positive(),
        why: z.string(),
    }),
});

export const collections = { log, notes, writing, library, feeds, canon };
