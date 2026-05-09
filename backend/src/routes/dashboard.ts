import type { Express, Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import Installation from '../../models/Installation.js';
import PrReviewFinding from '../../models/PrReviewFinding.js';
import RepoConfig from '../../models/RepoConfig.js';
import { requireAuth } from '../auth/middleware.js';
import { matchFindingsVisibleToUser } from '../findings/findingVisibility.js';
import { readScheduledScanEnv } from '../scheduler/bugScan.js';

type RepoRow = {
    repoFullName: string;
    installationId: string;
    focusAreas: string[];
    enforcementLevel: string;
    useAstGrep: boolean;
    customRules: string;
    mergeMinScore: number;
    createdAt?: string;
    updatedAt?: string;
};

type InstallationRow = {
    id: string;
    installationId: string;
    accountLogin: string;
    accountType: 'User' | 'Organization';
    createdAt: string;
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
    installations: InstallationRow[];
    githubWebhook: {
        method: string;
        path: string;
        event: string;
        actions: string[];
        postsPrComment: boolean;
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
};

async function aggregateFindingStats(userId: string): Promise<{
    totalStored: number | null;
    topCategories: { category: string; count: number }[];
}> {
    if (mongoose.connection.readyState !== 1) {
        return { totalStored: null, topCategories: [] };
    }
    try {
        const visibility = await matchFindingsVisibleToUser(userId);
        const agg = await PrReviewFinding.aggregate<{
            total: { n: number }[];
            cats: { _id: string; count: number }[];
        }>([
            { $match: visibility },
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
    app.get('/api/dashboard/summary', requireAuth, async (req: Request, res: Response) => {
        const port = Number(process.env.PORT ?? 3001);
        const userId = req.user!._id;
        const userObjectId = new Types.ObjectId(userId);
        let repos: RepoRow[] = [];
        let reposConfigured = 0;
        let installations: InstallationRow[] = [];

        try {
            if (mongoose.connection.readyState === 1) {
                const [repoDocs, installDocs] = await Promise.all([
                    RepoConfig.find({ userId: userObjectId }).sort({ repoFullName: 1 }).lean().exec(),
                    Installation.find({ userId: userObjectId }).sort({ accountLogin: 1 }).lean().exec(),
                ]);
                reposConfigured = repoDocs.length;
                repos = repoDocs.map((doc) => {
                    const d = doc as unknown as Record<string, unknown>;
                    const row: RepoRow = {
                        repoFullName: String(doc.repoFullName),
                        installationId: String(doc.installationId ?? ''),
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
                installations = installDocs.map((doc) => {
                    const d = doc as unknown as Record<string, unknown>;
                    return {
                        id: String(doc._id),
                        installationId: String(doc.installationId),
                        accountLogin: String(doc.accountLogin),
                        accountType: doc.accountType === 'Organization' ? 'Organization' : 'User',
                        createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString(),
                    };
                });
            }
        } catch {
            repos = [];
            installations = [];
        }

        const findingStats = await aggregateFindingStats(userId);

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
            installations,
            githubWebhook: {
                method: 'POST',
                path: '/api/webhooks/github',
                event: 'pull_request',
                actions: ['opened', 'synchronize'],
                postsPrComment: true,
            },
            scheduledBugScan: readScheduledScanEnv(),
            aiReview: {
                pythonBin: process.env.PYTHON_BIN ?? 'python',
                pythonScriptPathEnvSet: Boolean(process.env.PYTHON_SCRIPT_PATH?.trim()),
                defaultRelativeScript: 'PFE/pythonExploit.py',
                noCookieTokenAuthNote:
                    'pythonExploit.py posts to the Gemini web endpoint using only minimal static HTTP headers — no Cookie, Authorization Bearer, or custom API token headers.',
                pipelineSteps: [
                    'Webhook lookup -> Installation -> userId -> RepoConfig (auto-create defaults)',
                    'reviewPullRequest fetches PR diff via fetchPrDiffString (multiple GitHub REST fallbacks)',
                    'Senior-engineer prompt: scores, notes, blockers, concrete bugs[] with line anchors in the diff',
                    'pythonExploit streams JSON { prompt, diff } to Gemini and returns review text',
                    'parseEnforcerResponse extracts fenced JSON plus prose; merge thresholds + SECURITY_VETO',
                    'parseDiffHunks + bugsToReviewComments split bugs into inline review comments and orphan bullets',
                    'octokit.rest.pulls.createReview posts ONE review with summary body + inline line comments anchored to the diff',
                    'upsertPrReviewFindings persists each bug by SHA-256 dedupeKey + emits SSE events to the owning user',
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
                { method: 'GET', path: '/api/events', description: 'SSE stream of finding/config/installation events' },
                { method: 'GET', path: '/api/repo-configs', description: 'List the current user repo configurations' },
                { method: 'GET', path: '/api/installations', description: 'List the current user GitHub App installations' },
                { method: 'GET', path: '/api/keys', description: 'List the current user API keys' },
            ],
        };

        res.json(summary);
    });
}
