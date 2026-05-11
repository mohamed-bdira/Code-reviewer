import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import Installation from '../models/Installation.js';
import RepoConfig from '../models/RepoConfig.js';
import { getInstallationOctokit } from './github/octokit.js';
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

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3001);
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    console.error('MONGO_URI is missing. Set it in the environment before starting the server.');
} else {
    mongoose
        .connect(mongoUri)
        .then(async () => {
            console.log('Connected to MongoDB');
            try {
                await RepoConfig.syncIndexes();
            } catch (err) {
                console.error('[mongo] RepoConfig.syncIndexes failed (check for stale unique indexes):', err);
            }
        })
        .catch((err) => console.error('MongoDB connection error:', err));
}

app.use(cors({
    origin: (process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    credentials: false,
}));

app.post('/api/webhooks/github', express.raw({ type: 'application/json' }), async (req, res) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const rawBody = req.body as Buffer;
    if (secret) {
        const ok = verifyGithubSignature256(rawBody, req.headers['x-hub-signature-256'], secret);
        if (!ok) {
            res.status(401).send('Invalid webhook signature');
            return;
        }
    }
    res.status(200).send('Webhook received');

    try {
        const payload = JSON.parse(String(rawBody ?? '{}'));
        const action = payload.action;

        if (action !== 'opened' && action !== 'synchronize') {
            return;
        }

        const installationId = payload.installation?.id;
        if (!installationId) {
            console.warn('[webhook] missing installation.id in payload; skipping');
            return;
        }

        const install = await Installation.findOne({ installationId: String(installationId) }).exec();
        if (!install) {
            console.warn(`[webhook] no Installation linked for installationId=${installationId}; skipping`);
            return;
        }
        const userId = String(install.userId);

        if (process.env.REQUIRE_API_KEY_FOR_REVIEWS === 'true') {
            const hasKey = await userHasActiveApiKey(userId);
            if (!hasKey) {
                console.warn(
                    `[webhook] REQUIRE_API_KEY_FOR_REVIEWS: user ${userId} has no active API key; skipping review`,
                );
                return;
            }
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
            throw new Error('missing required repository/PR fields in webhook payload');
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
    } catch (error) {
        console.error('Error processing webhook:', error);
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
