export type PrReviewFinding = {
    _id: string;
    dedupeKey?: string;
    repoFullName: string;
    prNumber: number;
    category: string;
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    linesAffected?: number;
    description: string;
    firstSeenAt?: string;
    lastSeenAt?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type FindingsListResponse = {
    items: PrReviewFinding[];
    total: number;
    skip: number;
    limit: number;
};

export type CategoryCountsResponse = {
    counts: Record<string, number>;
};
