import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';
import mongoose from 'mongoose';
import RepoConfig from '../models/RepoConfig.js';
import { getEffectiveRepoConfig } from './review/effectiveRepoConfig.js';
import { reviewPullRequest } from './review/reviewPullRequest.js';
import { registerFindingsRoutes } from './routes/findings.js';
import { startBugScanScheduler } from './scheduler/bugScan.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3001);
const mongoUri = process.env.MONGO_URI;

//Connect to MongoDB
if (!mongoUri) {
    console.error('MONGO_URI is missing. Set it in the environment before starting the server.');
} else {
    mongoose
        .connect(mongoUri)
        .then(() => console.log('Connected to MongoDB'))
        .catch((err) => console.error('MongoDB connection error:', err));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const privateKeyPath = path.resolve(__dirname, '..', '..', 'github-app-key.pem');
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
        appId: process.env.GITHUB_APP_ID,
        privateKey,
        installationId: process.env.GITHUB_INSTALLATION_ID,
    },
});

app.post('/api/webhooks/github', express.raw({ type: 'application/json' }), async (req, res) => {
    res.status(200).send('Webhook received');

    try {
        const payload = JSON.parse(String(req.body ?? '{}'));
        const action = payload.action;

        if (action !== 'opened' && action !== 'synchronize') {
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
            throw new Error('missing required repository/PR fields in webhook payload');
        }

        let config = await RepoConfig.findOne({ repoFullName });

        if (!config) {
            console.log('No config found in DB, creating default and saving to Atlas...');
            config = new RepoConfig({
                installationId: String(process.env.GITHUB_INSTALLATION_ID ?? ''),
                repoFullName,
            });
            await config.save();
            console.log('✅ New repository config saved to Database!');
        }

        const effectiveConfig = getEffectiveRepoConfig(config.toObject());

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
        });
    } catch (error) {
        console.error('Error processing webhook:', error);
    }
});

app.use(cors());
registerFindingsRoutes(app);

let stopBugScan: (() => void) | undefined;

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log('Waiting for GitHub app webhooks...');
    stopBugScan = startBugScanScheduler({
        octokit,
        mongoUri,
    });
});

process.on('SIGTERM', () => stopBugScan?.());
