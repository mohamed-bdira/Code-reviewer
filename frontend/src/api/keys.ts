import { apiFetch } from '../auth/apiFetch';

export type ApiKeyView = {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt?: string | null;
    createdAt: string;
    revokedAt?: string | null;
};

export type CreatedApiKey = ApiKeyView & { key: string };

export function listKeys(): Promise<{ items: ApiKeyView[] }> {
    return apiFetch<{ items: ApiKeyView[] }>('/api/keys');
}

export function createKey(name: string): Promise<CreatedApiKey> {
    return apiFetch<CreatedApiKey>('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
}

export function revokeKey(id: string): Promise<{ ok: true; key: ApiKeyView }> {
    return apiFetch<{ ok: true; key: ApiKeyView }>(`/api/keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}
