import { u } from '../lib/url';

// Makes the site installable (home screen / app window). Icons come from icon-[size].png.ts.
export function GET() {
    const manifest = {
        name: 'The Reading Room',
        short_name: 'Reading Room',
        description: 'A daily front page for understanding systems, AI, ML, security and markets.',
        start_url: u('/'),
        scope: u('/'),
        display: 'standalone',
        background_color: '#f4f3f1',
        theme_color: '#f4f3f1',
        icons: [
            { src: u('/icon.svg'), sizes: 'any', type: 'image/svg+xml' },
            { src: u('/icon-192.png'), sizes: '192x192', type: 'image/png' },
            { src: u('/icon-512.png'), sizes: '512x512', type: 'image/png' },
        ],
    };
    return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
}
