const { addonBuilder } = require('stremio-addon-sdk');

const API_URL = 'https://bintvjson.lovable.app/api/public/bintvjson';

// Simple in-memory cache (5 minutes)
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

// Fetch with headers + caching
async function fetchData() {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
        console.log('[BinTV] Returning cached data');
        return cache.data;
    }

    console.log('[BinTV] Fetching fresh data from API...');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(API_URL, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Stremio-Addon/1.0)',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            },
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        cache = { data, timestamp: now };
        console.log(`[BinTV] Fetched OK. Live: ${data.counts?.live}, Upcoming: ${data.counts?.upcoming}, Channels: ${data.counts?.channels}`);
        return data;
    } catch (err) {
        clearTimeout(timeout);
        console.error('[BinTV] Fetch error:', err.message);
        // Return stale cache if available
        if (cache.data) {
            console.warn('[BinTV] Returning stale cache due to error');
            return cache.data;
        }
        throw err;
    }
}

// Clean up HTML entities like &amp; in URLs
function cleanUrl(url) {
    if (!url) return url;
    return url.replace(/&amp;/g, '&');
}

const builder = new addonBuilder(require('./manifest.json'));

// ---- CATALOG HANDLER ----
builder.defineCatalogHandler(async (args) => {
    const { id, extra } = args;
    const genre = extra?.genre || null;

    console.log(`[BinTV] Catalog request: id=${id}, genre=${genre}`);

    try {
        const data = await fetchData();
        let items = [];

        if (id === 'live') {
            items = data['Live Events'] || [];
        } else if (id === 'upcoming') {
            items = data['Upcoming Events'] || [];
        }

        if (genre) {
            items = items.filter(item => item.category === genre);
        }

        const metas = items.map(item => ({
            id: `bintv:${item.id}`,
            type: 'sports',
            name: item.name,
            poster: cleanUrl(item.poster),
            posterShape: 'landscape',
            description: `${item.category || 'Sports'} • Status: ${item.status || 'N/A'}`,
            genres: item.category ? [item.category] : []
        }));

        console.log(`[BinTV] Returning ${metas.length} items`);
        return { metas };
    } catch (error) {
        console.error('[BinTV] Catalog error:', error.message);
        return { metas: [] };
    }
});

// ---- STREAM HANDLER ----
builder.defineStreamHandler(async (args) => {
    const { id } = args;

    if (!id.startsWith('bintv:')) {
        return { streams: [] };
    }

    const eventId = id.substring('bintv:'.length);
    console.log(`[BinTV] Stream request for event: ${eventId}`);

    try {
        const data = await fetchData();
        const allEvents = [
            ...(data['Live Events'] || []),
            ...(data['Upcoming Events'] || []),
            ...(data['24/7 Channels'] || [])
        ];

        const event = allEvents.find(e => e.id === eventId);
        if (!event) {
            console.warn(`[BinTV] Event not found: ${eventId}`);
            return { streams: [] };
        }

        const streams = (event.streams || []).map(stream => ({
            title: `${stream.name}\n${event.name}`,
            name: stream.name,
            url: cleanUrl(stream.url),
            behaviorHints: {
                notWebReady: false
            }
        }));

        console.log(`[BinTV] Returning ${streams.length} streams`);
        return { streams };
    } catch (error) {
        console.error('[BinTV] Stream error:', error.message);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
