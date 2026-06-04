import { useNavigate } from 'react-router-dom';
import type { DashboardSummary } from '../types/dashboard';
import { formatIso } from './formatters';

export default function GithubPanel({ summary }: { summary: DashboardSummary | null }) {
    const navigate = useNavigate();
    const installations = summary?.installations ?? [];
    const connected = installations.length > 0;
    const reposConfigured = summary?.reposConfigured ?? 0;
    const reviewsActive = connected && reposConfigured > 0 && Boolean(summary?.reviews.postsPrComment);

    return (
        <div className="space-y-8">
            <section className="rounded-xl border border-line bg-surface p-5">
                <h3 className="text-sm font-semibold text-fg">GitHub connection</h3>
                <p className="mt-1 text-sm text-muted">
                    Connect your GitHub account so PFE can review pull requests and post results automatically.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <StatusTile
                        label="GitHub App"
                        ok={connected}
                        okText="Connected"
                        offText="Not connected"
                    />
                    <StatusTile
                        label="Repositories"
                        ok={reposConfigured > 0}
                        okText={`${reposConfigured} configured`}
                        offText="None yet"
                    />
                    <StatusTile
                        label="PR reviews"
                        ok={reviewsActive}
                        okText="Active"
                        offText="Inactive"
                    />
                </div>

                {!connected && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => navigate('/configurations')}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
                        >
                            Connect GitHub
                        </button>
                        <span className="text-xs text-muted">Set up installations and repositories under Configurations.</span>
                    </div>
                )}
            </section>

            <section className="rounded-xl border border-line bg-surface p-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Connected accounts</h3>
                {installations.length === 0 ? (
                    <p className="text-sm text-muted">
                        No GitHub accounts connected yet. Open <strong className="text-fg">Configurations</strong> to get
                        started.
                    </p>
                ) : (
                    <ul className="divide-y divide-line">
                        {installations.map((inst) => (
                            <li
                                key={inst.id}
                                className="flex flex-wrap items-center justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0"
                            >
                                <span className="font-mono text-accent">{inst.accountLogin}</span>
                                <span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-muted">
                                    {inst.accountType}
                                </span>
                                <span className="text-xs text-faint">connected {formatIso(inst.createdAt)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function StatusTile({
    label,
    ok,
    okText,
    offText,
}: {
    label: string;
    ok: boolean;
    okText: string;
    offText: string;
}) {
    return (
        <div className="rounded-lg border border-line bg-elevated p-3">
            <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-1.5 flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-faint'}`} />
                <span className="text-sm font-medium text-fg">{ok ? okText : offText}</span>
            </div>
        </div>
    );
}
