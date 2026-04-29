import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';
import RepoConfig, { type IRepoConfig } from '../models/RepoConfig.js';
import mongoose from 'mongoose';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3001);
const mongoUri = process.env.MONGO_URI;

//Connect to MongoDB
if (!mongoUri) {
    console.error('MONGO_URI is missing. Set it in the environment before starting the server.');
} else {
    mongoose.connect(mongoUri)
        .then(() => console.log('Connected to MongoDB!'))
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

function runPythonReview(prompt: string, diff: string): Promise<string> {
    const pythonBin = process.env.PYTHON_BIN || 'python';
    const scriptPath = process.env.PYTHON_SCRIPT_PATH
        ? path.resolve(process.cwd(), process.env.PYTHON_SCRIPT_PATH)
        : path.resolve(__dirname, '..', '..', '..', 'pythonExploit.py');

    return new Promise((resolve, reject) => {
        const child = spawn(pythonBin, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
            },
        });

        const timeoutMs = 90_000;
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`python review timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            const output = stdout.trim();

            if (code === 0 && output) {
                resolve(output);
                return;
            }

            if (output) {
                console.warn('Python review returned non-zero status, using fallback output:', stderr.trim());
                resolve(output);
                return;
            }

            reject(new Error(`python review failed with code ${code}. stderr: ${stderr.trim()}`));
        });

        child.stdin.write(JSON.stringify({ prompt, diff }));
        child.stdin.end();
    });
}

type RepoConfigSnapshot = Pick<IRepoConfig, 'focusAreas' | 'enforcementLevel' | 'useAstGrep' | 'customRules'>;

function getEffectiveRepoConfig(repoConfig: RepoConfigSnapshot | null) {
    return {
        focusAreas: repoConfig?.focusAreas?.length ? repoConfig.focusAreas : ['security', 'style'],
        enforcementLevel: repoConfig?.enforcementLevel ?? 'warning',
        useAstGrep: repoConfig?.useAstGrep ?? false,
        customRules: repoConfig?.customRules?.trim() || 'Ensure standard REST principles are followed.',
    };
}

function normalizeDiffPayload(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload.trim();
    }

    if (payload == null) {
        return '';
    }

    try {
        const serialized = JSON.stringify(payload, null, 2);
        return serialized.trim();
    } catch {
        return String(payload).trim();
    }
}

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

        if (!repoOwner || !repoName || !prNumber || !repoFullName) {
            throw new Error('missing required repository/PR fields in webhook payload');
        }

        const repoConfig = await RepoConfig.findOne({ repoFullName }).lean<RepoConfigSnapshot | null>();
        const effectiveConfig = getEffectiveRepoConfig(repoConfig);

        console.log("Downloading code diffs from Github...");
        const { data: prDiffPayload } = await octokit.rest.pulls.get({
            owner: repoOwner,
            repo: repoName,
            pull_number: prNumber,
            mediaType: {
                format: "diff",
            },
        });

        const normalizedDiff = normalizeDiffPayload(prDiffPayload);
        const diffString = normalizedDiff.slice(0, 10_000);
        const hasDiff = diffString.length > 0;
        if (!hasDiff) {
            console.warn(`No diff content available for PR #${prNumber}; continuing with metadata-only review.`);
        }
        
        console.log(`Analyzing PR #${prNumber}: ${prTitle}`);

        const prompt = `You are a senior software engineer reviewing a pull request.
Repository: ${repoFullName}
PR title: ${prTitle}
PR description: ${prDescription}
Enforcement level: ${effectiveConfig.enforcementLevel}
Focus areas: ${effectiveConfig.focusAreas.join(', ')}
Use ast-grep signal: ${effectiveConfig.useAstGrep ? 'yes' : 'no'}
Additional repository rules: ${effectiveConfig.customRules}
Diff status: ${hasDiff ? 'available (truncated to 10k chars if needed)' : 'missing'}

Please provide a detailed and actionable review based on this context and prioritize findings from the provided code diff.
Focus on architecture, potential edge cases, security concerns, and keep a professional tone.

BEGIN_DIFF
${hasDiff ? diffString : '[No diff content returned by GitHub API]'}
END_DIFF`;

        console.log('Generating review with AI...');
        const aiReviewText = await runPythonReview(prompt, diffString);

        await octokit.rest.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: prNumber,
            body: `Automated review\n\n${aiReviewText}`,
        });

        console.log('Review posted to GitHub.');
    } catch (error) {
        console.error('Error processing webhook:', error);
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log('Waiting for GitHub app webhooks...');
});