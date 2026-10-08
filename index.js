'use strict';

const https = require('https');
const http = require('http');
const manifest = require('./manifest.json');

const API_URL = 'https://bintvjson.lovable.app/api/public/bintvjson';
const CACHE_TTL = 3 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

const UPSTREAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
    'Origin': 'https://grandemx.org',
    'Referer': 'https://grandemx.org/',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity'
};

let cache = { data: null, timestamp: 0 };

function httpGet(url, depth = 0) {
    if (depth > 5) return Promise.reject(new Error('Too many redirects'));
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': UPSTREAM_HEADERS['User-Agent'],
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://bintvjson.lovable.app/'
            },
            timeout: REQUEST_TIMEOUT
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpGet(res.headers.location, depth + 1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
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
    if (cache.data && (now - cache.timestamp) < CACHE_TTL) return cache.data;
    console.log('[BinTV] fetching fresh');
    try {
        const data = await httpGet(API_URL);
        cache = { data, timestamp: now };
        console.log(`[BinTV] OK live=${data.counts?.live} upcoming=${data.counts?.upcoming} channels=${data.counts?.channels}`);
        return data;
    } catch (err) {
        console.error('[BinTV] fetch failed:', err.message);
        if (cache.data) return cache.data;
        return { 'Live Events': [], 'Upcoming Events': [], '24/7 Channels': [] };
    }
}

function cleanUrl(u) {
    if (!u || typeof u !== 'string') return '';
    return u.replace(/&amp;/g, '&').trim();
}

function findEvent(data, eventId) {
    const all = [
        ...(data['Live Events'] || []),
        ...(data['Upcoming Events'] || []),
        ...(data['24/7 Channels'] || [])
    ];
    return all.find(e => e.id === eventId);
}

// ---- MANIFEST ----
async function handleManifest(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify(manifest));
}

// ---- CATALOG ----
async function handleCatalog(req, res, type, id) {
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
            type: 'movie',
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
        res.end(JSON.stringify({ metas: [] }));
    }
}

// ---- META (required for movie type) ----
async function handleMeta(req, res, type, id) {
    console.log(`[BinTV] meta type=${type} id=${id}`);
    try {
        if (!id.startsWith('bintv:')) return res.end(JSON.stringify({ meta: null }));
        const eventId = id.substring('bintv:'.length);
        const data = await getData();
        const event = findEvent(data, eventId);
        if (!event) return res.end(JSON.stringify({ meta: null }));

        const meta = {
            id: id,
            type: 'movie',
            name: event.name || 'Unknown Event',
            poster: cleanUrl(event.poster),
            posterShape: 'landscape',
            background: cleanUrl(event.poster),
            description: `${event.category || 'Sports'}\n\nStatus: ${event.status || 'N/A'}`,
            genres: event.category ? [event.category] : [],
            releaseInfo: event.status || '',
            videos: [] // required field, even if empty
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ meta }));
    } catch (err) {
        console.error('[BinTV] meta error:', err.message);
        res.end(JSON.stringify({ meta: null }));
    }
}

// ---- STREAM ----
async function handleStream(req, res, type, id) {
    console.log(`[BinTV] stream type=${type} id=${id}`);
    try {
        if (!id.startsWith('bintv:')) return res.end(JSON.stringify({ streams: [] }));
        const eventId = id.substring('bintv:'.length);
        const data = await getData();
        const event = findEvent(data, eventId);
        if (!event) return res.end(JSON.stringify({ streams: [] }));

        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = req.headers['x-forwarded-proto'] || 'https';

        const streams = (event.streams || []).map(s => {
            const originalUrl = cleanUrl(s.url);
            const proxiedUrl = `${proto}://${host}/proxy?url=${encodeURIComponent(originalUrl)}`;
            return {
                title: `${s.name || 'Stream'}\n${event.name || ''}`,
                name: s.name || 'Stream',
                url: proxiedUrl,
                behaviorHints: {
                    notWebReady: false,
                    proxyHeaders: {
                        request: {
                            'User-Agent': UPSTREAM_HEADERS['User-Agent'],
                            'Origin': UPSTREAM_HEADERS['Origin'],
                            'Referer': UPSTREAM_HEADERS['Referer']
                        }
                    }
                }
            };
        });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ streams }));
    } catch (err) {
        console.error('[BinTV] stream error:', err.message);
        res.end(JSON.stringify({ streams: [] }));
    }
}

// ---- PROXY ----
function handleProxy(req, res) {
    const urlObj = new URL(req.url, 'http://x');
    const target = urlObj.searchParams.get('url');
    if (!target) { res.statusCode = 400; return res.end('Missing url param'); }

    let parsed;
    try { parsed = new URL(target); } catch { res.statusCode = 400; return res.end('Invalid url'); }

    const allowedHosts = ['bintv-sources.pages.dev', 'grandemx.org', 'exmxbxe.cfd'];
    if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
        res.statusCode = 403; return res.end('Host not allowed');
    }

    const upstreamPath = parsed.pathname + (parsed.search || '');
    console.log(`[BinTV] proxy -> ${parsed.hostname}${upstreamPath}`);

    const lib = parsed.protocol === 'https:' ? https : http;
    const proxyReq = lib.get({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: upstreamPath,
        method: 'GET',
        headers: UPSTREAM_HEADERS
    }, (upstream) => {
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
            const loc = upstream.headers.location.startsWith('http')
                ? upstream.headers.location
                : new URL(upstream.headers.location, target).toString();
            const host = req.headers['x-forwarded-host'] || req.headers.host;
            const proto = req.headers['x-forwarded-proto'] || 'https';
            res.statusCode = 302;
            res.setHeader('Location', `${proto}://${host}/proxy?url=${encodeURIComponent(loc)}`);
            return res.end();
        }
        res.statusCode = upstream.statusCode;
        const fwd = ['content-type', 'content-length', 'content-disposition',
                     'accept-ranges', 'content-range', 'cache-control'];
        fwd.forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        upstream.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('[BinTV] proxy error:', err.message);
        if (!res.headersSent) { res.statusCode = 502; res.end('Proxy error: ' + err.message); }
    });
    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) { res.statusCode = 504; res.end('Timeout'); }
    });
}

// ---- ROUTER ----
async function router(req, res) {
    const urlObj = new URL(req.url, 'http://x');
    const path = urlObj.pathname.replace(/\.json$/, '');
    const parts = path.split('/').filter(Boolean);

    console.log(`[BinTV] ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.statusCode = 204;
        return res.end();
    }

    try {
        if (parts.length === 0 || parts[0] === 'manifest') return await handleManifest(req, res);
        if (parts[0] === 'catalog' && parts.length >= 3) return await handleCatalog(req, res, parts[1], parts[2]);
        if (parts[0] === 'meta' && parts.length >= 3) return await handleMeta(req, res, parts[1], parts[2]);
        if (parts[0] === 'stream' && parts.length >= 3) return await handleStream(req, res, parts[1], parts[2]);
        if (parts[0] === 'proxy') return handleProxy(req, res);

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(manifest));
    } catch (err) {
        console.error('[BinTV] router fatal:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ err: 'Internal error', message: err.message }));
    }
}

module.exports = router;
module.exports.default = router;
