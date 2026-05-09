import type { DashboardSummary } from '../types/dashboard';

export default function SchedulePanel({ summary }: { summary: DashboardSummary | null }) {
    const s = summary?.scheduledBugScan;

    return (
        <div className="space-y-6">
            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Periodic open-PR scan — <code className="text-slate-400">ENABLE_BUG_SCAN</code>
                </h3>
                {!s ? (
                    <p className="text-sm text-slate-500">Load summary.</p>
                ) : (
                    <>
                        <p className={`mb-4 text-lg font-medium ${s.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {s.enabled ? 'Scheduler armed' : 'Scheduler off'}
                        </p>
                        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                            <KV k="BUG_SCAN_INTERVAL_MINUTES" v={String(s.intervalMinutes)} hint="runs setInterval(ms)" />
                            <KV k="BUG_SCAN_MAX_PRS_PER_REPO" v={String(s.maxPrsPerRepo)} hint="caps pulls.list fan-out" />
                            <KV k="BUG_SCAN_POST_COMMENTS" v={s.postComments ? 'true (noisy)' : 'false'} />
                            <KV k="BUG_SCAN_SKIP_UNCHANGED" v={s.skipUnchanged ? 'skip same headSha' : 'always run'} />
                            <KV k="BUG_SCAN_RUN_ON_START" v={s.runOnStart ? 'yes' : 'no'} hint="immediate first tick in process" />
                        </dl>
                        <p className="mt-4 text-xs text-slate-500">
                            When enabled, scans every configured repo&apos;s open PR list (Mongo RepoConfig sources of truth),
                            skips unchanged heads optionally, routes through reviewPullRequest (same prompts as webhook, optional
                            comment flood).
                        </p>
                    </>
                )}
            </section>
        </div>
    );
}

function KV({ k, v, hint }: { k: string; v: string; hint?: string }) {
    return (
        <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
            <dt className="font-mono text-[11px] text-violet-300">{k}</dt>
            <dd className="mt-2 text-white">{v}</dd>
            {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
        </div>
    );
}
