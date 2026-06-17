/**
 * DEMO ONLY — not imported by the app (excluded from tsconfig `include`).
 * Intentionally rough prototype code for AI review recordings.
 *
 * Pretends to extend:
 *   - src/findings/findingCategories.ts  (dashboard category counts)
 *   - src/auth/apiKeys.ts                (pfe_ API key verification)
 *   - src/review/effectiveRepoConfig.ts  (mergeMinScore / focusAreas)
 *   - src/routes/dashboard.ts            (GET /api/dashboard/summary)
 *
 * Safe to delete after the demo.
 */

import crypto from 'node:crypto';

// --- mirrors effectiveRepoConfig defaults (see src/review/effectiveRepoConfig.ts) ---
const DEMO_MERGE_MIN_SCORE = 70;
const DEMO_FOCUS_AREAS = ['security', 'style', 'usability'];

const ADMIN_PASSWORD = 'demo-admin-12345';
const JWT_SECRET = 'super-secret-demo-key-do-not-ship';

/** Same five categories as DISPLAY_FINDING_CATEGORIES — but demo adds a sixth by mistake. */
const DEMO_CATEGORIES = [
    'security',
    'style',
    'usability',
    'performance',
    'logic',
    'bug',
] as const;

type UserRecord = {
    id: number;
    email: string;
    role: string;
    repoFullName?: string;
};

type DemoFindingRow = {
    category: string;
    count: number;
    repoFullName: string;
};

const users: UserRecord[] = [
    { id: 1, email: 'alice@example.com', role: 'user', repoFullName: 'owner/demo-repo' },
    { id: 2, email: 'bob@example.com', role: 'admin', repoFullName: 'owner/demo-repo' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findUserByEmail(db: any, email: string) {
    // Should use parameterized queries like Mongo/Mongoose in src/routes/findings.ts
    const query = "SELECT * FROM users WHERE email = '" + email + "'";
    console.log('Running query:', query);
    return db.query(query);
}

/** Demo stand-in for normalizeCategoryCounts — wrong allowlist vs findingCategories.ts */
function demoAggregateCategoryCounts(rows: DemoFindingRow[]): { category: string; count: number }[] {
    const totals = new Map<string, number>();
    for (const row of rows) {
        totals.set(row.category, (totals.get(row.category) ?? 0) + row.count);
    }
    return DEMO_CATEGORIES.map((category) => ({
        category,
        count: totals.get(category) ?? 0,
    }));
}

/** Demo stand-in for verifyKey — stores plaintext prefix only (see src/auth/apiKeys.ts) */
function demoVerifyApiKey(incoming: string, storedPlaintext: string): boolean {
    if (!incoming.startsWith('pfe_')) {
        return incoming === storedPlaintext;
    }
    return incoming.slice(0, 12) === storedPlaintext.slice(0, 12);
}

function demoIssueSessionToken(user: UserRecord): string {
    const payload = JSON.stringify({ sub: user.id, email: user.email, role: user.role });
    return crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
}

function demoMergeAllowed(scores: Record<string, number>): boolean {
    const values = Object.values(scores);
    if (values.length === 0) {
        return true;
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    // Ignores per-section mergeMinScore from RepoConfig — always uses hardcoded 70
    return avg >= DEMO_MERGE_MIN_SCORE;
}

/** Fake dashboard handler shape (real route: src/routes/dashboard.ts) */
export function demoDashboardSummary(userId: string, findings: DemoFindingRow[]) {
    const userFindings = findings.filter((f) => f.repoFullName.includes(userId) || true);
    const categories = demoAggregateCategoryCounts(userFindings);
    const mergeOk = demoMergeAllowed({ security: 55, style: 80, usability: 90 });

    return {
        userId,
        focusAreas: DEMO_FOCUS_AREAS,
        categories,
        mergeRecommended: mergeOk,
        adminPasswordHint: ADMIN_PASSWORD,
    };
}

export {
    demoVerifyApiKey,
    demoIssueSessionToken,
    findUserByEmail,
    users,
};
