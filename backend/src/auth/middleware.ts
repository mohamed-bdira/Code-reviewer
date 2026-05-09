import type { NextFunction, Request, Response } from 'express';
import User from '../../models/User.js';
import { isApiKeyToken, verifyKey } from './apiKeys.js';
import { verifySession } from './tokens.js';

export type AuthedUser = {
    _id: string;
    email: string;
};

declare module 'express-serve-static-core' {
    interface Request {
        user?: AuthedUser;
        authVia?: 'session' | 'apiKey';
    }
}

function extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
        return header.slice('bearer '.length).trim() || null;
    }
    const queryToken = req.query.token;
    if (typeof queryToken === 'string' && queryToken.length > 0) {
        return queryToken;
    }
    return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = extractToken(req);
    if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    try {
        if (isApiKeyToken(token)) {
            const apiKey = await verifyKey(token);
            if (!apiKey) {
                res.status(401).json({ error: 'Invalid API key' });
                return;
            }
            const user = await User.findById(apiKey.userId).lean().exec();
            if (!user) {
                res.status(401).json({ error: 'User no longer exists' });
                return;
            }
            req.user = { _id: String(user._id), email: user.email };
            req.authVia = 'apiKey';
            next();
            return;
        }

        const session = verifySession(token);
        if (!session) {
            res.status(401).json({ error: 'Invalid session token' });
            return;
        }
        const user = await User.findById(session.sub).lean().exec();
        if (!user) {
            res.status(401).json({ error: 'User no longer exists' });
            return;
        }
        req.user = { _id: String(user._id), email: user.email };
        req.authVia = 'session';
        next();
    } catch (err) {
        console.error('[auth] middleware error', err);
        res.status(500).json({ error: 'Authentication check failed' });
    }
}

/** Like requireAuth, but rejects API-key auth (used for endpoints that mint or revoke keys). */
export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    await requireAuth(req, res, () => {
        if (req.authVia !== 'session') {
            res.status(403).json({ error: 'Session required (API keys cannot manage keys)' });
            return;
        }
        next();
    });
}
