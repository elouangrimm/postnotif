// api/sse-notifications.js
import { createClient } from 'redis';

export const config = {
    runtime: 'nodejs', // SSE works better with Node.js runtime for long-lived connections
                       // Vercel Edge runtime also supports streaming but Node.js redis client is more common
};

const REDIS_CHANNEL = 'posthog_visits';

export default async function handler(req, res) {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust if needed for specific origins
    res.flushHeaders(); // Flush the headers to establish the connection

    const redisUrl = process.env.KV_URL;
    if (!redisUrl) {
        console.error('KV_URL (Redis URL) environment variable is not set for SSE.');
        res.write(`data: ${JSON.stringify({ error: "Server configuration error: Redis URL missing." })}\n\n`);
        res.end();
        return;
    }

    const subscriber = createClient({ url: redisUrl });
    let isConnected = false;

    try {
        await subscriber.connect();
        isConnected = true;
        console.log("SSE: Connected to Redis for subscribing.");

        subscriber.subscribe(REDIS_CHANNEL, (message) => {
            console.log(`SSE: Received message on ${REDIS_CHANNEL}:`, message);
            res.write(`data: ${message}\n\n`); // Send message to client
        });

        // Send a comment to keep the connection alive if no messages
        const keepAliveInterval = setInterval(() => {
            res.write(':keep-alive\n\n');
        }, 20000); // Every 20 seconds

        // Handle client disconnect
        req.on('close', async () => {
            console.log("SSE: Client disconnected.");
            clearInterval(keepAliveInterval);
            if (isConnected && subscriber.isOpen) {
                await subscriber.unsubscribe(REDIS_CHANNEL);
                await subscriber.quit();
                console.log("SSE: Unsubscribed and disconnected Redis client.");
            }
            res.end();
        });

    } catch (error) {
        console.error('SSE: Error connecting to Redis or subscribing:', error);
        res.write(`data: ${JSON.stringify({ error: "Failed to connect to event stream.", details: error.message })}\n\n`);
        // Don't end the response here if `req.on('close')` should still try to clean up
        // However, if subscriber connection failed, there's not much else to do.
        if (subscriber.isOpen) {
            await subscriber.quit();
        }
        res.end();
    }
}