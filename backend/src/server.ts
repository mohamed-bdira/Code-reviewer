import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3001);

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

function runPythonReview(prompt: string): Promise<string> {
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

        child.stdin.write(prompt);
        child.stdin.end();
    });
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

        if (!repoOwner || !repoName || !prNumber) {
            throw new Error('missing required repository/PR fields in webhook payload');
        }

        console.log(`Analyzing PR #${prNumber}: ${prTitle}`);

        const prompt = `You are a senior software engineer reviewing a pull request.
PR title: ${prTitle}
PR description: ${prDescription}

Please provide a detailed and actionable review based on this context.
Focus on architecture, potential edge cases, security concerns, and keep a professional tone.`;

        console.log('Generating review with pythonExploit.py...');
        const aiReviewText = await runPythonReview(prompt);

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