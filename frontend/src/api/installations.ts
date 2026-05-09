import { apiFetch } from '../auth/apiFetch';

export type Installation = {
    id: string;
    installationId: string;
    accountLogin: string;
    accountType: 'User' | 'Organization';
    createdAt: string;
};

export function listInstallations(): Promise<{ items: Installation[] }> {
    return apiFetch<{ items: Installation[] }>('/api/installations');
}

export function createInstallation(installationId: string): Promise<{ installation: Installation }> {
    return apiFetch<{ installation: Installation }>('/api/installations', {
        method: 'POST',
        body: JSON.stringify({ installationId }),
    });
}

export function deleteInstallation(id: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/api/installations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}
