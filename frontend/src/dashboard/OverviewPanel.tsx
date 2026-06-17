import type { DashboardSummary } from '../types/dashboard';
import { formatIso } from './formatters';

export default function OverviewPanel({
    summary,
    onRefresh,
    loading,
}: {
    summary: DashboardSummary | null;
    loading: boolean;
    onRefresh: () => void;
}) {
    const online = summary?.service.online ?? false;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">
                    A live snapshot of your AI code reviews — connected repositories, stored issues, and the most common
                    categories.
                </p>
                <button
                    type="button"
                    disabled={loading}
                    onClick={onRefresh}
                    className="rounded-md border border-line px-3 py-1.5 text-sm text-fg transition-colors hover:bg-elevated disabled:opacity-50"
                >
                    {loading ? 'Refreshing…' : 'Refresh'}
                </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard title="Service status">
                    {summary ? (
                        <div className="flex items-center gap-2">
                            <span
                                className={`inline-block h-2.5 w-2.5 rounded-full ${
                                    online ? 'bg-emerald-500' : 'bg-amber-500'
                                }`}
                            />
                            <p className="text-2xl font-semibold text-fg">{online ? 'Operational' : 'Degraded'}</p>
                        </div>
                    ) : (
                        <p className="text-sm text-muted">{loading ? '…' : '—'}</p>
                    )}
                </MetricCard>
                <MetricCard title="Stored findings">
                    {summary?.findings.totalStored != null ? (
                        <p className="text-2xl font-semibold text-fg">{summary.findings.totalStored}</p>
                    ) : (
                        <p className="text-sm text-muted">{loading ? '…' : '—'}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">Bugs found across your reviewed pull requests.</p>
                </MetricCard>
                <MetricCard title="Connected repositories">
                    <p className="text-2xl font-semibold text-fg">{summary?.reposConfigured ?? '—'}</p>
                    <p className="mt-1 text-xs text-muted">Repositories set up for automatic review.</p>
                </MetricCard>
            </div>

            {summary &&
                online &&
                summary.findings.totalStored === 0 &&
                summary.findings.topCategories.length === 0 && (
                <section className="rounded-xl border border-line bg-surface p-5">
                    {summary.reposConfigured === 0 ? (
                        <>
                            <h3 className="text-sm font-semibold text-fg">No repositories connected yet</h3>
                            <p className="mt-2 text-sm text-muted">
                                Connect a repository under <strong className="text-fg">Configurations</strong> to start
                                automatic AI reviews. Findings and category breakdowns will appear here once pull
                                requests are reviewed.
                            </p>
                        </>
                    ) : (
                        <>
                            <h3 className="text-sm font-semibold text-fg">No findings yet</h3>
                            <p className="mt-2 text-sm text-muted">
                                Once a pull request is opened on a connected repository, AI review results will appear
                                here and under <strong className="text-fg">Bug findings</strong>.
                            </p>
                            <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-muted">
                                <li>Open or update a pull request to trigger a review.</li>
                            </ul>
                        </>
                    )}
                </section>
            )}

            {summary && summary.findings.topCategories.length > 0 && (
                <section className="rounded-xl border border-line bg-surface p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Top issue categories</h3>
                    <ul className="mt-3 flex flex-wrap gap-2">
                        {summary.findings.topCategories.map(({ category, count }) => (
                            <li
                                key={category}
                                className="rounded-full border border-line bg-elevated px-3 py-1 text-sm text-fg"
                            >
                                {category}
                                <span className="ml-2 font-mono text-accent">{count}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {summary && (
                <p className="text-xs text-faint">Updated {formatIso(summary.generatedAt)}</p>
            )}
        </div>
    );
}

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-line bg-surface p-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
            {children}
        </div>
    );
}
