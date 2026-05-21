/**
 * Safe in-app path for post-login navigation (blocks // protocol-relative URLs and /api/*).
 */
export function sanitizePostLoginPath(raw: string | null | undefined, fallback = '/'): string {
    if (typeof raw !== 'string' || !raw.trim()) {
        return fallback;
    }
    let path = raw.trim();
    try {
        path = decodeURIComponent(path);
    } catch {
        /* already decoded or invalid */
    }
    if (path.includes('://') || path.startsWith('//')) {
        return fallback;
    }
    if (!path.startsWith('/')) {
        path = `/${path}`;
    }
    // API routes are not SPA pages — never send users back to /api/* after OAuth.
    if (path === '/api' || path.startsWith('/api/')) {
        return fallback;
    }
    // Collapse accidental double slashes in path (not scheme).
    path = path.replace(/\/{2,}/g, '/');
    if (path.length > 1 && path.endsWith('/')) {
        path = path.replace(/\/+$/, '');
    }
    return path || fallback;
}
