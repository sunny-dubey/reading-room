import { XMLParser } from 'fast-xml-parser';
const p = new XMLParser({ ignoreAttributes: false });
await Promise.all(process.argv.slice(2).map(async u => {
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (reading-room status check)' }, signal: AbortSignal.timeout(15000) });
    const t = await r.text(); const x = p.parse(t);
    const items = x.rss?.channel?.item ?? x.feed?.entry ?? [];
    const arr = Array.isArray(items) ? items : [items];
    const d = arr.map(i => new Date(i.pubDate ?? i.published ?? i.updated ?? 0)).filter(d=>+d>0).sort((a,b)=>b-a);
    const recent = d.filter(x => Date.now()-x < 30*864e5).length;
    console.log(`${r.status} n=${arr.length} 30d=${recent} latest=${d[0]?.toISOString().slice(0,10)} ${u}`);
  } catch (e) { console.log(`ERR ${e.message.slice(0,40)} ${u}`); }
}));
