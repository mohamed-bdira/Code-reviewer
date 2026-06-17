export const DISPLAY_FINDING_CATEGORIES = [
    'security',
    'style',
    'usability',
    'performance',
    'logic',
] as const;

export type DisplayFindingCategory = (typeof DISPLAY_FINDING_CATEGORIES)[number];

const ALLOWED_SET = new Set<string>(DISPLAY_FINDING_CATEGORIES);

/** Parse comma-separated categories query param; only returns values in the allowlist. */
export function parseCategoriesQueryParam(raw: unknown): string[] | undefined {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return undefined;
    }
    const parsed = raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && ALLOWED_SET.has(s));
    if (parsed.length === 0) {
        return undefined;
    }
    return [...new Set(parsed)];
}

/** Fill in zero counts so every display category appears in dashboard/API responses. */
export function normalizeCategoryCounts(
    rows: ReadonlyArray<{ category: string; count: number } | { _id: string; count: number }>,
): { category: string; count: number }[] {
    const countByCategory = new Map<string, number>();
    for (const row of rows) {
        const key = '_id' in row ? String(row._id) : row.category;
        countByCategory.set(key, row.count);
    }
    return DISPLAY_FINDING_CATEGORIES.map((category) => ({
        category,
        count: countByCategory.get(category) ?? 0,
    }));
}
