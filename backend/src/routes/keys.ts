import type { Express, Request, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import ApiKey from '../../models/ApiKey.js';
import { generateKey } from '../auth/apiKeys.js';
import { requireSession } from '../auth/middleware.js';

type KeyView = {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt?: string | undefined;
    createdAt: string;
    revokedAt?: string | undefined;
};

function toView(doc: {
    _id: unknown;
    name: string;
    prefix: string;
    lastUsedAt?: Date;
    revokedAt?: Date;
    createdAt?: Date;
}): KeyView {
    return {
        id: String(doc._id),
        name: doc.name,
        prefix: doc.prefix,
        lastUsedAt: doc.lastUsedAt?.toISOString(),
        createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
        revokedAt: doc.revokedAt?.toISOString(),
    };
}

export function registerKeyRoutes(app: Express): void {
    const router = express.Router();
    router.use(express.json());

    router.get('/', requireSession, async (req: Request, res: Response) => {
        const docs = await ApiKey.find({ userId: new Types.ObjectId(req.user!._id) })
            .sort({ createdAt: -1 })
            .lean()
            .exec();
        res.json({ items: docs.map((d) => toView(d)) });
    });

    router.post('/', requireSession, async (req: Request, res: Response) => {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (name.length === 0 || name.length > 80) {
            res.status(400).json({ error: 'name is required (1-80 chars)' });
            return;
        }
        try {
            const { plaintext, prefix, keyHash } = await generateKey();
            const doc = await ApiKey.create({
                userId: new Types.ObjectId(req.user!._id),
                name,
                prefix,
                keyHash,
            });
            res.status(201).json({
                key: plaintext,
                ...toView(doc.toObject()),
            });
        } catch (err) {
            console.error('[keys] create failed', err);
            res.status(500).json({ error: 'Could not generate key' });
        }
    });

    router.delete('/:id', requireSession, async (req: Request, res: Response) => {
        const idParam = req.params.id;
        const id = typeof idParam === 'string' ? idParam : '';
        if (!id || !Types.ObjectId.isValid(id)) {
            res.status(400).json({ error: 'Invalid id' });
            return;
        }
        const updated = await ApiKey.findOneAndUpdate(
            {
                _id: new Types.ObjectId(id),
                userId: new Types.ObjectId(req.user!._id),
                revokedAt: { $exists: false },
            },
            { $set: { revokedAt: new Date() } },
            { new: true },
        ).exec();
        if (!updated) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json({ ok: true, key: toView(updated.toObject()) });
    });

    app.use('/api/keys', router);
}
