import type { DashboardSummary } from '../types/dashboard';

export default function SchedulePanel({ summary }: { summary: DashboardSummary | null }) {
    const s = summary?.scheduledBugScan;

    return (
        <div className="space-y-6">
            <section className="rounded-xl border border-line bg-surface p-5">
                <h3 className="text-sm font-semibold text-fg">Scheduled scan</h3>
                <p className="mt-1 text-sm text-muted">
                    Periodically re-scans the open pull requests on your connected repositories, in addition to live
                    reviews triggered on each update.
                </p>

                {!s ? (
                    <p className="mt-4 text-sm text-muted">Loading…</p>
                ) : (
                    <>
                        <div className="mt-4 flex items-center gap-2">
                            <span
                                className={`inline-block h-2.5 w-2.5 rounded-full ${
                                    s.enabled ? 'bg-emerald-500' : 'bg-faint'
                                }`}
                            />
                            <span className="text-base font-medium text-fg">
                                {s.enabled ? 'Scheduled scan enabled' : 'Scheduled scan off'}
                            </span>
                        </div>

                        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                            <KV k="Scan interval" v={`${s.intervalMinutes} min`} />
                            <KV k="Max PRs per repository" v={String(s.maxPrsPerRepo)} />
                            <KV k="Post review comments" v={s.postComments ? 'Yes' : 'No'} />
                            <KV k="Skip unchanged PRs" v={s.skipUnchanged ? 'Yes' : 'No'} />
                            <KV k="Run on startup" v={s.runOnStart ? 'Yes' : 'No'} />
                        </dl>
                    </>
                )}
            </section>
        </div>
    );
}

function KV({ k, v }: { k: string; v: string }) {
    return (
        <div className="rounded-lg border border-line bg-elevated p-3">
            <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
            <dd className="mt-2 text-fg">{v}</dd>
        </div>
    );
}
