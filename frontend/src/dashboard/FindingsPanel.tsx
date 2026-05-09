import { useCallback, useEffect, useState } from 'react';
import { fetchCategoryCounts, fetchFindings, type FindingFilters } from '../api/findings';
import type { CategoryCountsResponse, FindingsListResponse, PrReviewFinding } from '../types/findings';
import { formatIso } from './formatters';

const DEFAULT_LIMIT = 25;

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

export default function FindingsPanel() {
    const [form, setForm] = useState<AppliedFilterFields>(emptyFindingsFilters());
    const [applied, setApplied] = useState<AppliedFilterFields>(emptyFindingsFilters());
    const [skip, setSkip] = useState(0);

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
                    setError(e instanceof Error ? e.message : 'Request failed');
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
    }, [filters]);

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

    return (
        <div className="space-y-8">
            <div>
                <p className="text-sm text-slate-400">
                    Mongo collection <code className="text-slate-300">PrReviewFinding</code> —
                    endpoints <code className="text-slate-300">GET /api/findings</code> and{' '}
                    <code className="text-slate-300">GET /api/findings/by-category</code>. Bugs are deduped with{' '}
                    <code className="text-slate-300">dedupeKey</code>; timestamps show history across webhook and hourly
                    scan runs.
                </p>
            </div>

            <form
                onSubmit={applyFilters}
                className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4 sm:grid-cols-2 lg:grid-cols-3"
            >
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Repo
                    <input
                        type="text"
                        value={form.repoFullName}
                        onChange={(e) => setForm((s) => ({ ...s, repoFullName: e.target.value }))}
                        placeholder="owner/repo"
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white placeholder:text-slate-600"
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    PR #
                    <input
                        type="text"
                        inputMode="numeric"
                        value={form.prNumber}
                        onChange={(e) => setForm((s) => ({ ...s, prNumber: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white placeholder:text-slate-600"
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Category
                    <input
                        type="text"
                        value={form.category}
                        onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white placeholder:text-slate-600"
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    File contains
                    <input
                        type="text"
                        value={form.fileContains}
                        onChange={(e) => setForm((s) => ({ ...s, fileContains: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white placeholder:text-slate-600"
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Description contains
                    <input
                        type="text"
                        value={form.q}
                        onChange={(e) => setForm((s) => ({ ...s, q: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white placeholder:text-slate-600"
                    />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Since (firstSeenAt ISO)
                    <input
                        type="text"
                        value={form.since}
                        onChange={(e) => setForm((s) => ({ ...s, since: e.target.value }))}
                        placeholder="2026-01-01T00:00:00Z"
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white placeholder:text-slate-600"
                    />
                </label>
                <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
                    <button
                        type="submit"
                        className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
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
                        className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                    >
                        Clear
                    </button>
                </div>
            </form>

            <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Counts by category
                </h3>
                {loading && !counts ? (
                    <p className="text-sm text-slate-500">Loading…</p>
                ) : orderedCategories.length === 0 ? (
                    <p className="text-sm text-slate-500">No rows for filters.</p>
                ) : (
                    <ul className="flex flex-wrap gap-2">
                        {orderedCategories.map(([cat, n]) => (
                            <li
                                key={cat}
                                className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-sm"
                            >
                                <span className="text-slate-300">{cat}</span>
                                <span className="ml-2 font-mono text-violet-400">{n}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {error && (
                <div className="rounded border border-amber-900/80 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
                    <strong className="font-medium">Could not load.</strong> {error}
                    <p className="mt-2 text-xs text-amber-200/80">
                        Backend on port 3001 + Mongo required; dev proxies <code className="rounded bg-black/30 px-1">/api</code>
                        .
                    </p>
                </div>
            )}

            <section>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Findings table</h3>
                    {!loading && list && (
                        <span className="text-xs text-slate-500">
                            {list.items.length} / {list.total} (skip {list.skip})
                        </span>
                    )}
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
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
                                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                                        Loading…
                                    </td>
                                </tr>
                            )}
                            {!loading && list && list.items.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                                        No findings.
                                    </td>
                                </tr>
                            )}
                            {!loading &&
                                list?.items.map((row) => (
                                    <tr key={row._id} className="border-b border-slate-800/80 hover:bg-slate-900/40">
                                        <td className="px-3 py-2 align-top capitalize text-violet-300">{row.category}</td>
                                        <td className="px-3 py-2 align-top">
                                            <div className="font-mono text-xs text-slate-300">{row.repoFullName}</div>
                                            <div className="text-slate-500">#{row.prNumber}</div>
                                        </td>
                                        <td className="max-w-[160px] px-3 py-2 align-top font-mono text-xs text-emerald-300/90">
                                            {row.filePath}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs text-slate-400">
                                            {formatLines(row)}
                                        </td>
                                        <td className="max-w-md px-3 py-2 align-top text-slate-300">{row.description}</td>
                                        <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-slate-500">
                                            {formatIso(row.firstSeenAt)}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-slate-500">
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
                            className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
                        >
                            Previous
                        </button>
                        <button
                            type="button"
                            disabled={!canNext}
                            onClick={() => setSkip(skip + limit)}
                            className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}
