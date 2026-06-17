import type { Express, Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import Installation from '../../models/Installation.js';
import PrReviewFinding from '../../models/PrReviewFinding.js';
import RepoConfig from '../../models/RepoConfig.js';
import { requireAuth } from '../auth/middleware.js';
import { DISPLAY_FINDING_CATEGORIES } from '../findings/findingCategories.js';
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
    service: {
        online: boolean;
    };
    findings: {
        totalStored: number | null;
        topCategories: { category: string; count: number }[];
    };
    reposConfigured: number;
    repos: RepoRow[];
    installations: InstallationRow[];
    reviews: {
        postsPrComment: boolean;
    };
    scheduledBugScan: ReturnType<typeof readScheduledScanEnv>;
};

async function aggregateFindingStats(userId: string): Promise<{
    totalStored: number | null;
    topCategories: { category: string; count: number }[];
}> {
    if (mongoose.connection.readyState !== 1) {
        return { totalStored: null, topCategories: [] };
    }
    try {
        const userObjectId = new Types.ObjectId(userId);
        const repoNames: string[] = await RepoConfig.find({ userId: userObjectId })
            .distinct('repoFullName')
            .exec();
        if (repoNames.length === 0) {
            return { totalStored: 0, topCategories: [] };
        }
        const visibility = await matchFindingsVisibleToUser(userId);
        const match = {
            $and: [
                visibility,
                { repoFullName: { $in: repoNames } },
                { category: { $in: [...DISPLAY_FINDING_CATEGORIES] } },
            ],
        };
        const agg = await PrReviewFinding.aggregate<{
            total: { n: number }[];
            cats: { _id: string; count: number }[];
        }>([
            { $match: match },
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
            service: {
                online: mongoose.connection.readyState === 1,
            },
            findings: findingStats,
            reposConfigured,
            repos,
            installations,
            reviews: {
                postsPrComment: true,
            },
            scheduledBugScan: readScheduledScanEnv(),
        };

        res.json(summary);
    });
}
