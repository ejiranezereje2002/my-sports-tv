const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

// The API endpoint
const API_URL = 'https://bintvjson.lovable.app/api/public/bintvjson';

// Create a new addon builder
const builder = new addonBuilder(require('./manifest.json'));

// Helper to fetch and parse data from the API
async function fetchData() {
    const response = await fetch(API_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch API: ${response.statusText}`);
    }
    return await response.json();
}

// Catalog handler
builder.defineCatalogHandler(async (args) => {
    const { type, id, extra } = args;
    const genre = extra && extra.genre ? extra.genre : null;

    try {
        const data = await fetchData();
        let items = [];

        if (id === 'live') {
            items = data['Live Events'] || [];
        } else if (id === 'upcoming') {
            items = data['Upcoming Events'] || [];
        }

        // Filter by genre if provided
        if (genre) {
            items = items.filter(item => item.category === genre);
        }

        // Map to Stremio meta format
        const metas = items.map(item => ({
            id: `bintv:${item.id}`,
            type: 'sports',
            name: item.name,
            poster: item.poster,
            description: `${item.category} - Status: ${item.status}`,
            // Store the original item in a custom field for the stream handler
            // This is not part of the standard Stremio meta spec but is a common pattern
            _raw: item 
        }));

        return { metas };
    } catch (error) {
        console.error(error);
        return { metas: [] };
    }
});

// Stream handler
builder.defineStreamHandler(async (args) => {
    const { type, id } = args;

    // id is in the format 'bintv:EVENT_ID'
    if (!id.startsWith('bintv:')) {
        return { streams: [] };
    }

    const eventId = id.substring('bintv:'.length);

    try {
        const data = await fetchData();
        let allEvents = [
            ...(data['Live Events'] || []),
            ...(data['Upcoming Events'] || [])
        ];
        
        const event = allEvents.find(e => e.id === eventId);

        if (!event) {
            return { streams: [] };
        }

        const streams = event.streams.map(stream => ({
            title: stream.name,
            url: stream.url,
            // Add behaviorHints if needed
        }));

        return { streams };
    } catch (error) {
        console.error(error);
        return { streams: [] };
    }
});

// Export the addon interface
module.exports = builder.getInterface();
