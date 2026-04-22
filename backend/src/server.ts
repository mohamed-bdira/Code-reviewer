import express from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { verifyGithubSignature256, type RequestWithRawBody } from './githubWebhook.js';

//Load the api key
dotenv.config();

const app = express();
app.use(
    express.json({
        limit: '10mb',
        verify: (req, _res, buf) => {
            (req as RequestWithRawBody).rawBody = buf;
        },
    }),
);

const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pythonExploitPath = path.resolve(__dirname, '../../pythonExploit.py');

function buildReviewPrompt(title: string, description: string) {
    return `
You are an expert Senior Software Engineer reviewing code.
A junior developer just opened a new Pull Request.

Title: ${title}
Description: ${description || 'No description provided.'}

Provide a short, encouraging and professional review of what you expect to see in a PR with this title and description. Keep it under 4 paragraphss.
`.trim();
}

async function runPythonExploitReview(prompt: string): Promise<string> {
    return await new Promise((resolve, reject) => {
        const pyRunner = `
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
prompt = sys.argv[2]
source = script_path.read_text(encoding="utf-8")
marker = "# ===== CHAT LOOP ====="
if marker in source:
    source = source.split(marker)[0]
scope = {}
exec(source, scope)
ask = scope.get("ask")
if not callable(ask):
    raise RuntimeError("ask(prompt) function not found in pythonExploit.py")
result = ask(prompt)
print("" if result is None else str(result))
`.trim();

        const child = spawn('python', ['-c', pyRunner, pythonExploitPath, prompt], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('pythonExploit timed out after 45 seconds'));
        }, 45_000);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                reject(new Error(`pythonExploit exited with code ${code}: ${stderr.trim() || 'no stderr'}`));
                return;
            }
            const review = stdout.trim();
            if (!review) {
                reject(new Error('pythonExploit returned an empty response'));
                return;
            }
            resolve(review);
        });
    });
}

const githubWebhookHandler = async (req: express.Request, res: express.Response) => {
    console.log('🚪 Webhook hit:', req.path);

    if (webhookSecret) {
        const raw = (req as RequestWithRawBody).rawBody;
        const sig = req.headers['x-hub-signature-256'];
        if (!raw || !verifyGithubSignature256(raw, sig, webhookSecret)) {
            console.warn('Webhook rejected: invalid or missing X-Hub-Signature-256');
            res.status(401).send('Invalid signatur');
            return;
        }
    }

    res.status(200).send('Webhook received.');

    const event = req.headers['x-github-event'];
    const action = req.body?.action;
    const pr = req.body?.pull_request;
    const repo = req.body?.repository;

    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
        console.warn('Webhook body empty or not JSON — check Content-Type and body size limits.');
        return;
    }

    if (action) {
        console.log(`Event: ${String(event)} | Action: ${String(action)}`);
    } else {
        console.log(`Event: ${String(event)}`);
    }

    if (event === 'ping') {
        const hookId = req.body?.hook_id;
        console.log(
            `GitHub ping OK — webhook URL is correct (hook_id=${hookId ?? '?'}). PR opened/synchronize events will log here.`,
        );
        return;
    }

    if (event === 'push') {
        console.log(`Push received for ${repo?.full_name ?? 'unknown repository'}; no AI review needed.`);
        return;
    }

    if (event === 'pull_request' && (action === 'opened' || action === 'synchronize') && pr && repo) {
        console.log('New PR activity (opened or synchronize)');
        console.log(`Repository: ${repo.full_name}`);
        console.log(`PR title: ${pr.title}`);

        try {
            console.log('Sending PR details to pythonExploit chatbot for review...');
            const prompt = buildReviewPrompt(pr.title, pr.body || '');
            const response = await runPythonExploitReview(prompt);

            console.log("-Gemini Review-");
            console.log(response);

        } catch (error) {
            console.error('Error talking to pythonExploit chatbot.', error);
        }
    } else {
        console.log(`Ignored or unsupported: event=${String(event)} action=${String(action)} (has PR: ${Boolean(pr)})`);
    }
};

app.post('/api/webhooks/github', githubWebhookHandler);
app.post('/api/webhook/github', githubWebhookHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend successfully running on http://localhost:${PORT}`);
    console.log('Classic GitHub webhook: POST /api/webhooks/github (or /api/webhook/github)');
    console.log(`PR review provider: pythonExploit (${pythonExploitPath}) via 'python' command.`);
    console.log(
        webhookSecret
            ? 'Webhook HMAC verification enabled (GITHUB_WEBHOOK_SECRET).'
            : 'Webhook HMAC verification off — add GITHUB_WEBHOOK_SECRET to match the secret in GitHub webhook settings',
    );
});