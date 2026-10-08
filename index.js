'use strict';

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const https = require('https');

// ---- CONFIG ----
const API_URL = 'https://bintvjson.lovable.app/api/public/bintvjson';
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const REQUEST_TIMEOUT = 12000;    // 12 seconds

// ---- SIMPLE MEMORY CACHE ----
let cache = { data: null, timestamp: 0 };

// ---- CUSTOM FETCH (works on every Node version, no deps) ----
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://bintvjson.lovable.app/'
            },
            timeout: REQUEST_TIMEOUT
        }, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpGet(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('Invalid JSON: ' + e.message));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);
    });
}

// ---- FETCH WITH CACHE + FALLBACK ----
async function getData() {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
        console.log('[BinTV] Cache hit');
        return cache.data;
    }

    console.log('[BinTV] Fetching fresh from API...');
    try {
        const data = await httpGet(API_URL);
        if (!data || typeof data !== 'object') throw new Error('Empty API response');
        cache = { data, timestamp: now };
        console.log(`[BinTV] OK: live=${data.counts?.live} upcoming=${data.counts?.upcoming} channels=${data.counts?.channels}`);
        return data;
    } catch (err) {
        console.error('[BinTV] API fetch failed:', err.message);
        if (cache.data) {
            console.warn('[BinTV] Using stale cache');
            return cache.data;
        }
        // Return safe empty structure so server NEVER crashes
        return {
            success: false,
            counts: { live: 0, upcoming: 0, channels: 0 },
            'Live Events': [],
            'Upcoming Events': [],
            '24/7 Channels': []
        };
    }
}

// ---- HELPERS ----
function cleanUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.replace(/&amp;/g, '&').trim();
}

// ---- ADDON BUILDER ----
const builder = new addonBuilder(require('./manifest.json'));

// ---- CATALOG HANDLER ----
builder.defineCatalogHandler(async (args) => {
    const { id, extra } = args;
    const genre = extra && extra.genre ? extra.genre : null;
    console.log(`[BinTV] Catalog: id=${id} genre=${genre}`);

    try {
        const data = await getData();
        let items = [];

        if (id === 'live') {
            items = data['Live Events'] || [];
        } else if (id === 'upcoming') {
            items = data['Upcoming Events'] || [];
        } else if (id === 'channels') {
            items = data['24/7 Channels'] || [];
        }

        if (genre && genre !== 'All') {
            items = items.filter(i => i.category === genre);
        }

        const metas = items.map(item => ({
            id: `bintv:${item.id}`,
            type: 'sports',
            name: item.name || 'Unknown Event',
            poster: cleanUrl(item.poster),
            posterShape: 'landscape',
            description: `${item.category || 'Sports'} • ${item.status || ''}`,
            genres: item.category ? [item.category] : []
        }));

        console.log(`[BinTV] Returning ${metas.length} metas`);
        return { metas };
    } catch (err) {
        console.error('[BinTV] Catalog handler error:', err);
        return { metas: [] };
    }
});

// ---- STREAM HANDLER ----
builder.defineStreamHandler(async (args) => {
    const { id } = args;
    console.log(`[BinTV] Stream request: ${id}`);

    if (!id || !id.startsWith('bintv:')) {
        return { streams: [] };
    }

    const eventId = id.substring('bintv:'.length);

    try {
        const data = await getData();
        const all = [
            ...(data['Live Events'] || []),
            ...(data['Upcoming Events'] || []),
            ...(data['24/7 Channels'] || [])
        ];

        const event = all.find(e => e.id === eventId);
        if (!event) {
            console.warn(`[BinTV] Event not found: ${eventId}`);
            return { streams: [] };
        }

        const streams = (event.streams || []).map(s => ({
            title: `${s.name || 'Stream'}\n${event.name || ''}`,
            name: s.name || 'Stream',
            url: cleanUrl(s.url),
            behaviorHints: { notWebReady: false }
        }));

        console.log(`[BinTV] Returning ${streams.length} streams`);
        return { streams };
    } catch (err) {
        console.error('[BinTV] Stream handler error:', err);
        return { streams: [] };
    }
});

// ---- EXPORT ----
module.exports = builder.getInterface();
