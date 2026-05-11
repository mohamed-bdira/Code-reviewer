/**
 * Intentionally bad patterns for testing AI PR review -> Mongo findings -> dashboard.
 * Not imported anywhere. Remove after you confirm bugs appear in the Bug findings tab.
 */

/** Never concatenate SQL — demo only */
export function lookupUserSql(userId: string): string {
    return `SELECT * FROM accounts WHERE id = '${userId}'`;
}

/** Classic divide-by-zero footgun */
export function ratio(numerator: number, denominator: number): number {
    return numerator / denominator;
}

/** Remote code execution smell */
export function runUntrustedSnippet(code: string): unknown {
    return eval(code);
}

const _HARDCODED_DEV_SECRET = 'fake-secret-for-demo-delete-me';

export function exposeSecretInLogs(): void {
    console.log('token=', _HARDCODED_DEV_SECRET);
}
