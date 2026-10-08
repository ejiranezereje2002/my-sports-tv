'use strict';

const https = require('https');
const manifest = require('./manifest.json');

// ---- CONFIG ----
const API_URL = 'https://bintvjson.lovable.app/api/public/bintvjson';
const CACHE_TTL = 3 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

// ---- MEMORY CACHE ----
let cache = { data: null, timestamp: 0 };

// ---- NATIVE HTTPS FETCH (no deps) ----
function httpGet(url, depth = 0) {
    if (depth > 5) return Promise.reject(new Error('Too many redirects'));
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
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpGet(res.headers.location, depth + 1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error('Invalid JSON')); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
    });
}

async function getData() {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
        console.log('[BinTV] cache hit');
        return cache.data;
    }
    console.log('[BinTV] fetching fresh');
    try {
        const data = await httpGet(API_URL);
        if (!data || typeof data !== 'object') throw new Error('Empty response');
        cache = { data, timestamp: now };
        console.log(`[BinTV] OK live=${data.counts?.live} upcoming=${data.counts?.upcoming} channels=${data.counts?.channels}`);
        return data;
    } catch (err) {
        console.error('[BinTV] fetch failed:', err.message);
        if (cache.data) return cache.data;
        return {
            success: false,
            counts: { live: 0, upcoming: 0, channels: 0 },
            'Live Events': [],
            'Upcoming Events': [],
            '24/7 Channels': []
        };
    }
}

function cleanUrl(u) {
    if (!u || typeof u !== 'string') return '';
    return u.replace(/&amp;/g, '&').trim();
}

// ---- HANDLERS ----
async function handleManifest(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify(manifest));
}

async function handleCatalog(req, res, type, id) {
    // Parse genre from query string (?genre=Basketball)
    const urlObj = new URL(req.url, 'http://x');
    const genre = urlObj.searchParams.get('genre');

    console.log(`[BinTV] catalog type=${type} id=${id} genre=${genre}`);

    try {
        const data = await getData();
        let items = [];
        if (id === 'live') items = data['Live Events'] || [];
        else if (id === 'upcoming') items = data['Upcoming Events'] || [];
        else if (id === 'channels') items = data['24/7 Channels'] || [];

        if (genre && genre !== 'All') items = items.filter(i => i.category === genre);

        const metas = items.map(item => ({
            id: `bintv:${item.id}`,
            type: 'channel',
            name: item.name || 'Unknown Event',
            poster: cleanUrl(item.poster),
            posterShape: 'landscape',
            description: `${item.category || 'Sports'} • ${item.status || ''}`,
            genres: item.category ? [item.category] : []
        }));

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ metas }));
    } catch (err) {
        console.error('[BinTV] catalog error:', err.message);
        res.statusCode = 200;
        res.end(JSON.stringify({ metas: [] }));
    }
}

async function handleStream(req, res, type, id) {
    console.log(`[BinTV] stream type=${type} id=${id}`);
    try {
        if (!id.startsWith('bintv:')) {
            return res.end(JSON.stringify({ streams: [] }));
        }
        const eventId = id.substring('bintv:'.length);
        const data = await getData();
        const all = [
            ...(data['Live Events'] || []),
            ...(data['Upcoming Events'] || []),
            ...(data['24/7 Channels'] || [])
        ];
        const event = all.find(e => e.id === eventId);
        if (!event) {
            return res.end(JSON.stringify({ streams: [] }));
        }
        const streams = (event.streams || []).map(s => ({
            title: `${s.name || 'Stream'}\n${event.name || ''}`,
            name: s.name || 'Stream',
            url: cleanUrl(s.url),
            behaviorHints: { notWebReady: false }
        }));
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ streams }));
    } catch (err) {
        console.error('[BinTV] stream error:', err.message);
        res.end(JSON.stringify({ streams: [] }));
    }
}

// ---- ROUTER ----
async function router(req, res) {
    const urlObj = new URL(req.url, 'http://x');
    const path = urlObj.pathname.replace(/\.json$/, '');
    const parts = path.split('/').filter(Boolean);

    console.log(`[BinTV] ${req.method} ${req.url}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.statusCode = 204;
        return res.end();
    }

    try {
        if (parts.length === 0 || parts[0] === 'manifest') {
            return await handleManifest(req, res);
        }
        if (parts[0] === 'catalog' && parts.length >= 3) {
            // /catalog/:type/:id.json
            return await handleCatalog(req, res, parts[1], parts[2]);
        }
        if (parts[0] === 'stream' && parts.length >= 3) {
            // /stream/:type/:id.json
            return await handleStream(req, res, parts[1], parts[2]);
        }
        // Fallback — root returns manifest so users visiting / work
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(manifest));
    } catch (err) {
        console.error('[BinTV] router fatal:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ err: 'Internal error', message: err.message }));
    }
}

// ---- VERCEL DEFAULT EXPORT ----
module.exports = router;
module.exports.default = router;
