import type { Express, Request, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import Installation from '../../models/Installation.js';
import { requireAuth } from '../auth/middleware.js';
import { signInstallState, verifyInstallState } from '../auth/tokens.js';
import { publish } from '../events/bus.js';
import { getAppOctokit } from '../github/octokit.js';

type InstallView = {
    id: string;
    installationId: string;
    accountLogin: string;
    accountType: 'User' | 'Organization';
    createdAt: string;
};

function frontendBase(): string {
    return (process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
}

function toView(doc: {
    _id: unknown;
    installationId: string;
    accountLogin: string;
    accountType: 'User' | 'Organization';
    createdAt?: Date;
}): InstallView {
    return {
        id: String(doc._id),
        installationId: doc.installationId,
        accountLogin: doc.accountLogin,
        accountType: doc.accountType,
        createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    };
}

async function fetchInstallationMeta(installationId: string): Promise<{
    accountLogin: string;
    accountType: 'User' | 'Organization';
} | null> {
    try {
        const octokit = getAppOctokit();
        const { data } = await octokit.rest.apps.getInstallation({ installation_id: Number(installationId) });
        const account = data.account as { login?: string; type?: string } | null;
        if (!account || !account.login) {
            return null;
        }
        const accountType: 'User' | 'Organization' = account.type === 'Organization' ? 'Organization' : 'User';
        return { accountLogin: account.login, accountType };
    } catch (err) {
        console.error('[installations] fetch meta failed', err);
        return null;
    }
}

async function upsertInstallation(
    userId: string,
    installationId: string,
): Promise<{ ok: true; doc: InstallView } | { ok: false; status: number; error: string }> {
    const meta = await fetchInstallationMeta(installationId);
    if (!meta) {
        return { ok: false, status: 400, error: 'Installation not found or App lacks access' };
    }
    const existing = await Installation.findOne({ installationId }).exec();
    if (existing && String(existing.userId) !== userId) {
        return { ok: false, status: 409, error: 'Installation already claimed by another user' };
    }
    const doc =
        existing ??
        new Installation({
            userId: new Types.ObjectId(userId),
            installationId,
            accountLogin: meta.accountLogin,
            accountType: meta.accountType,
        });
    doc.accountLogin = meta.accountLogin;
    doc.accountType = meta.accountType;
    await doc.save();

    publish({
        type: 'installation-linked',
        userId,
        payload: { installationId, accountLogin: meta.accountLogin },
    });
    return { ok: true, doc: toView(doc.toObject()) };
}

export function registerInstallationRoutes(app: Express): void {
    const router = express.Router();
    router.use(express.json());

    router.get('/api/installations', requireAuth, async (req: Request, res: Response) => {
        const docs = await Installation.find({ userId: new Types.ObjectId(req.user!._id) }).lean().exec();
        res.json({ items: docs.map((d) => toView(d)) });
    });

    router.post('/api/installations', requireAuth, async (req: Request, res: Response) => {
        const installationId =
            typeof req.body?.installationId === 'string' || typeof req.body?.installationId === 'number'
                ? String(req.body.installationId).trim()
                : '';
        if (!/^\d+$/.test(installationId)) {
            res.status(400).json({ error: 'installationId must be a numeric string' });
            return;
        }
        const result = await upsertInstallation(req.user!._id, installationId);
        if (!result.ok) {
            res.status(result.status).json({ error: result.error });
            return;
        }
        res.status(201).json({ installation: result.doc });
    });

    router.delete('/api/installations/:id', requireAuth, async (req: Request, res: Response) => {
        const idParam = req.params.id;
        const id = typeof idParam === 'string' ? idParam : '';
        if (!id || !Types.ObjectId.isValid(id)) {
            res.status(400).json({ error: 'Invalid id' });
            return;
        }
        const deleted = await Installation.findOneAndDelete({
            _id: new Types.ObjectId(id),
            userId: new Types.ObjectId(req.user!._id),
        }).exec();
        if (!deleted) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json({ ok: true });
    });

    function buildGithubNewInstallUrl(userId: string): { ok: true; url: string } | { ok: false; status: number; error: string } {
        const custom = process.env.GITHUB_APP_INSTALL_URL?.trim();
        const slug = process.env.GITHUB_APP_SLUG?.trim();
        let url: URL;
        if (custom) {
            try {
                url = new URL(custom);
            } catch {
                return { ok: false, status: 503, error: 'GITHUB_APP_INSTALL_URL is not a valid URL' };
            }
        } else if (slug) {
            url = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
        } else {
            return {
                ok: false,
                status: 503,
                error: 'Set GITHUB_APP_SLUG (short name from the app’s Public page) or GITHUB_APP_INSTALL_URL in the server environment.',
            };
        }
        url.searchParams.set('state', signInstallState(userId));
        return { ok: true, url: url.toString() };
    }

    /** Full-page redirect; supports `?token=` session JWT for bookmarks (same as requireAuth). */
    router.get('/api/github/install', requireAuth, (req: Request, res: Response) => {
        const built = buildGithubNewInstallUrl(req.user!._id);
        if (!built.ok) {
            if (req.accepts('html')) {
                const back = `${frontendBase()}/configurations`;
                res.status(built.status)
                    .type('html')
                    .send(
                        `<!DOCTYPE html><html lang="en"><meta charset="utf-8"/><title>Install GitHub App</title><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:40rem"><h1>Can’t open GitHub install page</h1><p>${built.error}</p><p><a href="${back}">Back to configurations</a></p></body></html>`,
                    );
                return;
            }
            res.status(built.status).json({ error: built.error });
            return;
        }
        res.redirect(302, built.url);
    });

    /** JSON URL for SPA "Install" button so the session Bearer is sent (plain `<a href>` cannot). */
    router.post('/api/github/install-link', requireAuth, (req: Request, res: Response) => {
        const built = buildGithubNewInstallUrl(req.user!._id);
        if (!built.ok) {
            res.status(built.status).json({ error: built.error });
            return;
        }
        res.json({ url: built.url });
    });

    router.get('/api/github/setup', async (req: Request, res: Response) => {
        const installationIdRaw = req.query.installation_id;
        const stateRaw = req.query.state;
        if (typeof installationIdRaw !== 'string' || typeof stateRaw !== 'string') {
            res.status(400).send('Missing installation_id or state');
            return;
        }
        const userId = verifyInstallState(stateRaw);
        if (!userId) {
            res.status(400).send('Invalid or expired state token');
            return;
        }
        const result = await upsertInstallation(userId, installationIdRaw.trim());
        if (!result.ok) {
            res.status(result.status).send(result.error);
            return;
        }
        res.redirect(`${frontendBase()}/configurations?installed=1`);
    });

    app.use(router);
}
