const BASE = (): string => {
    const raw = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    // Be forgiving: a value like "foo.up.railway.app" is almost certainly meant to be HTTPS.
    // Without this, the browser resolves the scheme-less value relative to the current origin
    // and the API call ends up at https://<vercel-host>/<railway-host>/api/... (404/405).
    return `https://${raw}`;
};

export function getApiBaseUrl(): string {
    return BASE();
}

/**
 * True when this build can reach a backend:
 * - In dev (`npm run dev`) Vite proxies /api -> localhost:3001 even with no env var.
 * - In production (Vercel) we require VITE_API_BASE_URL to point at the Railway host.
 */
export function isApiConfiguredForDeploy(): boolean {
    return Boolean(BASE()) || import.meta.env.DEV === true;
}

/** Full URL for `<a href>` navigation. */
export function apiBrowserUrl(pathWithQuery: string): string {
    const base = BASE();
    let path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
    // Never emit protocol-relative URLs (//api/...) — browsers treat them as a different host.
    if (path.startsWith('//')) {
        path = `/${path.replace(/^\/+/, '')}`;
    }
    if (!base) {
        return path;
    }
    return `${base}${path}`;
}
const TOKEN_KEY = 'pfe.token';
const SERVICE_KEY_KEY = 'pfe.serviceKey';

let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: (() => void) | null): void {
    onUnauthorized = handler;
}

export function getStoredToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

export function setStoredToken(token: string | null): void {
    try {
        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
        } else {
            localStorage.removeItem(TOKEN_KEY);
        }
    } catch {
        /* ignore */
    }
}

export function getStoredServiceKey(): string | null {
    try {
        return localStorage.getItem(SERVICE_KEY_KEY);
    } catch {
        return null;
    }
}

export function setStoredServiceKey(key: string | null): void {
    try {
        if (key && key.trim().length > 0) {
            localStorage.setItem(SERVICE_KEY_KEY, key.trim());
        } else {
            localStorage.removeItem(SERVICE_KEY_KEY);
        }
    } catch {
        /* ignore */
    }
}

function shouldOmitDefaultBearer(path: string): boolean {
    return path.startsWith('/api/auth/register') || path.startsWith('/api/auth/login');
}

function usesSessionJwtOnly(path: string): boolean {
    return path.startsWith('/api/keys');
}

function pickBearerToken(path: string): string | null {
    if (shouldOmitDefaultBearer(path)) {
        return null;
    }
    const session = getStoredToken();
    if (usesSessionJwtOnly(path)) {
        return session;
    }
    return getStoredServiceKey() ?? session;
}

export type ApiError = {
    status: number;
    message: string;
};

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const bearer = pickBearerToken(path);
    const headers = new Headers(init.headers);
    if (bearer && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${bearer}`);
    }
    if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', 'application/json');

    let res: Response;
    try {
        res = await fetch(`${BASE()}${path}`, { ...init, headers });
    } catch {
        const hint = BASE()
            ? `Cannot reach the backend at ${BASE()}. Check that the Railway service is running and that FRONTEND_BASE_URL on Railway exactly matches this site's origin (CORS).`
            : 'Cannot reach the API. Set VITE_API_BASE_URL on Vercel to your Railway URL (no /api suffix) and redeploy, or use local dev with npm run dev.';
        throw { status: 0, message: hint } as ApiError;
    }
    if (res.status === 401) {
        if (onUnauthorized) onUnauthorized();
        const message = await safeError(res);
        throw { status: 401, message } as ApiError;
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }
    if (!res.ok) {
        const serverMessage =
            data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
                ? (data as { error: string }).error
                : null;
        // When the build has no backend URL, /api/* hits the static SPA host and returns 404 or 405
        // with no JSON body. Replace the bare "HTTP 405" with something actionable.
        const looksLikeMissingBackend =
            !serverMessage && !BASE() && (res.status === 404 || res.status === 405);
        const message =
            serverMessage ??
            (looksLikeMissingBackend
                ? 'This deployment has no backend configured. Set VITE_API_BASE_URL on Vercel to your Railway URL (no trailing slash, no /api), then redeploy.'
                : `HTTP ${res.status}`);
        throw { status: res.status, message } as ApiError;
    }
    return data as T;
}

async function safeError(res: Response): Promise<string> {
    try {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        return data?.error ?? `HTTP ${res.status}`;
    } catch {
        return `HTTP ${res.status}`;
    }
}
