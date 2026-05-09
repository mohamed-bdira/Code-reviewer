import type { Express, Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import PrReviewFinding from '../../models/PrReviewFinding.js';
import { requireAuth } from '../auth/middleware.js';

type ParsedQuery = {
    repoFullName?: string;
    prNumber?: number;
    category?: string;
    fileContains?: string;
    q?: string;
    since?: Date;
    skip: number;
    limit: number;
};

function parseFilters(req: Request): ParsedQuery | { error: string } {
    const repoFullName =
        typeof req.query.repoFullName === 'string' && req.query.repoFullName.trim().length > 0
            ? req.query.repoFullName.trim()
            : undefined;
    const prRaw = req.query.prNumber;
    let prNumber: number | undefined;
    if (typeof prRaw === 'string' && prRaw.trim().length > 0) {
        const n = Number(prRaw);
        if (!Number.isFinite(n) || n < 1) {
            return { error: 'Invalid prNumber' };
        }
        prNumber = Math.floor(n);
    }
    const category =
        typeof req.query.category === 'string' && req.query.category.trim().length > 0
            ? req.query.category.trim().toLowerCase()
            : undefined;
    const fileContains =
        typeof req.query.fileContains === 'string' && req.query.fileContains.trim().length > 0
            ? req.query.fileContains.trim()
            : undefined;
    const q =
        typeof req.query.q === 'string' && req.query.q.trim().length > 0 ? req.query.q.trim() : undefined;
    let since: Date | undefined;
    if (typeof req.query.since === 'string' && req.query.since.trim().length > 0) {
        const d = new Date(req.query.since);
        if (Number.isNaN(d.getTime())) {
            return { error: 'Invalid since (ISO date expected)' };
        }
        since = d;
    }
    const limitRaw = req.query.limit;
    let limit = 50;
    if (typeof limitRaw === 'string' && limitRaw.trim().length > 0) {
        const n = Number(limitRaw);
        if (!Number.isFinite(n) || n < 1) {
            return { error: 'Invalid limit' };
        }
        limit = Math.min(200, Math.floor(n));
    }
    const skipRaw = req.query.skip;
    let skip = 0;
    if (typeof skipRaw === 'string' && skipRaw.trim().length > 0) {
        const n = Number(skipRaw);
        if (!Number.isFinite(n) || n < 0) {
            return { error: 'Invalid skip' };
        }
        skip = Math.floor(n);
    }

    const parsed: ParsedQuery = { skip, limit };
    if (repoFullName !== undefined) {
        parsed.repoFullName = repoFullName;
    }
    if (prNumber !== undefined) {
        parsed.prNumber = prNumber;
    }
    if (category !== undefined) {
        parsed.category = category;
    }
    if (fileContains !== undefined) {
        parsed.fileContains = fileContains;
    }
    if (q !== undefined) {
        parsed.q = q;
    }
    if (since !== undefined) {
        parsed.since = since;
    }

    return parsed;
}

function buildMatch(q: ParsedQuery, userId: string): Record<string, unknown> {
    const match: Record<string, unknown> = {
        userId: new Types.ObjectId(userId),
    };
    if (q.repoFullName) {
        match.repoFullName = q.repoFullName;
    }
    if (q.prNumber !== undefined) {
        match.prNumber = q.prNumber;
    }
    if (q.category) {
        match.category = q.category;
    }
    if (q.fileContains) {
        match.filePath = new RegExp(q.fileContains.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (q.q) {
        match.description = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (q.since) {
        match.firstSeenAt = { $gte: q.since };
    }
    return match;
}

export function registerFindingsRoutes(app: Express): void {
    app.get('/api/findings', requireAuth, async (req: Request, res: Response) => {
        if (mongoose.connection.readyState !== 1) {
            res.status(503).json({ error: 'MongoDB not connected' });
            return;
        }
        const parsed = parseFilters(req);
        if ('error' in parsed) {
            res.status(400).json({ error: parsed.error });
            return;
        }
        const match = buildMatch(parsed, req.user!._id);
        try {
            const [items, total] = await Promise.all([
                PrReviewFinding.find(match)
                    .sort({ lastSeenAt: -1, createdAt: -1 })
                    .skip(parsed.skip)
                    .limit(parsed.limit)
                    .lean()
                    .exec(),
                PrReviewFinding.countDocuments(match).exec(),
            ]);
            res.json({
                items,
                total,
                skip: parsed.skip,
                limit: parsed.limit,
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Query failed' });
        }
    });

    app.get('/api/findings/by-category', requireAuth, async (req: Request, res: Response) => {
        if (mongoose.connection.readyState !== 1) {
            res.status(503).json({ error: 'MongoDB not connected' });
            return;
        }
        const parsed = parseFilters(req);
        if ('error' in parsed) {
            res.status(400).json({ error: parsed.error });
            return;
        }
        const match = buildMatch(parsed, req.user!._id);
        try {
            const agg = await PrReviewFinding.aggregate<{ _id: string; count: number }>([
                { $match: match },
                { $group: { _id: '$category', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]).exec();
            const counts: Record<string, number> = {};
            for (const row of agg) {
                counts[String(row._id)] = row.count;
            }
            res.json({ counts });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Aggregation failed' });
        }
    });
}
