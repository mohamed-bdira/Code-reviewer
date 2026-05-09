import { apiFetch } from '../auth/apiFetch';

export type RepoConfigView = {
    id: string;
    installationId: string;
    repoFullName: string;
    focusAreas: string[];
    enforcementLevel: 'warning' | 'error';
    useAstGrep: boolean;
    customRules: string;
    mergeMinScore: number;
    createdAt: string;
    updatedAt: string;
};

export type AvailableRepo = {
    fullName: string;
    private: boolean;
};

export function listRepoConfigs(): Promise<{ items: RepoConfigView[] }> {
    return apiFetch<{ items: RepoConfigView[] }>('/api/repo-configs');
}

export function listAvailableRepos(installationId: string): Promise<{ items: AvailableRepo[] }> {
    const q = new URLSearchParams({ installationId });
    return apiFetch<{ items: AvailableRepo[] }>(`/api/repo-configs/available?${q.toString()}`);
}

export function createRepoConfig(input: {
    installationId: string;
    repoFullName: string;
}): Promise<{ config: RepoConfigView }> {
    return apiFetch<{ config: RepoConfigView }>('/api/repo-configs', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export type RepoConfigPatch = Partial<{
    focusAreas: string[];
    enforcementLevel: 'warning' | 'error';
    useAstGrep: boolean;
    customRules: string;
    mergeMinScore: number;
}>;

export function updateRepoConfig(
    id: string,
    patch: RepoConfigPatch,
): Promise<{ config: RepoConfigView }> {
    return apiFetch<{ config: RepoConfigView }>(`/api/repo-configs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });
}

export function deleteRepoConfig(id: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/api/repo-configs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}
