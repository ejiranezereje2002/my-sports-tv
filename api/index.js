const API_URL = 'https://www.futbol-x.xyz/api/football.json';

const MANIFEST = {
    id: 'community.soccer-live-streams',
    version: '1.5.0',
    name: 'Live Soccer Streams',
    description: 'Live football streams from Futbol-X.',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'], // Changed type to tv channels for instant one-click playing
    idPrefixes: ['fx_'],
    catalogs: [
        {
            type: 'tv',
            id: 'fx_football_catalog',
            name: 'Live Football Matches'
        }
    ]
};

async function fetchFootballData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) return [];
        const data = await response.json();
        return data.success ? data.streams?.[0]?.streams || [] : [];
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

        // 2. Catalog Endpoint (/catalog/tv/fx_football_catalog)
        if (urlPath.startsWith('/catalog/')) {
            const matches = await fetchFootballData();
            
            const metas = matches.map(match => ({
                id: `fx_${match.uri_name}`,
                type: 'tv',
                name: match.name,
                poster: match.poster || 'https://placehold.co',
                description: `League: ${match.tag} | Starts: ${new Date(match.starts_at).toLocaleString()}`,
                background: match.poster
            }));

            return res.status(200).json({ metas });
        }

        // 3. Meta Endpoint (/meta/tv/fx_matchid)
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
                        poster: matchedGame.poster,
                        description: `League: ${matchedGame.tag} | Live Event Streams`
                    }
                });
            }
            return res.status(404).json({ error: 'Meta not found' });
        }

        // 4. Stream Endpoint (/stream/tv/fx_matchid)
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
