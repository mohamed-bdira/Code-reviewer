import type { CategoryCountsResponse, FindingsListResponse } from '../types/findings';
import { apiFetch } from '../auth/apiFetch';

export const DISPLAY_FINDING_CATEGORIES = [
    'security',
    'style',
    'usability',
    'performance',
    'logic',
] as const;

export type DisplayFindingCategory = (typeof DISPLAY_FINDING_CATEGORIES)[number];

export type FindingFilters = {
    repoFullName?: string;
    prNumber?: string;
    category?: string;
    categories?: readonly string[];
    fileContains?: string;
    q?: string;
    since?: string;
    skip?: number;
    limit?: number;
};

/** Attach the dashboard category allowlist unless callers override it explicitly. */
export function withDisplayCategories(filters: FindingFilters): FindingFilters {
    if (filters.categories !== undefined) {
        return filters;
    }
    return { ...filters, categories: DISPLAY_FINDING_CATEGORIES };
}

function buildQuery(f: FindingFilters): string {
    const p = new URLSearchParams();
    if (f.repoFullName?.trim()) p.set('repoFullName', f.repoFullName.trim());
    if (f.prNumber?.trim()) p.set('prNumber', f.prNumber.trim());
    if (f.category?.trim()) p.set('category', f.category.trim());
    if (f.categories && f.categories.length > 0) {
        p.set('categories', f.categories.join(','));
    }
    if (f.fileContains?.trim()) p.set('fileContains', f.fileContains.trim());
    if (f.q?.trim()) p.set('q', f.q.trim());
    if (f.since?.trim()) p.set('since', f.since.trim());
    if (f.skip != null) p.set('skip', String(f.skip));
    if (f.limit != null) p.set('limit', String(f.limit));
    const s = p.toString();
    return s ? `?${s}` : '';
}

export function fetchFindings(filters: FindingFilters): Promise<FindingsListResponse> {
    return apiFetch<FindingsListResponse>(`/api/findings${buildQuery(withDisplayCategories(filters))}`);
}

export function fetchCategoryCounts(filters: FindingFilters): Promise<CategoryCountsResponse> {
    const { skip: _s, limit: _l, ...rest } = filters;
    return apiFetch<CategoryCountsResponse>(`/api/findings/by-category${buildQuery(withDisplayCategories(rest))}`);
}
