import type { DashboardSummary } from '../types/dashboard';
import { formatIso } from './formatters';

export default function GithubPanel({ summary }: { summary: DashboardSummary | null }) {
    const gh = summary?.githubWebhook;
    const installations = summary?.installations ?? [];

    return (
        <div className="space-y-8">
            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    GitHub App webhook
                </h3>
                <p className="mb-4 text-sm text-slate-400">
                    Each PR webhook is matched to your account via the <code>installation.id</code> on the payload, then
                    routed through your configured repos.
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
                    Linked GitHub installations
                </h3>
                {installations.length === 0 ? (
                    <p className="text-sm text-slate-500">
                        You have no linked GitHub App installations yet. Open the Configurations tab to install.
                    </p>
                ) : (
                    <ul className="space-y-2 text-sm">
                        {installations.map((inst) => (
                            <li
                                key={inst.id}
                                className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 py-2 last:border-0"
                            >
                                <span className="font-mono text-emerald-300">{inst.accountLogin}</span>
                                <span className="text-xs text-slate-500">{inst.accountType}</span>
                                <span className="font-mono text-xs text-slate-500">id {inst.installationId}</span>
                                <span className="text-xs text-slate-600">linked {formatIso(inst.createdAt)}</span>
                            </li>
                        ))}
                    </ul>
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
