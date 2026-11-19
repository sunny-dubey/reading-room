// Today's edition as data: what the AI editor (scripts/ai-edition.mjs) reads to write the editor's note.
// Public and harmless: it only lists what's already on the front page.
import { getReading } from '../lib/reading';
import { getToday } from '../lib/today';
import { getPuzzles } from '../lib/puzzles';
import { getBriefing } from '../lib/briefing';
import { getOutages, internetWeather, fmtDuration } from '../lib/outages';
import { categoryShort } from '../lib/feeds';
import { editionName, istDate } from '../lib/edition';

export async function GET() {
    const r = await getReading();
    const t = await getToday();
    const pz = await getPuzzles();
    const bf = await getBriefing();
    const out = await getOutages();
    const wx = internetWeather(out.incidents, out.now);
    const story = (i: any) => ({ title: i.title, source: i.feedTitle, track: categoryShort(i.category), minutes: i.brief?.minutes, topic: i.skill?.topic?.name, url: i.link });
    const date = new Date(+r.fetchedAt + 5.5 * 3600e3).toISOString().slice(0, 10); // the edition's date in IST
    const data = {
        date,
        edition: `${istDate(r.fetchedAt)} · ${editionName(r.fetchedAt)} edition`,
        lead: r.deepRead ? { ...story(r.deepRead), why: r.deepRead.skill?.topic?.why, buildsOn: r.deepRead.classic?.title } : null,
        fresh: r.fresh.map(story),
        rabbitHole: t.rabbitHoles[0] ? { topic: t.rabbitHoles[0].topic.name, steps: t.rabbitHoles[0].steps.map(s => s.title) } : null,
        twoTakes: t.twoTakes ? { topic: t.twoTakes.topic.name, a: story(t.twoTakes.a), b: story(t.twoTakes.b) } : null,
        question: t.question?.q,
        puzzle: pz.today ? { title: pz.today.title, type: pz.today.type } : null,
        weather: wx.line,
        outages: { thisWeek: out.stats.week, ongoing: out.stats.ongoing, investigation: out.featured ? { provider: out.featured.provider, title: out.featured.title, where: out.featured.places.map(p => p.name).join(', ') || 'global', lasted: fmtDuration(out.featured.duration) } : null },
        cves: bf.cves.slice(0, 5).map(c => ({ id: c.id, what: `${c.vendor} ${c.product}`, name: c.name, ransomware: c.ransomware })),
        releases: bf.releases.slice(0, 6).map(x => `${x.product} ${x.version}${x.newCycle ? ' (new major)' : ''}`),
        endOfLife: bf.eols.filter(e => e.days >= 0).slice(0, 4).map(e => `${e.product} ${e.cycle} in ${e.days} days`),
        papers: bf.papers.slice(0, 4).map(p => ({ title: p.title, topic: p.topic?.name })),
        postmortem: r.postmortem ? story(r.postmortem) : null,
    };
    return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
