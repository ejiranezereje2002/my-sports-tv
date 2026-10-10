import addonSdk from 'stremio-addon-sdk';
const { createAddon } = addonSdk;

const API_URL = 'https://futbol-x.xyz';

// ... keep all the rest of your soccer stream code exactly the same below this line ...

async function fetchFootballData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) return null;
        const data = await response.json();
        return data.success ? data.streams[0]?.streams || [] : [];
    } catch (error) {
        console.error('Error fetching football streams:', error);
        return [];
    }
}

const addon = createAddon({
    manifest: {
        id: 'community.soccer-live-streams',
        version: '1.0.0',
        name: 'Live Soccer Streams',
        description: 'Live football streams from Futbol-X.',
        resources: ['catalog', 'stream'], 
        types: ['movie'], // Using 'movie' type so matches stand out as standalone media titles
        idPrefixes: ['fx_'], // Unique ID prefix to parse specific match streams
        catalogs: [
            {
                type: 'movie',
                id: 'fx_football_catalog',
                name: 'Live Football Matches'
            }
        ]
    }
});

// 1. Populate the Stremio catalog home screen with upcoming matches
addon.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'movie' && id === 'fx_football_catalog') {
        const matches = await fetchFootballData();
        
        const metas = matches.map(match => ({
            id: `fx_${match.uri_name}`, // Example: fx_a4v1l8
            type: 'movie',
            name: match.name,
            poster: match.poster || 'https://placehold.co',
            description: `League: ${match.tag} | Starts: ${new Date(match.starts_at).toLocaleString()}`,
            releaseInfo: match.tag
        }));

        return { metas };
    }
    return { metas: [] };
});

// 2. Resolve streams dynamically when a user clicks on a catalog match
addon.defineStreamHandler(async ({ type, id }) => {
    if (type === 'movie' && id.startsWith('fx_')) {
        const targetUriName = id.replace('fx_', ''); // Strips prefix to match 'uri_name'
        const matches = await fetchFootballData();
        
        // Find the match corresponding to the item the user clicked
        const matchedGame = matches.find(match => match.uri_name === targetUriName);
        
        if (matchedGame && matchedGame.streams) {
            // Filter out streams that don't have an active URL assigned yet
            const streams = matchedGame.streams
                .filter(s => s.url && s.url.trim() !== '')
                .map(s => ({
                    title: `[${matchedGame.tag}] ${s.title}`,
                    // Uses URL or re-routes an embed depending on Stremio player compatibility
                    url: s.url 
                }));

            return { streams };
        }
    }
    return { streams: [] };
});

export default addon;
