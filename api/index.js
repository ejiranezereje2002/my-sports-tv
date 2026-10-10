const API_URL = 'https://futbol-x.xyz';

const MANIFEST = {
    id: 'community.soccer-live-streams',
    version: '1.7.0', // Incremented version to force Stremio to clear its layout layout cache
    name: 'Live Soccer Streams',
    description: 'Live football streams from Futbol-X.',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    idPrefixes: ['fx_'],
    catalogs: [
        {
            type: 'tv',
            id: 'fx_football_catalog',
            name: 'Live Football Matches',
            extra: [
                { name: 'search', required: false }
            ],
            posterShape: 'landscape' 
        }
    ]
};

// HELPER FUNCTION: Fits ultra-wide banners into Stremio's strict 16:9 ratio boxes by letterboxing it with empty space
function formatLandscapePoster(posterUrl) {
    if (!posterUrl || posterUrl.trim() === '') {
        return 'https://placehold.co';
    }
    // Encodes your API image and wraps it in a layout-optimizer CDN that pads the borders instead of cropping them
    return `https://weserv.nl{encodeURIComponent(posterUrl)}&w=400&h=225&fit=contain&a=center&bg=transparent`;
}

async function fetchFootballData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) return [];
        const data = await response.json();
        return data.success ? data.streams?.streams || [] : [];
    } catch (error) {
        console.error('Error fetching football streams:', error);
        return [];
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    const urlParts = req.url.split('?');
    const urlPath = urlParts[0].replace('.json', '');

    try {
        // 1. Manifest Endpoint
        if (urlPath === '/manifest' || urlPath === '/' || urlPath === '') {
            return res.status(200).json(MANIFEST);
        }

        // 2. Catalog Endpoint
        if (urlPath.startsWith('/catalog/')) {
            const matches = await fetchFootballData();
            
            const metas = matches.map(match => ({
                id: `fx_${match.uri_name}`,
                type: 'tv',
                name: match.name,
                // Applied the auto-fit helper function here to preserve full team logos
                poster: formatLandscapePoster(match.poster),
                description: `League: ${match.tag} | Starts: ${new Date(match.starts_at).toLocaleString()}`,
                background: match.poster
            }));

            return res.status(200).json({ metas });
        }

        // 3. Meta Endpoint
        if (urlPath.startsWith('/meta/')) {
            const parts = urlPath.split('/');
            const id = parts[parts.length - 1];
            const targetUriName = id.replace('fx_', '');

            const matches = await fetchFootballData();
            const matchedGame = matches.find(match => match.uri_name === targetUriName);

            if (matchedGame) {
                return res.status(200).json({
                    meta: {
                        id: id,
                        type: 'tv',
                        name: matchedGame.name,
                        poster: formatLandscapePoster(matchedGame.poster),
                        posterShape: 'landscape',
                        description: `League: ${matchedGame.tag} | Live Event Streams`
                    }
                });
            }
            return res.status(404).json({ error: 'Meta not found' });
        }

        // 4. Stream Endpoint
        if (urlPath.startsWith('/stream/')) {
            const parts = urlPath.split('/');
            const id = parts[parts.length - 1]; 
            const targetUriName = id.replace('fx_', '');

            const matches = await fetchFootballData();
            const matchedGame = matches.find(match => match.uri_name === targetUriName);

            if (matchedGame && matchedGame.streams) {
                const streams = matchedGame.streams
                    .filter(s => s.url && s.url.trim() !== '')
                    .map(s => ({
                        title: `[${matchedGame.tag}] ${s.title}`,
                        url: s.url
                    }));

                return res.status(200).json({ streams });
            }

            return res.status(200).json({ streams: [] });
        }

        return res.status(404).json({ error: 'Not found' });

    } catch (error) {
        console.error('Serverless routing execution crash:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
