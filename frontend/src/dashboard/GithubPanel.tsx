import type { DashboardSummary } from '../types/dashboard';

export default function GithubPanel({ summary }: { summary: DashboardSummary | null }) {
    const gh = summary?.githubWebhook;
    const cred = summary?.githubAppCredentials;
    const extra = summary?.repositoryExtras;

    return (
        <div className="space-y-8">
            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Hosted GitHub App — webhook
                </h3>
                <p className="mb-4 text-sm text-slate-400">
                    Atlas/Mongo webhook service listens for installs that hit your deployed backend. Incoming PR updates run
                    the full enforcer + Python bridge and optionally persist bugs.
                </p>
                {gh ? (
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                        <Kv label="HTTP" value={<code>{gh.method}</code>} />
                        <Kv label="Path" value={<code className="text-emerald-300">{gh.path}</code>} />
                        <Kv label="Event" value={<code>{gh.event}</code>} />
                        <Kv label="Actions" value={gh.actions.join(', ')} />
                        <Kv
                            label="PR comment"
                            value={gh.postsPrComment ? 'Yes — review + scores + bug table posted' : 'No'}
                            span
                        />
                    </div>
                ) : (
                    <p className="text-sm text-slate-500">Load dashboard summary.</p>
                )}
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    GitHub App credentials <span className="font-normal text-slate-600">(presence only)</span>
                </h3>
                {cred ? (
                    <ul className="space-y-2 text-sm">
                        <li className="flex justify-between gap-4 border-b border-slate-800 py-2">
                            <span className="text-slate-500">GITHUB_APP_ID</span>
                            <span className={cred.appIdConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                                {cred.appIdConfigured ? 'configured' : 'missing'}
                            </span>
                        </li>
                        <li className="flex justify-between gap-4 border-b border-slate-800 py-2">
                            <span className="text-slate-500">GITHUB_INSTALLATION_ID</span>
                            <span className={cred.installationIdConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                                {cred.installationIdConfigured ? 'configured' : 'missing'}
                            </span>
                        </li>
                        <li className="flex justify-between gap-4 py-2">
                            <span className="text-slate-500">App private key file</span>
                            <code className="max-w-[14rem] truncate text-right text-xs text-slate-400">{cred.pemPathRelative}</code>
                        </li>
                    </ul>
                ) : (
                    <p className="text-sm text-slate-500">—</p>
                )}
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">GitHub Actions (repo workflow)</h3>
                {extra ? (
                    <>
                        <p className="mb-3 text-sm text-slate-400">{extra.description}</p>
                        <code className="block rounded bg-slate-950 p-3 text-xs text-emerald-300">{extra.githubActionsWorkflow}</code>
                    </>
                ) : (
                    <p className="text-sm text-slate-500">—</p>
                )}
            </section>
        </div>
    );
}

function Kv({
    label,
    value,
    span,
}: {
    label: string;
    value: React.ReactNode;
    span?: boolean;
}) {
    return (
        <div className={span ? 'sm:col-span-2' : undefined}>
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-slate-200">{value}</div>
        </div>
    );
}
