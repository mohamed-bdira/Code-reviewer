import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import Installation from '../models/Installation.js';
import RepoConfig from '../models/RepoConfig.js';
import { getAppOctokit, getInstallationOctokit } from './github/octokit.js';
import { getEffectiveRepoConfig } from './review/effectiveRepoConfig.js';
import { userHasActiveApiKey } from './auth/apiKeys.js';
import { reviewPullRequest } from './review/reviewPullRequest.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerEventRoutes } from './routes/events.js';
import { registerFindingsRoutes } from './routes/findings.js';
import { registerInstallationRoutes } from './routes/installations.js';
import { registerKeyRoutes } from './routes/keys.js';
import { registerRepoConfigRoutes } from './routes/repoConfigs.js';
import { startBugScanScheduler } from './scheduler/bugScan.js';
import { verifyGithubSignature256 } from './githubWebhook.js';
import { describeMissingMongoEnv, resolveMongoUri } from './config/mongoUri.js';
import { buildHealthSnapshot, logStartupChecklist } from './config/startupChecks.js';

dotenv.config({ quiet: process.env.NODE_ENV === 'production' });

const app = express();
const port = Number(process.env.PORT ?? 3001);
const mongoUri = resolveMongoUri();

if (!mongoUri) {
    console.error(`[mongo] ${describeMissingMongoEnv()}`);
} else {
    mongoose
        .connect(mongoUri)
        .then(async () => {
            console.log('Connected to MongoDB');
            logStartupChecklist(mongoose.connection.readyState);
            try {
                await RepoConfig.syncIndexes();
            } catch (err) {
                console.error('[mongo] RepoConfig.syncIndexes failed (check for stale unique indexes):', err);
            }
        })
        .catch((err) => {
            console.error('MongoDB connection error:', err);
            logStartupChecklist(mongoose.connection.readyState);
        });
}

logStartupChecklist(mongoose.connection.readyState);

app.use(cors({
    origin: (process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    credentials: false,
}));

app.get('/', (_req, res) => {
    const health = buildHealthSnapshot(mongoose.connection.readyState);
    res.status(health.ok ? 200 : 503).json({
        service: 'backend-api',
        ...health,
    });
});

app.get('/health', (_req, res) => {
    const health = buildHealthSnapshot(mongoose.connection.readyState);
    res.status(health.ok ? 200 : 503).json(health);
});

app.post('/api/webhooks/github', express.raw({ type: 'application/json' }), async (req, res) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const rawBody = req.body as Buffer;
    if (secret) {
        const ok = verifyGithubSignature256(rawBody, req.headers['x-hub-signature-256'], secret);
        if (!ok) {
            console.warn('[webhook] SKIP: invalid webhook signature (check GITHUB_WEBHOOK_SECRET matches GitHub App)');
            res.status(401).send('Invalid webhook signature');
            return;
        }
    }
    res.status(200).send('Webhook received');

    try {
        const payload = JSON.parse(String(rawBody ?? '{}'));
        const action = payload.action;
        const ghEvent = String(req.headers['x-github-event'] ?? '');

        console.log(`[webhook] ${ghEvent} action=${String(action ?? '(none)')} delivery=${req.headers['x-github-delivery'] ?? '?'}`);

        if (ghEvent !== 'pull_request') {
            console.log(`[webhook] SKIP: event type "${ghEvent}" (only pull_request triggers review)`);
            return;
        }

        if (action !== 'opened' && action !== 'synchronize') {
            console.log(
                `[webhook] SKIP: pull_request action "${String(action ?? '(none)')}" (only opened/synchronize trigger review)`,
            );
            return;
        }

        const prTitle = payload.pull_request?.title || 'No title.';
        const prDescription = payload.pull_request?.body || 'No description.';
        const repoOwner = payload.repository?.owner?.login;
        const repoName = payload.repository?.name;
        const prNumber = payload.pull_request?.number;
        const repoFullName = payload.repository?.full_name || `${repoOwner}/${repoName}`;
        const baseSha: string | undefined = payload.pull_request?.base?.sha;
        const headSha: string | undefined = payload.pull_request?.head?.sha;

        if (!repoOwner || !repoName || !prNumber || !repoFullName) {
            console.warn('[webhook] SKIP: missing repository owner, name, or PR number in payload');
            return;
        }

        if (mongoose.connection.readyState !== 1) {
            console.warn(
                '[webhook] SKIP: MongoDB not connected — set MONGO_URI on Railway to the same Atlas DB where you linked the GitHub App installation',
            );
            return;
        }

        let installationIdRaw: number | string | undefined = payload.installation?.id;

        if (installationIdRaw === undefined || installationIdRaw === null) {
            try {
                const appOctokit = getAppOctokit();
                const { data } = await appOctokit.rest.apps.getRepoInstallation({
                    owner: repoOwner,
                    repo: repoName,
                });
                installationIdRaw = data.id;
                console.log(
                    `[webhook] resolved installation id ${installationIdRaw} via getRepoInstallation (${repoFullName})`,
                );
            } catch (err) {
                console.warn(
                    `[webhook] SKIP: installation.id missing and getRepoInstallation failed for ${repoFullName}. Install the GitHub App on this repo and set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY:`,
                    err,
                );
                return;
            }
        }

        const installationId = String(installationIdRaw);

        const install = await Installation.findOne({ installationId }).exec();
        if (!install) {
            console.warn(
                `[webhook] SKIP: no Installation linked for installationId=${installationId}. Link the app in the dashboard (Configurations → Install on GitHub) using the same MongoDB as Railway.`,
            );
            return;
        }
        const userId = String(install.userId);

        if (process.env.REQUIRE_API_KEY_FOR_REVIEWS === 'true') {
            const hasKey = await userHasActiveApiKey(userId);
            if (!hasKey) {
                console.warn(
                    `[webhook] SKIP: REQUIRE_API_KEY_FOR_REVIEWS is enabled but user ${userId} has no active API key in MongoDB`,
                );
                return;
            }
        }

        let config = await RepoConfig.findOne({ userId: install.userId, repoFullName }).exec();

        if (!config) {
            console.log(`[webhook] No RepoConfig for user ${userId} / ${repoFullName}; upserting defaults...`);
            try {
                config = await RepoConfig.findOneAndUpdate(
                    { userId: install.userId, repoFullName },
                    {
                        $set: { installationId: String(installationId) },
                        $setOnInsert: {
                            userId: install.userId,
                            repoFullName,
                        },
                    },
                    { upsert: true, new: true, runValidators: true },
                ).exec();
            } catch (err) {
                const dup =
                    err &&
                    typeof err === 'object' &&
                    'code' in err &&
                    (err as { code?: number }).code === 11_000;
                if (dup) {
                    config = await RepoConfig.findOne({ userId: install.userId, repoFullName }).exec();
                }
                if (!config) {
                    throw err;
                }
            }
        } else if (config.installationId !== String(installationId)) {
            config.installationId = String(installationId);
            await config.save();
        }

        if (!config) {
            throw new Error(`RepoConfig missing after upsert for ${userId} / ${repoFullName}`);
        }

        const effectiveConfig = getEffectiveRepoConfig(config.toObject());
        const octokit = getInstallationOctokit(installationId);

        console.log(`[webhook] starting review for ${repoFullName}#${prNumber} user=${userId} installation=${installationId}`);
        await reviewPullRequest({
            octokit,
            repoOwner,
            repoName,
            repoFullName,
            prNumber,
            prTitle,
            prDescription,
            ...(baseSha !== undefined ? { baseSha } : {}),
            ...(headSha !== undefined ? { headSha } : {}),
            effectiveConfig,
            postComment: true,
            ...(mongoUri !== undefined ? { mongoUri } : {}),
            userId,
        });
        console.log(`[webhook] review finished for ${repoFullName}#${prNumber}`);
    } catch (error) {
        console.error(`[webhook] review failed for PR processing:`, error);
    }
});

registerAuthRoutes(app);
registerInstallationRoutes(app);
registerKeyRoutes(app);
registerRepoConfigRoutes(app);
registerEventRoutes(app);
registerDashboardRoutes(app);
registerFindingsRoutes(app);

let stopBugScan: (() => void) | undefined;

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log('Waiting for GitHub app webhooks...');
    stopBugScan = startBugScanScheduler({ mongoUri });
});

process.on('SIGTERM', () => stopBugScan?.());
