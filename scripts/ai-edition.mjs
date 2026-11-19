#!/usr/bin/env node
// AI features for the edition, run LOCALLY with your own key (the public site never calls Claude).
// Writes src/content/ai/<date>.json, which you commit and push; the site shows it with its date.
//
//   node scripts/ai-edition.mjs            write today's AI content if it doesn't exist yet
//   node scripts/ai-edition.mjs --force    rewrite today's
//   AI_FEATURES=off / --no-ai              skip entirely
//
// Two ways to reach Claude (AI_BACKEND=api | cli, default: whichever is available, API first):
//   api  ANTHROPIC_API_KEY in a git-ignored .env (see .env.example); pay-per-use on the Claude API.
//   cli  your local Claude Code (`claude` on PATH, logged in); runs on your Claude subscription. Local use only.
// Reads dist/edition.json, so build first.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import Anthropic from '@anthropic-ai/sdk';

try { process.loadEnvFile('.env'); } catch {} // optional local .env

const args = new Set(process.argv.slice(2));
const MODEL = 'claude-opus-5-5';
const PRICE = { in: 4 / 1e6, out: 20 / 1e6 };             // $ per token, Claude Opus 5.5
const CAP_USD = Number(process.env.AI_MAX_USD_PER_RUN ?? 0.5); // refuse to run a request estimated above this

function skip(msg) { console.log(`AI: ${msg}`); process.exit(0); }
if (args.has('--no-ai') || /^(off|0|false|no)$/i.test(process.env.AI_FEATURES ?? '')) skip('switched off (AI_FEATURES=off or --no-ai); nothing generated.');
const hasCli = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
const wanted = (process.env.AI_BACKEND ?? 'auto').toLowerCase();
const backend = wanted === 'api' || wanted === 'cli' ? wanted : process.env.ANTHROPIC_API_KEY ? 'api' : hasCli ? 'cli' : null;
if (!backend) skip('no ANTHROPIC_API_KEY in .env and no `claude` CLI found; skipping AI features (the edition is complete without them).');
if (backend === 'api' && !process.env.ANTHROPIC_API_KEY) skip('AI_BACKEND=api but no ANTHROPIC_API_KEY in .env.');
if (backend === 'cli' && !hasCli) skip('AI_BACKEND=cli but the `claude` CLI is not on PATH.');
if (!existsSync('dist/edition.json')) skip('dist/edition.json missing; run the build first.');

const edition = JSON.parse(readFileSync('dist/edition.json', 'utf8'));
const dir = 'src/content/ai';
const file = `${dir}/${edition.date}.json`;
if (existsSync(file) && !args.has('--force')) skip(`today's AI content already exists (${file}); use --force to rewrite.`);

const SYSTEM = `You are the editor of The Reading Room, a daily newspaper for software engineers who want to understand, not skim.
Write today's editor's note from the edition data you're given. Rules:
- Use only facts in the data. Never invent numbers, quotes, causes or events. If something isn't in the data, leave it out.
- Name the specific pieces (titles, providers, products) so the reader knows where to go.
- Tie the day together around one idea worth understanding: what links the lead story, the outages or exploits, and the papers.
- Plain, confident sentences. No hype, no exclamation marks, no "in today's fast-paced world", no emojis.
- headline: at most 9 words. body: 3 or 4 sentences, at most 90 words. focus: one sentence starting "If you read one thing:".`;

const schema = {
    type: 'object',
    properties: {
        headline: { type: 'string' },
        body: { type: 'string' },
        focus: { type: 'string' },
    },
    required: ['headline', 'body', 'focus'],
    additionalProperties: false,
};

async function viaApi() {
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY
    const request = {
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Edition data (JSON):\n${JSON.stringify(edition)}` }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    };

    // Spend guard: estimate the input before sending.
    try {
        const { input_tokens } = await client.messages.countTokens({ model: MODEL, system: SYSTEM, messages: request.messages });
        const est = input_tokens * PRICE.in + request.max_tokens * PRICE.out;
        if (est > CAP_USD) skip(`estimated cost $${est.toFixed(3)} is above the cap of $${CAP_USD} (AI_MAX_USD_PER_RUN); not sent.`);
    } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) skip('the API key was rejected (check ANTHROPIC_API_KEY in .env).');
        console.warn(`AI: couldn't count tokens (${err.message}); continuing with the per-run cap enforced by max_tokens.`);
    }

    let response;
    try {
        // If a safety classifier declines, let the API retry on its recommended fallback model.
        response = await client.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) skip('the API key was rejected (check ANTHROPIC_API_KEY in .env).');
        if (err instanceof Anthropic.RateLimitError) skip('rate limited; try again in a minute.');
        if (err instanceof Anthropic.APIError) skip(`API error ${err.status}: ${err.message}`);
        throw err;
    }
    if (response.stop_reason === 'refusal') skip(`the model declined (${response.stop_details?.category ?? 'no category'}); nothing written.`);
    if (response.stop_reason === 'max_tokens') skip('the response was cut off at max_tokens; nothing written.');

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let note;
    try { note = JSON.parse(text); } catch { skip('the response was not valid JSON; nothing written.'); }
    return { note, model: response.model, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens, usd: response.usage.input_tokens * PRICE.in + response.usage.output_tokens * PRICE.out } };
}

// Claude Code in print mode: no tools, no saved session, structured output, a budget cap.
// Runs from a temp directory so the repo's CLAUDE.md isn't loaded into the prompt.
function viaCli() {
    const res = spawnSync('claude', [
        '-p', `Edition data (JSON):\n${JSON.stringify(edition)}`,
        '--system-prompt', SYSTEM,
        '--output-format', 'json',
        '--json-schema', JSON.stringify(schema),
        '--tools', '',
        '--no-session-persistence',
        '--model', MODEL,
        '--max-budget-usd', String(CAP_USD),
    ], { encoding: 'utf8', cwd: tmpdir(), maxBuffer: 20 * 1024 * 1024, timeout: 5 * 60_000 });
    if (res.error) skip(`couldn't run the claude CLI (${res.error.message}).`);
    let out;
    try { out = JSON.parse(res.stdout); } catch { skip(`the claude CLI returned no JSON (exit ${res.status}): ${(res.stderr || res.stdout).slice(0, 300)}`); }
    if (out.is_error || out.subtype !== 'success') skip(`the claude CLI reported an error (${out.subtype ?? 'unknown'}): ${String(out.result ?? '').slice(0, 300)}`);
    const note = out.structured_output ?? (() => { try { return JSON.parse(out.result); } catch { return null; } })();
    if (!note?.headline) skip('the claude CLI response had no editor\'s note; nothing written.');
    const u = out.usage ?? {};
    return { note, model: Object.keys(out.modelUsage ?? {})[0] ?? MODEL, usage: { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, usd: out.total_cost_usd ?? 0 } };
}

const { note, model, usage } = backend === 'api' ? await viaApi() : viaCli();
const cost = usage.usd;
mkdirSync(dir, { recursive: true });
writeFileSync(file, JSON.stringify({
    date: edition.date,
    generatedAt: new Date().toISOString(),
    model,
    backend,
    editorsNote: note,
    usage: { input: usage.input, output: usage.output, usd: Math.round(cost * 1e4) / 1e4 },
}, null, 2) + '\n');
console.log(`AI: wrote ${file} with ${model} via ${backend === 'api' ? 'the Claude API' : 'your Claude CLI'} (${usage.input} in / ${usage.output} out, ${backend === 'api' ? 'about' : 'list-price equivalent'} $${cost.toFixed(3)}${backend === 'cli' ? ', counted against your subscription' : ''}).`);
console.log(`AI: "${note.headline}"`);
process.exit(10); // tells `npm run edition` to rebuild so the note appears
