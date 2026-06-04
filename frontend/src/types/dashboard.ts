export type ScheduledScanSnapshot = {
    enabled: boolean;
    intervalMinutes: number;
    maxPrsPerRepo: number;
    postComments: boolean;
    skipUnchanged: boolean;
    runOnStart: boolean;
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
    repos: {
        repoFullName: string;
        installationId: string;
        focusAreas: string[];
        enforcementLevel: string;
        useAstGrep: boolean;
        customRules: string;
        mergeMinScore: number;
        createdAt?: string;
        updatedAt?: string;
    }[];
    installations: {
        id: string;
        installationId: string;
        accountLogin: string;
        accountType: 'User' | 'Organization';
        createdAt: string;
    }[];
    reviews: {
        postsPrComment: boolean;
    };
    scheduledBugScan: ScheduledScanSnapshot;
};
