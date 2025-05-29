// api/posthog-webhook.js
import { createClient } from 'redis';

export const config = {
    runtime: 'nodejs', // or 'edge' if you prefer and redis client supports it well
};

const REDIS_CHANNEL = 'posthog_visits';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // For Vercel KV, environment variables are automatically set up
    // when you connect a KV store via the Vercel dashboard.
    // KV_URL is the one to use for the redis client.
    const redisUrl = process.env.KV_URL;
    if (!redisUrl) {
        console.error('KV_URL (Redis URL) environment variable is not set.');
        return res.status(500).send('Server configuration error: Redis URL missing.');
    }

    const redisClient = createClient({ url: redisUrl });

    try {
        await redisClient.connect();
        console.log("Connected to Redis for publishing.");

        const event = req.body; // PostHog sends JSON, Vercel parses it by default

        // You can inspect the event structure from PostHog webhook docs or by logging it:
        // console.log("Received PostHog Event:", JSON.stringify(event, null, 2));

        // Basic check to ensure it's a PostHog event (you might want more validation)
        if (!event || !event.event || !event.properties) {
             console.log("Received non-standard event or malformed payload:", event);
             // Still return 200 to PostHog to prevent retries for malformed (but accepted) payloads
             return res.status(200).send('Webhook received, but event format unexpected.');
        }

        // We are interested in $pageview events
        // Or any event if you configured the webhook broadly
        if (event.event === '$pageview' || event.event === 'site_visited') { // Adjust if you use a custom event
            const visitData = {
                event: event.event,
                url: event.properties?.$current_url || 'Unknown URL',
                timestamp: event.timestamp || new Date().toISOString(),
                distinct_id: event.distinct_id,
                ip: event.properties?.$ip || 'N/A',
                city: event.properties?.$geoip_city_name || 'Unknown',
                country: event.properties?.$geoip_country_name || 'Unknown',
                // Add any other properties you care about
            };

            await redisClient.publish(REDIS_CHANNEL, JSON.stringify(visitData));
            console.log(`Published to ${REDIS_CHANNEL}:`, visitData);
        } else {
            console.log(`Ignored event type: ${event.event}`);
        }

        res.status(200).send('Webhook received');

    } catch (error) {
        console.error('Error processing PostHog webhook or publishing to Redis:', error);
        res.status(500).send('Error processing webhook');
    } finally {
        if (redisClient.isOpen) {
            await redisClient.quit();
            console.log("Disconnected Redis client after publishing.");
        }
    }
}