import { useCallback, useEffect, useState } from 'react';
import { DISPLAY_FINDING_CATEGORIES, fetchCategoryCounts, fetchFindings, type FindingFilters } from '../api/findings';
import type { CategoryCountsResponse, FindingsListResponse, PrReviewFinding } from '../types/findings';
import { formatIso } from './formatters';
import type { ServerEvent } from './useEventStream';

const DEFAULT_LIMIT = 25;

const INPUT_CLASS =
    'mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none';

export type AppliedFilterFields = {
    repoFullName: string;
    prNumber: string;
    category: string;
    fileContains: string;
    q: string;
    since: string;
};

export const emptyFindingsFilters = (): AppliedFilterFields => ({
    repoFullName: '',
    prNumber: '',
    category: '',
    fileContains: '',
    q: '',
    since: '',
});

function filtersFromApplied(applied: AppliedFilterFields, skip: number): FindingFilters {
    return {
        repoFullName: applied.repoFullName.trim() || undefined,
        prNumber: applied.prNumber.trim() || undefined,
        category: applied.category.trim() || undefined,
        fileContains: applied.fileContains.trim() || undefined,
        q: applied.q.trim() || undefined,
        since: applied.since.trim() || undefined,
        skip,
        limit: DEFAULT_LIMIT,
    };
}

function formatLines(f: PrReviewFinding): string {
    if (f.lineStart !== undefined || f.lineEnd !== undefined) {
        return `${f.lineStart ?? '—'} → ${f.lineEnd ?? '—'}`;
    }
    return '—';
}

export default function FindingsPanel({ lastEvent }: { lastEvent?: ServerEvent | null } = {}) {
    const [form, setForm] = useState<AppliedFilterFields>(emptyFindingsFilters());
    const [applied, setApplied] = useState<AppliedFilterFields>(emptyFindingsFilters());
    const [skip, setSkip] = useState(0);
    const [refreshTick, setRefreshTick] = useState(0);

    const [list, setList] = useState<FindingsListResponse | null>(null);
    const [counts, setCounts] = useState<CategoryCountsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const filters = useCallback(
        (): FindingFilters => filtersFromApplied(applied, skip),
        [applied, skip],
    );

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const f = filters();
                const [listRes, catRes] = await Promise.all([fetchFindings(f), fetchCategoryCounts(f)]);
                if (!cancelled) {
                    setList(listRes);
                    setCounts(catRes);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(extractMessage(e));
                    setList(null);
                    setCounts(null);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [filters, refreshTick]);

    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === 'finding-created' || lastEvent.type === 'finding-updated') {
            setRefreshTick((t) => t + 1);
        }
    }, [lastEvent]);

    const total = list?.total ?? 0;
    const limit = list?.limit ?? DEFAULT_LIMIT;
    const canPrev = skip > 0;
    const canNext = skip + limit < total;

    const applyFilters = (e: React.FormEvent) => {
        e.preventDefault();
        setApplied({ ...form });
        setSkip(0);
    };

    const orderedCategories = counts
        ? Object.entries(counts.counts).sort((a, b) => b[1] - a[1])
        : [];

    function extractMessage(err: unknown): string {
        if (typeof err === 'object' && err !== null && 'message' in err) {
            const m = (err as { message?: unknown }).message;
            if (typeof m === 'string') return m;
        }
        if (err instanceof Error) return err.message;
        return 'Request failed';
    }

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-muted">
                    Issues found by AI review across your connected repositories. Filter by repository, pull request,
                    category, file, or date.
                </p>
            </div>

            <form
                onSubmit={applyFilters}
                className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3"
            >
                <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                    Repository
                    <input
                        type="text"
                        value={form.repoFullName}
                        onChange={(e) => setForm((s) => ({ ...s, repoFullName: e.target.value }))}
                        placeholder="owner/repo"
                        className={INPUT_CLASS}
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                    PR #
                    <input
                        type="text"
                        inputMode="numeric"
                        value={form.prNumber}
                        onChange={(e) => setForm((s) => ({ ...s, prNumber: e.target.value }))}
                        className={INPUT_CLASS}
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                    Category
                    <select
                        value={form.category}
                        onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
                        className={INPUT_CLASS}
                    >
                        <option value="">All categories</option>
                        {DISPLAY_FINDING_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                                {cat}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                    File contains
                    <input
                        type="text"
                        value={form.fileContains}
                        onChange={(e) => setForm((s) => ({ ...s, fileContains: e.target.value }))}
                        className={INPUT_CLASS}
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                    Description contains
                    <input
                        type="text"
                        value={form.q}
                        onChange={(e) => setForm((s) => ({ ...s, q: e.target.value }))}
                        className={INPUT_CLASS}
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                    Since (ISO date)
                    <input
                        type="text"
                        value={form.since}
                        onChange={(e) => setForm((s) => ({ ...s, since: e.target.value }))}
                        placeholder="2026-01-01T00:00:00Z"
                        className={INPUT_CLASS}
                    />
                </label>
                <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
                    <button
                        type="submit"
                        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
                    >
                        Apply
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const cleared = emptyFindingsFilters();
                            setForm(cleared);
                            setApplied(cleared);
                            setSkip(0);
                        }}
                        className="rounded-md border border-line px-4 py-2 text-sm text-fg transition-colors hover:bg-elevated"
                    >
                        Clear
                    </button>
                </div>
            </form>

            {error && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-200">
                    <strong className="font-medium">Could not load findings.</strong> Please make sure you have unlocked
                    the dashboard with a valid API key, then try again.
                </div>
            )}

            <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Counts by category</h3>
                {error ? (
                    <p className="text-sm text-muted">Counts unavailable until the request above succeeds.</p>
                ) : loading && !counts ? (
                    <p className="text-sm text-muted">Loading…</p>
                ) : orderedCategories.length === 0 ? (
                    <p className="text-sm text-muted">No results for these filters yet.</p>
                ) : (
                    <ul className="flex flex-wrap gap-2">
                        {orderedCategories.map(([cat, n]) => (
                            <li
                                key={cat}
                                className="rounded-full border border-line bg-elevated px-3 py-1 text-sm"
                            >
                                <span className="text-fg">{cat}</span>
                                <span className="ml-2 font-mono text-accent">{n}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Findings</h3>
                    {!loading && list && (
                        <span className="text-xs text-muted">
                            {list.items.length} of {list.total}
                        </span>
                    )}
                </div>

                <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
                                <th className="px-3 py-2 font-medium">Category</th>
                                <th className="px-3 py-2 font-medium">Repo / PR</th>
                                <th className="px-3 py-2 font-medium">File</th>
                                <th className="px-3 py-2 font-medium">Lines</th>
                                <th className="px-3 py-2 font-medium">Description</th>
                                <th className="px-3 py-2 font-medium">First</th>
                                <th className="px-3 py-2 font-medium">Last</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td colSpan={7} className="px-3 py-8 text-center text-muted">
                                        Loading…
                                    </td>
                                </tr>
                            )}
                            {!loading && list && list.items.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-3 py-8">
                                        <p className="text-center text-muted">No findings match this query.</p>
                                        <ul className="mx-auto mt-3 max-w-lg list-inside list-disc space-y-1 text-left text-xs text-faint">
                                            <li>Try clearing the filters above to widen the search.</li>
                                            <li>
                                                Findings appear after a connected repository's pull requests are
                                                reviewed.
                                            </li>
                                        </ul>
                                    </td>
                                </tr>
                            )}
                            {!loading &&
                                list?.items.map((row) => (
                                    <tr key={row._id} className="border-b border-line hover:bg-elevated">
                                        <td className="px-3 py-2 align-top capitalize text-accent">{row.category}</td>
                                        <td className="px-3 py-2 align-top">
                                            <div className="font-mono text-xs text-fg">{row.repoFullName}</div>
                                            <div className="text-muted">#{row.prNumber}</div>
                                        </td>
                                        <td className="max-w-[200px] break-all px-3 py-2 align-top font-mono text-xs text-accent">
                                            {row.filePath}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs text-muted">
                                            {formatLines(row)}
                                        </td>
                                        <td className="max-w-md px-3 py-2 align-top text-fg">{row.description}</td>
                                        <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-faint">
                                            {formatIso(row.firstSeenAt)}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-faint">
                                            {formatIso(row.lastSeenAt)}
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>

                {list && total > limit && (
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            type="button"
                            disabled={!canPrev}
                            onClick={() => setSkip(Math.max(0, skip - limit))}
                            className="rounded-md border border-line px-3 py-1.5 text-sm text-fg transition-colors hover:bg-elevated disabled:opacity-40"
                        >
                            Previous
                        </button>
                        <button
                            type="button"
                            disabled={!canNext}
                            onClick={() => setSkip(skip + limit)}
                            className="rounded-md border border-line px-3 py-1.5 text-sm text-fg transition-colors hover:bg-elevated disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}
