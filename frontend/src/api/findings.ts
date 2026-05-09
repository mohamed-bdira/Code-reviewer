import type { CategoryCountsResponse, FindingsListResponse } from '../types/findings';
import { apiFetch } from '../auth/apiFetch';

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

export function fetchFindings(filters: FindingFilters): Promise<FindingsListResponse> {
    return apiFetch<FindingsListResponse>(`/api/findings${buildQuery(filters)}`);
}

export function fetchCategoryCounts(filters: FindingFilters): Promise<CategoryCountsResponse> {
    const { skip: _s, limit: _l, ...rest } = filters;
    return apiFetch<CategoryCountsResponse>(`/api/findings/by-category${buildQuery(rest)}`);
}
