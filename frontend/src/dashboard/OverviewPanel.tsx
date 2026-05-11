import type { DashboardSummary } from '../types/dashboard';
import { formatIso, mongoReadyLabel } from './formatters';

export default function OverviewPanel({
    summary,
    onRefresh,
    loading,
}: {
    summary: DashboardSummary | null;
    loading: boolean;
    onRefresh: () => void;
}) {
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-400">
                    Snapshot from <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">GET /api/dashboard/summary</code>
                    . Uses the same auth as other dashboard calls (API key when set).
                </p>
                <button
                    type="button"
                    disabled={loading}
                    onClick={onRefresh}
                    className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                    {loading ? 'Refreshing…' : 'Refresh'}
                </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard title="MongoDB">
                    {summary ? (
                        <>
                            <p className="text-2xl font-semibold text-white">
                                {summary.mongodb.connected ? 'Live' : 'Down'}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{mongoReadyLabel(summary.mongodb.readyState)}</p>
                            <p className="mt-2 text-xs text-slate-500">
                                URI in env: {summary.mongodb.uriConfigured ? 'yes' : 'no'}
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-slate-500">{loading ? '…' : '—'}</p>
                    )}
                </MetricCard>
                <MetricCard title="Stored findings">
                    {summary?.findings.totalStored != null ? (
                        <p className="text-2xl font-semibold text-white">{summary.findings.totalStored}</p>
                    ) : (
                        <p className="text-sm text-slate-500">{summary?.mongodb.connected ? '0 or n/a' : 'Connect Mongo'}</p>
                    )}
                </MetricCard>
                <MetricCard title="Repos in Mongo">
                    <p className="text-2xl font-semibold text-white">{summary?.reposConfigured ?? '—'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                        RepoConfig documents (seen on first webhook or manual seed).
                    </p>
                </MetricCard>
                <MetricCard title="API port">
                    <p className="text-2xl font-semibold text-white">{summary?.serverPort ?? '—'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                        Frontend dev proxies <code className="text-slate-400">/api</code> → this port.
                    </p>
                </MetricCard>
            </div>

            {summary &&
                summary.mongodb.connected &&
                summary.findings.totalStored === 0 &&
                summary.findings.topCategories.length === 0 && (
                <section className="rounded-lg border border-slate-700/80 bg-slate-900/30 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">No stored bugs yet</h3>
                    <p className="mt-2 text-sm text-slate-400">
                        Mongo is connected but <strong className="text-slate-300">PrReviewFinding</strong> has no rows visible for your account.
                    </p>
                    <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-slate-500">
                        <li>Open <strong className="text-slate-400">Bug findings</strong> and confirm <code className="text-slate-400">GET /api/findings</code> returns 200 in the browser Network tab.</li>
                        <li>
                            Data only appears after reviews persist bugs — check GitHub App <strong className="text-slate-400">installation</strong>, webhook delivery, and server logs (skipped reviews,{' '}
                            <code className="text-slate-400">REQUIRE_API_KEY_FOR_REVIEWS</code>, etc.).
                        </li>
                        <li>
                            If you changed login accounts, findings belong to the user linked to the installation; they will not follow a different dashboard user.
                        </li>
                    </ul>
                </section>
            )}

            {summary && summary.findings.topCategories.length > 0 && (
                <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stored top categories</h3>
                    <p className="mb-3 text-xs text-slate-600">Global breakdown (no filter) — for filtered view use Bugs tab.</p>
                    <ul className="flex flex-wrap gap-2">
                        {summary.findings.topCategories.map(({ category, count }) => (
                            <li
                                key={category}
                                className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-sm text-slate-300"
                            >
                                {category}
                                <span className="ml-2 font-mono text-violet-400">{count}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Backend REST endpoints
                </h3>
                <ul className="space-y-2 text-sm">
                    {(summary?.restEndpoints ?? []).map((ep) => (
                        <li key={`${ep.method}${ep.path}`} className="flex flex-wrap gap-2 border-b border-slate-800/80 py-2 last:border-0">
                            <span className="font-mono text-xs text-emerald-400">{ep.method}</span>
                            <code className="text-slate-300">{ep.path}</code>
                            <span className="text-slate-500">— {ep.description}</span>
                        </li>
                    ))}
                </ul>
            </section>

            {summary && (
                <p className="text-xs text-slate-600">Generated {formatIso(summary.generatedAt)}</p>
            )}
        </div>
    );
}

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
            {children}
        </div>
    );
}
