import type { Express, Request, Response } from 'express';
import express from 'express';
import User from '../../models/User.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { signSession } from '../auth/tokens.js';
import { requireAuth } from '../auth/middleware.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PW = 8;

type UserView = {
    id: string;
    email: string;
    displayName?: string | undefined;
    githubLogin?: string | undefined;
};

function toUserView(doc: { _id: unknown; email: string; displayName?: string; githubLogin?: string }): UserView {
    return {
        id: String(doc._id),
        email: doc.email,
        displayName: doc.displayName,
        githubLogin: doc.githubLogin,
    };
}

function frontendBase(): string {
    return (process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
}

function backendBase(): string {
    return (process.env.OAUTH_CALLBACK_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(/\/$/, '');
}

export function registerAuthRoutes(app: Express): void {
    const router = express.Router();
    router.use(express.json());

    router.post('/register', async (req: Request, res: Response) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const displayName =
            typeof req.body?.displayName === 'string' && req.body.displayName.trim().length > 0
                ? req.body.displayName.trim()
                : undefined;

        if (!EMAIL_RE.test(email)) {
            res.status(400).json({ error: 'Invalid email' });
            return;
        }
        if (password.length < MIN_PW) {
            res.status(400).json({ error: `Password must be at least ${MIN_PW} characters` });
            return;
        }

        const existing = await User.findOne({ email }).lean().exec();
        if (existing) {
            res.status(409).json({ error: 'Email already registered' });
            return;
        }

        try {
            const passwordHash = await hashPassword(password);
            const created = await User.create({
                email,
                passwordHash,
                ...(displayName !== undefined ? { displayName } : {}),
            });
            const token = signSession({ sub: String(created._id), email: created.email });
            res.status(201).json({ token, user: toUserView(created.toObject()) });
        } catch (err) {
            console.error('[auth] register failed', err);
            res.status(500).json({ error: 'Registration failed' });
        }
    });

    router.post('/login', async (req: Request, res: Response) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';

        if (!email || !password) {
            res.status(400).json({ error: 'Email and password are required' });
            return;
        }

        const user = await User.findOne({ email }).exec();
        if (!user || !user.passwordHash) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }
        const token = signSession({ sub: String(user._id), email: user.email });
        res.json({ token, user: toUserView(user.toObject()) });
    });

    router.get('/me', requireAuth, async (req: Request, res: Response) => {
        const user = await User.findById(req.user!._id).lean().exec();
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ user: toUserView(user) });
    });

    router.get('/github/start', (req: Request, res: Response) => {
        const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
        if (!clientId) {
            res.status(503).json({ error: 'GitHub OAuth not configured (GITHUB_OAUTH_CLIENT_ID missing)' });
            return;
        }
        const redirect = `${backendBase()}/api/auth/github/callback`;
        const url = new URL('https://github.com/login/oauth/authorize');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirect);
        url.searchParams.set('scope', 'read:user user:email');
        const next = typeof req.query.next === 'string' ? req.query.next : '/';
        url.searchParams.set('state', encodeURIComponent(next));
        res.redirect(url.toString());
    });

    router.get('/github/callback', async (req: Request, res: Response) => {
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        const stateParam = typeof req.query.state === 'string' ? decodeURIComponent(req.query.state) : '/';
        if (!code) {
            res.status(400).send('Missing code from GitHub OAuth');
            return;
        }
        const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
        const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            res.status(503).send('GitHub OAuth not configured');
            return;
        }

        try {
            const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code,
                    redirect_uri: `${backendBase()}/api/auth/github/callback`,
                }),
            });
            const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
            if (!tokenJson.access_token) {
                res.status(502).send(`GitHub token exchange failed: ${tokenJson.error ?? 'no token'}`);
                return;
            }

            const userRes = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${tokenJson.access_token}`,
                    'User-Agent': 'PFE-AI-Reviewer',
                    Accept: 'application/vnd.github+json',
                },
            });
            const ghUser = (await userRes.json()) as {
                id?: number;
                login?: string;
                name?: string;
                email?: string | null;
            };
            if (!ghUser.id || !ghUser.login) {
                res.status(502).send('Could not load GitHub profile');
                return;
            }

            let email = ghUser.email ?? null;
            if (!email) {
                const emailsRes = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        Authorization: `Bearer ${tokenJson.access_token}`,
                        'User-Agent': 'PFE-AI-Reviewer',
                        Accept: 'application/vnd.github+json',
                    },
                });
                const emails = (await emailsRes.json().catch(() => [])) as Array<{
                    email: string;
                    primary?: boolean;
                    verified?: boolean;
                }>;
                if (Array.isArray(emails)) {
                    const primary = emails.find((e) => e.primary && e.verified);
                    email = primary?.email ?? emails.find((e) => e.verified)?.email ?? null;
                }
            }
            if (!email) {
                email = `${ghUser.login}@users.noreply.github.com`;
            }

            const filter = { githubId: ghUser.id };
            const existing = await User.findOne(filter).exec();
            const upsertSet: Record<string, unknown> = {
                githubId: ghUser.id,
                githubLogin: ghUser.login,
                email: email.toLowerCase(),
            };
            if (ghUser.name) {
                upsertSet.displayName = ghUser.name;
            }

            const user = existing
                ? Object.assign(existing, upsertSet)
                : new User(upsertSet);
            await user.save();

            const sessionToken = signSession({ sub: String(user._id), email: user.email });
            const next = stateParam.startsWith('/') ? stateParam : '/';
            const redirect = new URL(`${frontendBase()}/auth/finish`);
            redirect.searchParams.set('token', sessionToken);
            redirect.searchParams.set('next', next);
            res.redirect(redirect.toString());
        } catch (err) {
            console.error('[auth] github callback failed', err);
            res.status(500).send('GitHub OAuth callback failed');
        }
    });

    app.use('/api/auth', router);
}
