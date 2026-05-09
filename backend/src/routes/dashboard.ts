import type { Express, Request, Response } from 'express';
import mongoose from 'mongoose';
import PrReviewFinding from '../../models/PrReviewFinding.js';
import RepoConfig from '../../models/RepoConfig.js';
import { readScheduledScanEnv } from '../scheduler/bugScan.js';

type RepoRow = {
    repoFullName: string;
    focusAreas: string[];
    enforcementLevel: string;
    useAstGrep: boolean;
    customRules: string;
    mergeMinScore: number;
    createdAt?: string;
    updatedAt?: string;
};

export type DashboardSummary = {
    generatedAt: string;
    serverPort: number;
    mongodb: {
        uriConfigured: boolean;
        connected: boolean;
        readyState: number;
    };
    findings: {
        totalStored: number | null;
        topCategories: { category: string; count: number }[];
    };
    reposConfigured: number;
    repos: RepoRow[];
    githubWebhook: {
        method: string;
        path: string;
        event: string;
        actions: string[];
        postsPrComment: boolean;
    };
    githubAppCredentials: {
        appIdConfigured: boolean;
        installationIdConfigured: boolean;
        pemPathRelative: string;
    };
    scheduledBugScan: ReturnType<typeof readScheduledScanEnv>;
    aiReview: {
        pythonBin: string;
        pythonScriptPathEnvSet: boolean;
        defaultRelativeScript: string;
        noCookieTokenAuthNote: string;
        pipelineSteps: string[];
    };
    restEndpoints: { method: string; path: string; description: string }[];
    repositoryExtras: {
        githubActionsWorkflow: string;
        description: string;
    };
};

async function aggregateFindingStats(): Promise<{
    totalStored: number | null;
    topCategories: { category: string; count: number }[];
}> {
    if (mongoose.connection.readyState !== 1) {
        return { totalStored: null, topCategories: [] };
    }
    try {
        const agg = await PrReviewFinding.aggregate<{
            total: { n: number }[];
            cats: { _id: string; count: number }[];
        }>([
            {
                $facet: {
                    total: [{ $count: 'n' }],
                    cats: [{ $sortByCount: '$category' }, { $limit: 24 }],
                },
            },
        ]).exec();
        const bucket = agg[0];
        const totalStored = bucket?.total?.[0]?.n ?? 0;
        const topCategories = (bucket?.cats ?? []).map((c) => ({
            category: String(c._id),
            count: c.count,
        }));
        return { totalStored, topCategories };
    } catch {
        return { totalStored: null, topCategories: [] };
    }
}

export function registerDashboardRoutes(app: Express): void {
    app.get('/api/dashboard/summary', async (_req: Request, res: Response) => {
        const port = Number(process.env.PORT ?? 3001);
        let repos: RepoRow[] = [];
        let reposConfigured = 0;

        try {
            if (mongoose.connection.readyState === 1) {
                const docs = await RepoConfig.find().sort({ repoFullName: 1 }).lean().exec();
                reposConfigured = docs.length;
                repos = docs.map((doc) => {
                    const d = doc as unknown as Record<string, unknown>;
                    const row: RepoRow = {
                        repoFullName: String(doc.repoFullName),
                        focusAreas: [...(doc.focusAreas ?? [])],
                        enforcementLevel: String(doc.enforcementLevel ?? 'warning'),
                        useAstGrep: Boolean(doc.useAstGrep),
                        customRules: String(doc.customRules ?? ''),
                        mergeMinScore: Number(doc.mergeMinScore ?? 70),
                    };
                    if (d.createdAt instanceof Date) {
                        row.createdAt = d.createdAt.toISOString();
                    }
                    if (d.updatedAt instanceof Date) {
                        row.updatedAt = d.updatedAt.toISOString();
                    }
                    return row;
                });
            }
        } catch {
            repos = [];
        }

        const findingStats = await aggregateFindingStats();

        const summary: DashboardSummary = {
            generatedAt: new Date().toISOString(),
            serverPort: port,
            mongodb: {
                uriConfigured: Boolean(process.env.MONGO_URI?.trim()),
                connected: mongoose.connection.readyState === 1,
                readyState: mongoose.connection.readyState,
            },
            findings: findingStats,
            reposConfigured,
            repos,
            githubWebhook: {
                method: 'POST',
                path: '/api/webhooks/github',
                event: 'pull_request',
                actions: ['opened', 'synchronize'],
                postsPrComment: true,
            },
            githubAppCredentials: {
                appIdConfigured: Boolean(process.env.GITHUB_APP_ID?.trim()),
                installationIdConfigured: Boolean(process.env.GITHUB_INSTALLATION_ID?.trim()),
                pemPathRelative: 'PFE/github-app-key.pem',
            },
            scheduledBugScan: readScheduledScanEnv(),
            aiReview: {
                pythonBin: process.env.PYTHON_BIN ?? 'python',
                pythonScriptPathEnvSet: Boolean(process.env.PYTHON_SCRIPT_PATH?.trim()),
                defaultRelativeScript: 'PFE/pythonExploit.py',
                noCookieTokenAuthNote:
                    'pythonExploit.py posts to the Gemini web endpoint using only minimal static HTTP headers — no Cookie, Authorization Bearer, or custom API token headers.',
                pipelineSteps: [
                    'Webhook or scheduler triggers reviewPullRequest',
                    'Octokit loads PR diff via fetchPrDiffString (multiple GitHub REST fallbacks)',
                    'Senior-engineer prompt: scores, notes, blockers, concrete bugs[] with optional line ranges',
                    'pythonExploit streams JSON { prompt, diff } to Gemini and returns review text',
                    'parseEnforcerResponse extracts fenced JSON plus prose; merge thresholds + SECURITY_VETO',
                    'formatEnforcerGithubBody posts scores, blockers, diff excerpt, prose, bug table (category / file / lines / description), recorded count',
                    'upsertPrReviewFindings persists each bug by SHA-256 dedupeKey with firstSeenAt / lastSeenAt',
                ],
            },
            restEndpoints: [
                { method: 'POST', path: '/api/webhooks/github', description: 'GitHub App webhook: PR opened/sync' },
                { method: 'GET', path: '/api/findings', description: 'List persisted AI bugs (filters, paging)' },
                { method: 'GET', path: '/api/findings/by-category', description: 'Category counts with same filters' },
                {
                    method: 'GET',
                    path: '/api/dashboard/summary',
                    description: 'Runtime + config snapshot for dashboards (this response)',
                },
            ],
            repositoryExtras: {
                githubActionsWorkflow: '.github/workflows/ai-review.yml',
                description:
                    'Separate CI path runs .github/scripts/review.js via actions/github-script (Node) on pull_request opened/synchronize — independent from the Atlas/Mongo webhook service.',
            },
        };

        res.json(summary);
    });
}
