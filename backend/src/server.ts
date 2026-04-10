import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

const geminiKey = process.env.GEMINI_API_KEY;
const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

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

    console.log(`Event: ${String(event)} | Action: ${String(action)}`);

    if (event === 'ping') {
        const hookId = req.body?.hook_id;
        console.log(
            `GitHub ping OK — webhook URL is correct (hook_id=${hookId ?? '?'}). PR opened/synchronize events will log here.`,
        );
        return;
    }

    if (event === 'pull_request' && (action === 'opened' || action === 'synchronize') && pr && repo) {
        console.log('New PR activity (opened or synchronize)');
        console.log(`Repository: ${repo.full_name}`);
        console.log(`PR title: ${pr.title}`);

        try {
            if (!genAI) {
                console.error('GEMINI_API_KEY is not set; skipping Gemini review.');
                return;
            }

            console.log('Sending PR details to gemini for review...');

            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

            //The prompt
            const prompt = `
                You are an expert Senior Software Engineer reviewing code.
                A junior developer just opened a new Pull Request.

                Title: ${pr.title}
                Description: ${pr.body || "No description provided."}

                Provide a sort of short, encouraging and professional review of what you expect to see in a PR with this title and description. Keep it under 4 paragraphs.
            `;

            //To gemini it goes
            const result = await model.generateContent(prompt);
            const response = result.response.text();

            console.log("-Gemini Review-");
            console.log(response);

        } catch (error) {
            console.error('Error talking to Gemini.', error);
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
    console.log(
        webhookSecret
            ? 'Webhook HMAC verification enabled (GITHUB_WEBHOOK_SECRET).'
            : 'Webhook HMAC verification off — add GITHUB_WEBHOOK_SECRET to match the secret in GitHub webhook settings',
    );
});