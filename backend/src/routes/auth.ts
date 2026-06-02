import type { Express, Request, Response } from 'express';
import express from 'express';
import User from '../../models/User.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { signSession } from '../auth/tokens.js';
import { requireAuth } from '../auth/middleware.js';
import { sanitizePostLoginPath } from '../auth/sanitizePostLoginPath.js';

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

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
        const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
        if (!clientId) {
            const msg =
                'GitHub sign-in is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET on the server, and add the callback URL in your GitHub OAuth app settings.';
            if (req.accepts('html')) {
                const back = `${frontendBase()}/login`;
                res.status(503)
                    .type('html')
                    .send(
                        `<!DOCTYPE html><html lang="en"><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>GitHub sign-in</title><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:40rem;line-height:1.5"><h1>GitHub sign-in unavailable</h1><p>${msg}</p><p><a href="${back}">Back to login</a></p></body></html>`,
                    );
                return;
            }
            res.status(503).json({ error: 'GitHub OAuth not configured (GITHUB_OAUTH_CLIENT_ID missing)' });
            return;
        }
        const redirect = `${backendBase()}/api/auth/github/callback`;
        const url = new URL('https://github.com/login/oauth/authorize');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirect);
        url.searchParams.set('scope', 'read:user user:email');
        url.searchParams.set('allow_signup', 'true');
        const next = sanitizePostLoginPath(typeof req.query.next === 'string' ? req.query.next : '/');
        url.searchParams.set('state', next);
        res.redirect(302, url.toString());
    });

    router.get('/github/callback', async (req: Request, res: Response) => {
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        const rawState = typeof req.query.state === 'string' ? req.query.state : '/';
        let stateParam = rawState;
        try {
            stateParam = decodeURIComponent(rawState);
        } catch {
            /* Express may already decode query params */
        }
        if (!code) {
            res.status(400).send('Missing code from GitHub OAuth');
            return;
        }
        const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
        const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
        if (!clientId || !clientSecret) {
            res.status(503).send('GitHub OAuth not configured');
            return;
        }

        const oauthCb = `${backendBase()}/api/auth/github/callback`;

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
                    redirect_uri: oauthCb,
                }),
            });
            const tokenJson = (await tokenRes.json()) as {
                access_token?: string;
                error?: string;
                error_description?: string;
            };
            if (!tokenJson.access_token) {
                const hint = tokenJson.error_description
                    ? `${tokenJson.error ?? 'error'}: ${tokenJson.error_description}`
                    : (tokenJson.error ?? 'no token');
                console.error('[auth] GitHub token exchange failed:', hint, { redirect_uri: oauthCb });
                const msg502 = `GitHub token exchange failed: ${hint}. Check that the OAuth app callback URL is exactly: ${oauthCb}`;
                if (req.accepts('html')) {
                    res.status(502)
                        .type('html')
                        .send(
                            `<!DOCTYPE html><html lang="en"><meta charset="utf-8"/><title>OAuth error</title><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:42rem;line-height:1.5"><h1>Could not complete GitHub sign-in</h1><p><strong>${escapeHtml(msg502)}</strong></p><p>Common fix: in GitHub → Settings → Developer settings → OAuth App → <strong>Authorization callback URL</strong> must match <code>${escapeHtml(oauthCb)}</code> exactly (including <code>http</code> vs <code>https</code> and port).</p><p><a href="${frontendBase()}/login">Back to login</a></p></body></html>`,
                        );
                    return;
                }
                res.status(502).send(msg502);
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

            const emailLower = email.toLowerCase();

            let user = await User.findOne({ githubId: ghUser.id }).exec();
            if (!user) {
                user = await User.findOne({ email: emailLower }).exec();
                if (user) {
                    if (user.githubId != null && user.githubId !== ghUser.id) {
                        const msg =
                            'This email is already linked to a different GitHub account. Sign in with email/password or use the matching GitHub account.';
                        if (req.accepts('html')) {
                            res.status(409)
                                .type('html')
                                .send(
                                    `<!DOCTYPE html><html lang="en"><meta charset="utf-8"/><title>Account conflict</title><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:40rem"><h1>GitHub sign-in blocked</h1><p>${msg}</p><p><a href="${frontendBase()}/login">Back to login</a></p></body></html>`,
                                );
                            return;
                        }
                        res.status(409).send(msg);
                        return;
                    }
                    user.githubId = ghUser.id;
                    user.githubLogin = ghUser.login;
                    if (ghUser.name) {
                        user.displayName = ghUser.name;
                    }
                } else {
                    user = new User({
                        email: emailLower,
                        githubId: ghUser.id,
                        githubLogin: ghUser.login,
                        ...(ghUser.name ? { displayName: ghUser.name } : {}),
                    });
                }
            } else {
                user.email = emailLower;
                user.githubLogin = ghUser.login;
                if (ghUser.name) {
                    user.displayName = ghUser.name;
                }
            }

            await user.save();

            const sessionToken = signSession({ sub: String(user._id), email: user.email });
            const next = sanitizePostLoginPath(stateParam);
            const redirect = new URL(`${frontendBase()}/auth/finish`);
            redirect.searchParams.set('token', sessionToken);
            redirect.searchParams.set('next', next);
            res.redirect(redirect.toString());
        } catch (err) {
            console.error('[auth] github callback failed', err);
            const detail =
                err instanceof Error
                    ? err.message
                    : typeof err === 'string'
                      ? err
                      : 'Unknown error';
            let hint =
                'Check the API terminal logs. Typical causes: MongoDB not running or wrong MONGO_URI; JWT_SECRET unset or shorter than 8 characters; duplicate user constraint.';
            if (detail.includes('JWT_SECRET')) {
                hint = 'Set JWT_SECRET in backend .env to a random string of at least 8 characters, then restart the server.';
            }
            if (detail.includes('ECONNREFUSED') || detail.includes('Mongo')) {
                hint = 'Ensure MongoDB is running and MONGO_URI in .env is correct.';
            }
            if (req.accepts('html')) {
                res.status(500)
                    .type('html')
                    .send(
                        `<!DOCTYPE html><html lang="en"><meta charset="utf-8"/><title>OAuth callback error</title><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:48rem;line-height:1.5"><h1>GitHub OAuth callback failed</h1><p><strong>Details:</strong> ${escapeHtml(detail)}</p><p>${escapeHtml(hint)}</p><p><a href="${frontendBase()}/login">Back to login</a></p></body></html>`,
                    );
                return;
            }
            res.status(500).json({ error: 'GitHub OAuth callback failed', detail, hint });
        }
    });

    app.use('/api/auth', router);
}
