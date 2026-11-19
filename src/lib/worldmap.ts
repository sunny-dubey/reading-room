// A dotted world map, computed once at build time from Natural Earth land (world-atlas, 110m).
// Equirectangular, cropped to latitudes 78°N..56°S so the map isn't mostly ice.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { feature } from 'topojson-client';
import { geoContains } from 'd3-geo';

export const MAP_W = 1000;
const LAT_TOP = 78, LAT_BOTTOM = -56;
export const MAP_H = Math.round(MAP_W * (LAT_TOP - LAT_BOTTOM) / 360);

/** Map coordinates for a latitude/longitude. */
export const project = (lat: number, lon: number) => ({
    x: Math.round(((lon + 180) / 360) * MAP_W * 10) / 10,
    y: Math.round(((LAT_TOP - Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat))) / (LAT_TOP - LAT_BOTTOM)) * MAP_H * 10) / 10,
});

let cache: Promise<string> | undefined;
/** One SVG path drawing every land dot (round-capped zero-length segments). */
export const getWorldDots = (step = 2.4) => (cache ??= build(step));

async function build(step: number): Promise<string> {
    const file = `.cache/world-dots-${step}.txt`;
    try { return await readFile(file, 'utf8'); } catch {}
    const topo = JSON.parse(await readFile('node_modules/world-atlas/land-110m.json', 'utf8'));
    const land = feature(topo, topo.objects.land) as any;
    let d = '';
    for (let lat = LAT_TOP - step / 2; lat > LAT_BOTTOM; lat -= step) {
        for (let lon = -180 + step / 2; lon < 180; lon += step) {
            if (geoContains(land, [lon, lat])) {
                const { x, y } = project(lat, lon);
                d += `M${x} ${y}h0`;
            }
        }
    }
    try { await mkdir('.cache', { recursive: true }); await writeFile(file, d); } catch {}
    return d;
}
