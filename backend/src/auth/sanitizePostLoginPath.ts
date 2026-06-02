/** Safe in-app redirect target after OAuth (blocks // and /api/* paths). */
export function sanitizePostLoginPath(raw: string | null | undefined, fallback = '/'): string {
    if (typeof raw !== 'string' || !raw.trim()) {
        return fallback;
    }
    let path = raw.trim();
    try {
        path = decodeURIComponent(path);
    } catch {
        /* ignore */
    }
    if (path.includes('://') || path.startsWith('//')) {
        return fallback;
    }
    if (!path.startsWith('/')) {
        path = `/${path}`;
    }
    if (path === '/api' || path.startsWith('/api/')) {
        return fallback;
    }
    path = path.replace(/\/{2,}/g, '/');
    if (path.length > 1 && path.endsWith('/')) {
        path = path.replace(/\/+$/, '');
    }
    return path || fallback;
}
