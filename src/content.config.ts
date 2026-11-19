import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const tags = z.array(z.string().transform(t => t.toLowerCase().trim())).default([]);

// Notebook: one kind of entry. What I understood, in my own words.
const notes = defineCollection({
    loader: glob({ pattern: '**/[^_]*.md', base: './src/content/notes' }),
    schema: z.object({
        title: z.string(),
        date: z.coerce.date(),
        tags,
        source: z.string().url().optional(), // the piece this note is about
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
        weight: z.number().min(-2).max(2).default(0), // ranking nudge for this source (depth/quality)
    }),
});

// The Canon: foundational reads per learning track.
const canon = defineCollection({
    loader: file('./src/content/canon.yaml'),
    schema: z.object({
        track: z.enum(['research', 'systems', 'backend', 'ai-eng', 'ml', 'security', 'quant', 'macro', 'math', 'postmortems']),
        title: z.string(),
        author: z.string(),
        url: z.string().url(),
        kind: z.enum(['paper', 'article', 'book', 'video', 'course', 'docs']),
        minutes: z.number().int().positive(),
        why: z.string(),
        // Chapters or sittings of a long work, in reading order.
        parts: z.array(z.object({ title: z.string(), minutes: z.number().int().positive(), url: z.string().url().optional() })).optional(),
    }),
});

// The Roadmap: areas and topics to learn; articles are matched to topics at build time.
const roadmap = defineCollection({
    loader: file('./src/content/roadmap.yaml'),
    schema: z.object({
        n: z.number().int(),
        title: z.string(),
        track: z.string(),
        why: z.string(),
        topics: z.array(z.object({
            id: z.string(),
            name: z.string(),
            group: z.string().optional(),
            why: z.string().optional(),
            about: z.string().optional(),
        })),
    }),
});

export const collections = { notes, library, feeds, canon, roadmap };
