import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createInstallation,
    deleteInstallation,
    listInstallations,
    type Installation,
} from '../api/installations';
import {
    createRepoConfig,
    deleteRepoConfig,
    listAvailableRepos,
    listRepoConfigs,
    updateRepoConfig,
    type AvailableRepo,
    type RepoConfigPatch,
    type RepoConfigView,
} from '../api/repoConfigs';
import { formatIso } from './formatters';

const FOCUS_OPTIONS = ['security', 'style', 'performance', 'tests', 'docs', 'a11y'] as const;
const ENFORCEMENT_OPTIONS: ('warning' | 'error')[] = ['warning', 'error'];

export default function ConfigurationsPanel() {
    const [installations, setInstallations] = useState<Installation[]>([]);
    const [configs, setConfigs] = useState<RepoConfigView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [iRes, cRes] = await Promise.all([listInstallations(), listRepoConfigs()]);
            setInstallations(iRes.items);
            setConfigs(cRes.items);
        } catch (err) {
            setError(extractMessage(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return (
        <div className="space-y-8">
            {error && (
                <div className="rounded border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
                    {error}
                </div>
            )}

            <InstallationsSection
                installations={installations}
                loading={loading}
                onChanged={reload}
            />

            <RepoConfigsSection
                configs={configs}
                installations={installations}
                loading={loading}
                onChanged={reload}
            />
        </div>
    );
}

function InstallationsSection({
    installations,
    loading,
    onChanged,
}: {
    installations: Installation[];
    loading: boolean;
    onChanged: () => void;
}) {
    const [manual, setManual] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const onAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!/^\d+$/.test(manual.trim())) {
            setErr('installationId must be numeric');
            return;
        }
        setErr(null);
        setBusy(true);
        try {
            await createInstallation(manual.trim());
            setManual('');
            onChanged();
        } catch (error) {
            setErr(extractMessage(error));
        } finally {
            setBusy(false);
        }
    };

    const onUnlink = async (id: string) => {
        if (!window.confirm('Unlink this installation? Configs that reference it will stop receiving reviews.')) {
            return;
        }
        try {
            await deleteInstallation(id);
            onChanged();
        } catch (error) {
            window.alert(extractMessage(error));
        }
    };

    return (
        <section className="space-y-4">
            <header>
                <h3 className="text-sm font-semibold text-white">GitHub App installations</h3>
                <p className="mt-1 text-xs text-slate-500">
                    Each linked installation gives this account access to a GitHub user/org's repositories.
                </p>
            </header>

            <div className="flex flex-wrap items-center gap-3">
                <a
                    href="/api/github/install"
                    className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
                >
                    Install on GitHub
                </a>
                <span className="text-xs text-slate-500">or paste an installation ID below</span>
            </div>

            <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Manual installationId
                    <input
                        type="text"
                        inputMode="numeric"
                        value={manual}
                        onChange={(e) => setManual(e.target.value)}
                        placeholder="e.g. 12345678"
                        className="mt-1 w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                    />
                </label>
                <button
                    type="submit"
                    disabled={busy}
                    className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
                >
                    {busy ? 'Linking…' : 'Link'}
                </button>
            </form>
            {err && <p className="text-xs text-rose-300">{err}</p>}

            {loading && installations.length === 0 ? (
                <p className="text-sm text-slate-500">Loading…</p>
            ) : installations.length === 0 ? (
                <p className="text-sm text-slate-500">No installations linked yet.</p>
            ) : (
                <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
                    {installations.map((inst) => (
                        <li key={inst.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                            <span className="font-mono text-emerald-300">{inst.accountLogin}</span>
                            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{inst.accountType}</span>
                            <span className="font-mono text-xs text-slate-500">id {inst.installationId}</span>
                            <span className="text-xs text-slate-600">linked {formatIso(inst.createdAt)}</span>
                            <button
                                type="button"
                                onClick={() => onUnlink(inst.id)}
                                className="ml-auto rounded border border-rose-900 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                            >
                                Unlink
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function RepoConfigsSection({
    configs,
    installations,
    loading,
    onChanged,
}: {
    configs: RepoConfigView[];
    installations: Installation[];
    loading: boolean;
    onChanged: () => void;
}) {
    const [adding, setAdding] = useState(false);

    return (
        <section className="space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-white">Per-repo review configuration</h3>
                    <p className="mt-1 text-xs text-slate-500">
                        Each row controls how the AI reviews a single repo. Changes are picked up immediately by the next
                        webhook or scheduled scan.
                    </p>
                </div>
                <button
                    type="button"
                    disabled={installations.length === 0}
                    onClick={() => setAdding(true)}
                    className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Add repository
                </button>
            </header>

            {adding && (
                <AddRepoModal
                    installations={installations}
                    existing={new Set(configs.map((c) => c.repoFullName))}
                    onClose={() => setAdding(false)}
                    onCreated={() => {
                        setAdding(false);
                        onChanged();
                    }}
                />
            )}

            {loading && configs.length === 0 ? (
                <p className="text-sm text-slate-500">Loading…</p>
            ) : configs.length === 0 ? (
                <p className="text-sm text-slate-500">
                    No repo configurations yet. Link an installation, then click "Add repository".
                </p>
            ) : (
                <div className="space-y-4">
                    {configs.map((cfg) => (
                        <RepoConfigCard key={cfg.id} config={cfg} onChanged={onChanged} />
                    ))}
                </div>
            )}
        </section>
    );
}

function RepoConfigCard({ config, onChanged }: { config: RepoConfigView; onChanged: () => void }) {
    const [draft, setDraft] = useState<RepoConfigView>(config);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        setDraft(config);
    }, [config]);

    const dirty = useMemo(() => {
        return (
            draft.enforcementLevel !== config.enforcementLevel ||
            draft.useAstGrep !== config.useAstGrep ||
            draft.customRules !== config.customRules ||
            draft.mergeMinScore !== config.mergeMinScore ||
            draft.focusAreas.length !== config.focusAreas.length ||
            draft.focusAreas.some((v, i) => v !== config.focusAreas[i])
        );
    }, [draft, config]);

    const onToggleFocus = (area: string) => {
        setDraft((d) => ({
            ...d,
            focusAreas: d.focusAreas.includes(area)
                ? d.focusAreas.filter((x) => x !== area)
                : [...d.focusAreas, area],
        }));
    };

    const onSave = async () => {
        setSaving(true);
        setErr(null);
        try {
            const patch: RepoConfigPatch = {
                focusAreas: draft.focusAreas,
                enforcementLevel: draft.enforcementLevel,
                useAstGrep: draft.useAstGrep,
                customRules: draft.customRules,
                mergeMinScore: draft.mergeMinScore,
            };
            await updateRepoConfig(config.id, patch);
            setSavedAt(new Date().toISOString());
            onChanged();
        } catch (error) {
            setErr(extractMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const onDelete = async () => {
        if (!window.confirm(`Delete config for ${config.repoFullName}? Existing findings stay.`)) {
            return;
        }
        try {
            await deleteRepoConfig(config.id);
            onChanged();
        } catch (error) {
            window.alert(extractMessage(error));
        }
    };

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h4 className="font-mono text-sm text-emerald-300">{config.repoFullName}</h4>
                    <p className="text-xs text-slate-500">
                        installation {config.installationId} · last updated {formatIso(config.updatedAt)}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onDelete}
                    className="rounded border border-rose-900 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                >
                    Delete config
                </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Focus areas</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {FOCUS_OPTIONS.map((area) => {
                            const on = draft.focusAreas.includes(area);
                            return (
                                <button
                                    type="button"
                                    key={area}
                                    onClick={() => onToggleFocus(area)}
                                    className={`rounded-full border px-3 py-1 text-xs ${
                                        on
                                            ? 'border-violet-500 bg-violet-600/30 text-white'
                                            : 'border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-800'
                                    }`}
                                >
                                    {area}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Enforcement</label>
                    <div className="mt-2 flex gap-2">
                        {ENFORCEMENT_OPTIONS.map((level) => (
                            <button
                                type="button"
                                key={level}
                                onClick={() => setDraft((d) => ({ ...d, enforcementLevel: level }))}
                                className={`rounded border px-3 py-1.5 text-xs capitalize ${
                                    draft.enforcementLevel === level
                                        ? 'border-violet-500 bg-violet-600/30 text-white'
                                        : 'border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-800'
                                }`}
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                        <input
                            type="checkbox"
                            checked={draft.useAstGrep}
                            onChange={(e) => setDraft((d) => ({ ...d, useAstGrep: e.target.checked }))}
                        />
                        Hint the model to use ast-grep style patterns
                    </label>
                </div>

                <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Merge minimum score: {draft.mergeMinScore}
                    </label>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={draft.mergeMinScore}
                        onChange={(e) => setDraft((d) => ({ ...d, mergeMinScore: Number(e.target.value) }))}
                        className="mt-2 w-full"
                    />
                </div>

                <div className="lg:col-span-2">
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Custom rules / focus prompt
                    </label>
                    <textarea
                        value={draft.customRules}
                        onChange={(e) => setDraft((d) => ({ ...d, customRules: e.target.value }))}
                        rows={4}
                        maxLength={4000}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                    />
                    <p className="mt-1 text-right text-[10px] text-slate-600">
                        {draft.customRules.length}/4000
                    </p>
                </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
                <button
                    type="button"
                    onClick={onSave}
                    disabled={!dirty || saving}
                    className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                    {saving ? 'Saving…' : 'Save changes'}
                </button>
                {savedAt && !dirty && (
                    <span className="text-xs text-emerald-400">Saved {formatIso(savedAt)}</span>
                )}
                {err && <span className="text-xs text-rose-300">{err}</span>}
            </div>
        </div>
    );
}

function AddRepoModal({
    installations,
    existing,
    onClose,
    onCreated,
}: {
    installations: Installation[];
    existing: Set<string>;
    onClose: () => void;
    onCreated: () => void;
}) {
    const firstInstall = installations[0];
    const [installationId, setInstallationId] = useState(firstInstall ? firstInstall.installationId : '');
    const [repos, setRepos] = useState<AvailableRepo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState<string | null>(null);

    useEffect(() => {
        if (!installationId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        listAvailableRepos(installationId)
            .then((res) => {
                if (!cancelled) setRepos(res.items);
            })
            .catch((err) => {
                if (!cancelled) setError(extractMessage(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [installationId]);

    const onCreate = async (repoFullName: string) => {
        setCreating(repoFullName);
        try {
            await createRepoConfig({ installationId, repoFullName });
            onCreated();
        } catch (err) {
            setError(extractMessage(err));
        } finally {
            setCreating(null);
        }
    };

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-lg space-y-4 rounded-lg border border-slate-800 bg-slate-950 p-5">
                <header className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-white">Add repository to AI review</h4>
                    <button onClick={onClose} className="text-xs text-slate-400 hover:text-white">
                        Close
                    </button>
                </header>

                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Installation
                    <select
                        value={installationId}
                        onChange={(e) => setInstallationId(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                    >
                        {installations.map((i) => (
                            <option key={i.id} value={i.installationId}>
                                {i.accountLogin} (id {i.installationId})
                            </option>
                        ))}
                    </select>
                </label>

                {loading && <p className="text-sm text-slate-500">Loading repositories…</p>}
                {error && <p className="text-xs text-rose-300">{error}</p>}

                {!loading && !error && (
                    <ul className="max-h-72 overflow-y-auto rounded border border-slate-800">
                        {repos.length === 0 && (
                            <li className="px-3 py-2 text-sm text-slate-500">No repositories accessible to this installation.</li>
                        )}
                        {repos.map((r) => {
                            const taken = existing.has(r.fullName);
                            return (
                                <li
                                    key={r.fullName}
                                    className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2 text-sm last:border-0"
                                >
                                    <span className="font-mono text-emerald-300">{r.fullName}</span>
                                    <span className="text-xs text-slate-500">
                                        {r.private ? 'private' : 'public'}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={taken || creating === r.fullName}
                                        onClick={() => onCreate(r.fullName)}
                                        className="ml-auto rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40"
                                    >
                                        {taken ? 'Already added' : creating === r.fullName ? 'Adding…' : 'Add'}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

function extractMessage(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'message' in err) {
        const m = (err as { message?: unknown }).message;
        if (typeof m === 'string') return m;
    }
    if (err instanceof Error) return err.message;
    return 'Request failed';
}
