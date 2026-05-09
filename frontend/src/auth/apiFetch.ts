const BASE = (): string => (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function getApiBaseUrl(): string {
    return BASE();
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

    const res = await fetch(`${BASE()}${path}`, { ...init, headers });
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
        const message =
            (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
                ? (data as { error: string }).error
                : null) ?? `HTTP ${res.status}`;
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
