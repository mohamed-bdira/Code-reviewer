import type { CategoryCountsResponse, FindingsListResponse } from '../types/findings';

const BASE = () => import.meta.env.VITE_API_BASE_URL ?? '';

export type FindingFilters = {
    repoFullName?: string;
    prNumber?: string;
    category?: string;
    fileContains?: string;
    q?: string;
    since?: string;
    skip?: number;
    limit?: number;
};

function buildQuery(f: FindingFilters): string {
    const p = new URLSearchParams();
    if (f.repoFullName?.trim()) p.set('repoFullName', f.repoFullName.trim());
    if (f.prNumber?.trim()) p.set('prNumber', f.prNumber.trim());
    if (f.category?.trim()) p.set('category', f.category.trim());
    if (f.fileContains?.trim()) p.set('fileContains', f.fileContains.trim());
    if (f.q?.trim()) p.set('q', f.q.trim());
    if (f.since?.trim()) p.set('since', f.since.trim());
    if (f.skip != null) p.set('skip', String(f.skip));
    if (f.limit != null) p.set('limit', String(f.limit));
    const s = p.toString();
    return s ? `?${s}` : '';
}

async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE()}${path}`);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return data as T;
}

export function fetchFindings(filters: FindingFilters): Promise<FindingsListResponse> {
    return getJson<FindingsListResponse>(`/api/findings${buildQuery(filters)}`);
}

export function fetchCategoryCounts(filters: FindingFilters): Promise<CategoryCountsResponse> {
    const { skip: _s, limit: _l, ...rest } = filters;
    return getJson<CategoryCountsResponse>(`/api/findings/by-category${buildQuery(rest)}`);
}
