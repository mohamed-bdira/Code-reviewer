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
    githubWebhook: {
        method: string;
        path: string;
        event: string;
        actions: string[];
        postsPrComment: boolean;
    };
    scheduledBugScan: ScheduledScanSnapshot;
    aiReview: {
        pythonBin: string;
        pythonScriptPathEnvSet: boolean;
        defaultRelativeScript: string;
        noCookieTokenAuthNote: string;
        pipelineSteps: string[];
    };
    restEndpoints: { method: string; path: string; description: string }[];
};
