import type { Express, Request, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import Installation from '../../models/Installation.js';
import RepoConfig from '../../models/RepoConfig.js';
import { requireAuth } from '../auth/middleware.js';
import { publish } from '../events/bus.js';
import { getInstallationOctokit } from '../github/octokit.js';

const ALLOWED_ENFORCEMENT = new Set(['warning', 'error']);

/** Safe focus dimension tags (merged with defaults security/style/usability for scoring). */
const FOCUS_TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_FOCUS_AREAS = 16;

type RepoConfigView = {
    id: string;
    installationId: string;
    repoFullName: string;
    focusAreas: string[];
    enforcementLevel: 'warning' | 'error';
    useAstGrep: boolean;
    customRules: string;
    mergeMinScore: number;
    createdAt: string;
    updatedAt: string;
};

function toView(doc: {
    _id: unknown;
    installationId: string;
    repoFullName: string;
    focusAreas: string[];
    enforcementLevel: 'warning' | 'error';
    useAstGrep: boolean;
    customRules: string;
    mergeMinScore: number;
    createdAt?: Date;
    updatedAt?: Date;
}): RepoConfigView {
    const now = new Date().toISOString();
    return {
        id: String(doc._id),
        installationId: doc.installationId,
        repoFullName: doc.repoFullName,
        focusAreas: [...(doc.focusAreas ?? [])],
        enforcementLevel: doc.enforcementLevel,
        useAstGrep: Boolean(doc.useAstGrep),
        customRules: doc.customRules,
        mergeMinScore: doc.mergeMinScore,
        createdAt: doc.createdAt ? doc.createdAt.toISOString() : now,
        updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : now,
    };
}

function clampScore(n: unknown): number {
    const v = Number(n);
    if (!Number.isFinite(v)) {
        return 70;
    }
    return Math.max(0, Math.min(100, Math.round(v)));
}

function sanitizeFocusAreas(input: unknown): string[] | null {
    if (!Array.isArray(input)) {
        return null;
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of input) {
        if (typeof item !== 'string') continue;
        const v = item.trim().toLowerCase();
        if (!FOCUS_TAG_PATTERN.test(v) || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
        if (out.length >= MAX_FOCUS_AREAS) break;
    }
    return out;
}

async function ensureInstallationOwned(userId: string, installationId: string): Promise<boolean> {
    const doc = await Installation.findOne({
        userId: new Types.ObjectId(userId),
        installationId,
    }).lean().exec();
    return Boolean(doc);
}

export function registerRepoConfigRoutes(app: Express): void {
    const router = express.Router();
    router.use(express.json());

    router.get('/', requireAuth, async (req: Request, res: Response) => {
        const docs = await RepoConfig.find({ userId: new Types.ObjectId(req.user!._id) })
            .sort({ repoFullName: 1 })
            .lean()
            .exec();
        res.json({ items: docs.map((d) => toView(d)) });
    });

    router.get('/available', requireAuth, async (req: Request, res: Response) => {
        const installationId =
            typeof req.query.installationId === 'string' ? req.query.installationId.trim() : '';
        if (!installationId) {
            res.status(400).json({ error: 'installationId is required' });
            return;
        }
        if (!(await ensureInstallationOwned(req.user!._id, installationId))) {
            res.status(404).json({ error: 'Installation not found for this user' });
            return;
        }
        try {
            const octokit = getInstallationOctokit(installationId);
            const repos: { fullName: string; private: boolean }[] = [];
            let page = 1;
            while (true) {
                const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
                    per_page: 100,
                    page,
                });
                for (const r of data.repositories) {
                    repos.push({ fullName: r.full_name, private: r.private });
                }
                if (data.repositories.length < 100) break;
                page += 1;
            }
            res.json({ items: repos });
        } catch (err) {
            console.error('[repo-configs] listReposAccessibleToInstallation failed', err);
            res.status(502).json({ error: 'Could not list installation repositories' });
        }
    });

    router.post('/', requireAuth, async (req: Request, res: Response) => {
        const installationId =
            typeof req.body?.installationId === 'string' || typeof req.body?.installationId === 'number'
                ? String(req.body.installationId).trim()
                : '';
        const repoFullName =
            typeof req.body?.repoFullName === 'string' ? req.body.repoFullName.trim() : '';
        if (!installationId || !/^\d+$/.test(installationId)) {
            res.status(400).json({ error: 'installationId is required' });
            return;
        }
        if (!repoFullName.includes('/')) {
            res.status(400).json({ error: 'repoFullName must look like owner/repo' });
            return;
        }
        if (!(await ensureInstallationOwned(req.user!._id, installationId))) {
            res.status(404).json({ error: 'Installation not found for this user' });
            return;
        }
        const existing = await RepoConfig.findOne({
            userId: new Types.ObjectId(req.user!._id),
            repoFullName,
        }).exec();
        if (existing) {
            res.status(409).json({ error: 'Repo already configured', config: toView(existing.toObject()) });
            return;
        }
        try {
            const created = await RepoConfig.create({
                userId: new Types.ObjectId(req.user!._id),
                installationId,
                repoFullName,
            });
            publish({
                type: 'repo-config-updated',
                userId: req.user!._id,
                payload: { repoFullName, action: 'created' },
            });
            res.status(201).json({ config: toView(created.toObject()) });
        } catch (err) {
            console.error('[repo-configs] create failed', err);
            res.status(500).json({ error: 'Could not create repo config' });
        }
    });

    router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
        const idParam = req.params.id;
        const id = typeof idParam === 'string' ? idParam : '';
        if (!id || !Types.ObjectId.isValid(id)) {
            res.status(400).json({ error: 'Invalid id' });
            return;
        }
        const set: Record<string, unknown> = {};

        if (req.body?.focusAreas !== undefined) {
            const cleaned = sanitizeFocusAreas(req.body.focusAreas);
            if (cleaned === null) {
                res.status(400).json({ error: 'focusAreas must be an array of strings' });
                return;
            }
            set.focusAreas = cleaned;
        }
        if (req.body?.enforcementLevel !== undefined) {
            const v =
                typeof req.body.enforcementLevel === 'string'
                    ? req.body.enforcementLevel.trim().toLowerCase()
                    : '';
            if (!ALLOWED_ENFORCEMENT.has(v)) {
                res.status(400).json({ error: 'enforcementLevel must be warning or error' });
                return;
            }
            set.enforcementLevel = v;
        }
        if (req.body?.useAstGrep !== undefined) {
            set.useAstGrep = Boolean(req.body.useAstGrep);
        }
        if (req.body?.customRules !== undefined) {
            const v = typeof req.body.customRules === 'string' ? req.body.customRules : '';
            if (v.length > 4000) {
                res.status(400).json({ error: 'customRules must be <= 4000 chars' });
                return;
            }
            set.customRules = v;
        }
        if (req.body?.mergeMinScore !== undefined) {
            set.mergeMinScore = clampScore(req.body.mergeMinScore);
        }

        const updated = await RepoConfig.findOneAndUpdate(
            {
                _id: new Types.ObjectId(id),
                userId: new Types.ObjectId(req.user!._id),
            },
            { $set: set },
            { new: true },
        ).exec();

        if (!updated) {
            res.status(404).json({ error: 'Not found' });
            return;
        }

        publish({
            type: 'repo-config-updated',
            userId: req.user!._id,
            payload: { repoFullName: updated.repoFullName, action: 'updated' },
        });
        res.json({ config: toView(updated.toObject()) });
    });

    router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
        const idParam = req.params.id;
        const id = typeof idParam === 'string' ? idParam : '';
        if (!id || !Types.ObjectId.isValid(id)) {
            res.status(400).json({ error: 'Invalid id' });
            return;
        }
        const deleted = await RepoConfig.findOneAndDelete({
            _id: new Types.ObjectId(id),
            userId: new Types.ObjectId(req.user!._id),
        }).exec();
        if (!deleted) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        publish({
            type: 'repo-config-updated',
            userId: req.user!._id,
            payload: { repoFullName: deleted.repoFullName, action: 'deleted' },
        });
        res.json({ ok: true });
    });

    app.use('/api/repo-configs', router);
}
