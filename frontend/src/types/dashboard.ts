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
        focusAreas: string[];
        enforcementLevel: string;
        useAstGrep: boolean;
        customRules: string;
        mergeMinScore: number;
        createdAt?: string;
        updatedAt?: string;
    }[];
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
    scheduledBugScan: ScheduledScanSnapshot;
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
