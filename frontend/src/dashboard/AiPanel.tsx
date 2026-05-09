import type { DashboardSummary } from '../types/dashboard';

export default function AiPanel({ summary }: { summary: DashboardSummary | null }) {
    const ai = summary?.aiReview;

    return (
        <div className="space-y-8">
            <section className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-200/90">
                    pythonExploit.py — no cookies or tokens
                </h3>
                <p className="text-sm text-amber-100/85">
                    {ai?.noCookieTokenAuthNote ??
                        'Keeps intentional minimal headers only; do not add Cookie or Authorization Bearer to build_headers.'}
                </p>
                <ul className="mt-3 list-inside list-disc text-xs text-amber-200/70">
                    <li>Gemini web StreamGenerate POST with form body only</li>
                    <li>No session cookies copied from browsers</li>
                    <li>No API key / bearer token supplied by this script</li>
                </ul>
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Runtime</h3>
                {ai ? (
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                            <dt className="text-xs uppercase text-slate-500">PYTHON_BIN</dt>
                            <dd className="mt-1 font-mono text-slate-200">{ai.pythonBin}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase text-slate-500">PYTHON_SCRIPT_PATH</dt>
                            <dd className="mt-1 text-slate-200">
                                {ai.pythonScriptPathEnvSet ? 'Custom env path set' : 'Default resolves to repo root script'}
                            </dd>
                        </div>
                        <div className="sm:col-span-2">
                            <dt className="text-xs uppercase text-slate-500">Default script reference</dt>
                            <dd className="mt-1">
                                <code className="text-emerald-300">{ai.defaultRelativeScript}</code>
                            </dd>
                        </div>
                    </dl>
                ) : (
                    <p className="text-sm text-slate-500">—</p>
                )}
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Enforcer pipeline</h3>
                <ol className="list-inside list-decimal space-y-3 text-sm text-slate-300">
                    {(ai?.pipelineSteps ?? []).map((step) => (
                        <li key={step}>{step}</li>
                    ))}
                </ol>
            </section>
        </div>
    );
}
