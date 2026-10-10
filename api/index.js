import addon from '../addon.js';

export default async function handler(req, res) {
    // Set mandatory CORS headers required by Stremio
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    // Standard Vercel req.url looks like: /manifest.json or /stream/movie/fx_abc.json
    const urlPath = req.url;

    try {
        // 1. Handle Manifest Requests
        if (urlPath === '/manifest.json' || urlPath === '/') {
            return res.status(200).json(addon.getManifest());
        }

        // 2. Handle Catalog Requests (/catalog/movie/fx_football_catalog.json)
        if (urlPath.startsWith('/catalog/')) {
            const parts = urlPath.replace('.json', '').split('/');
            const type = parts[2];
            const id = parts[3];
            
            const result = await addon.get('catalog', type, id);
            return res.status(200).json(result);
        }

        // 3. Handle Stream Requests (/stream/movie/fx_matchid.json)
        if (urlPath.startsWith('/stream/')) {
            const parts = urlPath.replace('.json', '').split('/');
            const type = parts[2];
            const id = parts[3];
            
            const result = await addon.get('stream', type, id);
            return res.status(200).json(result);
        }

        // 4. Return empty 404 for unsupported paths
        return res.status(404).json({ error: 'Not found' });

    } catch (error) {
        console.error('Error handling request:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
