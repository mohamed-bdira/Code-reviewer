import type { Express, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { subscribe } from '../events/bus.js';

const HEARTBEAT_MS = 25_000;

export function registerEventRoutes(app: Express): void {
    app.get('/api/events', requireAuth, (req: Request, res: Response) => {
        const userId = req.user!._id;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, userId })}\n\n`);

        const unsubscribe = subscribe(userId, (event) => {
            try {
                res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
            } catch (err) {
                console.error('[sse] write failed', err);
            }
        });

        const heartbeat = setInterval(() => {
            res.write(`: ping ${Date.now()}\n\n`);
        }, HEARTBEAT_MS);

        const close = (): void => {
            clearInterval(heartbeat);
            unsubscribe();
            res.end();
        };

        req.on('close', close);
        req.on('aborted', close);
    });
}
