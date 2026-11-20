import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// PNG app icons (manifest + apple-touch-icon), rendered from public/icon.svg at build.
export function getStaticPaths() {
    return ['180', '192', '512'].map(size => ({ params: { size } }));
}

export async function GET({ params }: { params: { size: string } }) {
    const n = Number(params.size);
    const svg = await readFile(join(process.cwd(), 'public/icon.svg'));
    const png = await sharp(svg, { density: 300 }).resize(n, n).flatten({ background: '#f4f3f1' }).png().toBuffer();
    return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
}
