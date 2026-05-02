import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';
import RepoConfig, { type IRepoConfig } from '../models/RepoConfig.js';
import PrReviewFinding from '../models/PrReviewFinding.js';
import mongoose from 'mongoose';
import {
    bugRowsForDb,
    buildScoreDimensions,
    evaluateMergeReadiness,
    formatEnforcerGithubBody,
    parseEnforcerResponse,
} from './enforcer/parseEnforcerResponse.js';
import { fetchPrDiffString } from './github/fetchPrDiff.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3001);
const mongoUri = process.env.MONGO_URI;

//Connect to MongoDB
if (!mongoUri) {
    console.error('MONGO_URI is missing. Set it in the environment before starting the server.');
} else {
    mongoose.connect(mongoUri)
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

type RepoConfigSnapshot = Pick<
    IRepoConfig,
    'focusAreas' | 'enforcementLevel' | 'useAstGrep' | 'customRules' | 'mergeMinScore'
>;

function clampMergeMinScore(n: number | undefined): number {
    const v = n ?? 70;
    return Math.min(100, Math.max(0, Math.round(Number(v))));
}

function getEffectiveRepoConfig(repoConfig: RepoConfigSnapshot | null) {
    return {
        focusAreas: repoConfig?.focusAreas?.length ? repoConfig.focusAreas : ['security', 'style'],
        enforcementLevel: repoConfig?.enforcementLevel ?? 'warning',
        useAstGrep: repoConfig?.useAstGrep ?? false,
        customRules: repoConfig?.customRules?.trim() || 'Ensure standard REST principles are followed.',
        mergeMinScore: clampMergeMinScore(repoConfig?.mergeMinScore as number | undefined),
    };
}

const DIFF_MAX_FOR_AI = 10_000;
const DIFF_MAX_FOR_COMMENT = 8_000;

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

        // --- A. FETCH CONFIG FROM MONGODB ---
        // Look up this specific repository in Atlas to get the user's settings
        let config = await RepoConfig.findOne({ repoFullName });

        // If the user hasn't configured this repo yet, create it AND save it to the DB
        if (!config) {
            console.log("No config found in DB, creating default and saving to Atlas...");
            config = new RepoConfig({
                installationId: String(process.env.GITHUB_INSTALLATION_ID ?? ""),
                repoFullName,
            });

            // THIS is the magic line that actually writes to MongoDB Atlas
            await config.save();
            console.log("✅ New repository config saved to Database!");
        }

        const effectiveConfig = getEffectiveRepoConfig(config.toObject());

        console.log("Downloading code diffs from Github...");
        const rawDiff = await fetchPrDiffString(octokit, repoOwner, repoName, prNumber, baseSha, headSha);
        const diffString = rawDiff.slice(0, DIFF_MAX_FOR_AI);
        const hasDiff = diffString.length > 0;
        if (!hasDiff) {
            console.warn(`No diff content available for PR #${prNumber}; continuing with metadata-only review.`);
        }

        const diffForComment = rawDiff.slice(0, DIFF_MAX_FOR_COMMENT);
        const diffCommentTruncated = rawDiff.length > DIFF_MAX_FOR_COMMENT;
        console.log(`Analyzing PR #${prNumber}: ${prTitle}`);

        const scoreDimensions = buildScoreDimensions(effectiveConfig.focusAreas);
        const dimensionsList = scoreDimensions.join(', ');

        const prompt = `You are a senior software engineer reviewing a pull request.
Repository: ${repoFullName}
PR title: ${prTitle}
PR description: ${prDescription}
Enforcement level: ${effectiveConfig.enforcementLevel}
Focus areas: ${effectiveConfig.focusAreas.join(', ')}
Score sections (you MUST score each): ${dimensionsList}
Merge minimum (minimum of section scores must be >= this for a green merge signal): ${effectiveConfig.mergeMinScore}
Use ast-grep signal: ${effectiveConfig.useAstGrep ? 'yes' : 'no'}
Additional repository rules: ${effectiveConfig.customRules}
Diff status: ${hasDiff ? 'available (truncated to 10k chars if needed)' : 'missing'}

Provide a detailed, actionable review (architecture, edge cases, security, tone professional). Prioritize findings from the code diff.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): ${dimensionsList.split(', ').map((s) => `"${s}"`).join(', ')}. Each value is an integer from 0 to 100.
- "notes": object with the same keys as "scores"; each value is one short line explaining that score.
- "blockers": array of strings listing critical issues that must be fixed before merge; use [] if none.
- "bugs": array of objects for concrete issues to store (use [] if none). Each object: "category" (e.g. security, bug, style, usability), "file" (repo-relative path), optional "lineStart" and "lineEnd" (1-based line numbers if known), "description" (short text).

Do not put any text after the closing \`\`\` of that JSON block.

BEGIN_DIFF
${hasDiff ? diffString : '[No diff content returned by GitHub API]'}
END_DIFF`;

        console.log('Generating review with AI...');
        const aiReviewText = await runPythonReview(prompt, diffString);

        const parsed = parseEnforcerResponse(aiReviewText);
        let effectiveData = parsed.data;
        let parseError = parsed.parseError;
        if (effectiveData) {
            const scored = effectiveData;
            const missingDims = scoreDimensions.filter((d) => !(d in scored.scores));
            if (missingDims.length > 0) {
                effectiveData = null;
                parseError = `Missing scores for sections: ${missingDims.join(', ')}`;
            }
        }

        let mergeRecommended = false;
        let overall = 0;
        let reasons: string[] = [];

        if (effectiveData) {
            const ev = evaluateMergeReadiness(effectiveData, effectiveConfig.mergeMinScore);
            mergeRecommended = ev.mergeRecommended;
            overall = ev.overall;
            reasons = ev.reasons;
        } else {
            reasons = parseError ? [parseError] : ['Structured output missing.'];
        }

        let findingsRecorded: number | null = null;
        if (effectiveData && mongoUri && mongoose.connection.readyState === 1) {
            try {
                await PrReviewFinding.deleteMany({ repoFullName, prNumber });
                if (effectiveData.bugs.length > 0) {
                    await PrReviewFinding.insertMany(bugRowsForDb(effectiveData.bugs, repoFullName, prNumber));
                }
                findingsRecorded = effectiveData.bugs.length;
            } catch (err) {
                console.error('PrReviewFinding persist error:', err);
                findingsRecorded = null;
            }
        }

        const commentBody = formatEnforcerGithubBody({
            enforcementLevel: effectiveConfig.enforcementLevel,
            mergeRecommended: Boolean(effectiveData && mergeRecommended),
            overall,
            mergeMinScore: effectiveConfig.mergeMinScore,
            data: effectiveData,
            prose: parsed.prose || aiReviewText.trim(),
            reasons,
            parseError,
            diffFencedBody: diffForComment,
            diffWasTruncated: diffCommentTruncated,
            findingsRecorded,
        });

        await octokit.rest.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: prNumber,
            body: commentBody,
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