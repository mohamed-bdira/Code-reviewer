import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createInstallation,
    deleteInstallation,
    getGithubInstallUrl,
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

const FOCUS_OPTIONS = ['security', 'style', 'css', 'performance', 'tests', 'docs'] as const;
const ENFORCEMENT_OPTIONS: ('warning' | 'error')[] = ['warning', 'error'];
/** Must match server [PFE/backend/src/routes/repoConfigs.ts] FOCUS_TAG_PATTERN */
const FOCUS_TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_FOCUS_AREAS = 16;

const INPUT_CLASS =
    'mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none';
const ERROR_BOX_CLASS =
    'rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200';

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
            {error && <div className={ERROR_BOX_CLASS}>{error}</div>}

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
    const [installBusy, setInstallBusy] = useState(false);
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

    const onInstallOnGithub = async () => {
        setErr(null);
        setInstallBusy(true);
        try {
            const { url } = await getGithubInstallUrl();
            if (!url.startsWith('https://')) {
                setErr('Server returned an invalid install URL.');
                return;
            }
            window.location.replace(url);
        } catch (error) {
            setErr(extractMessage(error));
        } finally {
            setInstallBusy(false);
        }
    };

    return (
        <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
            <header>
                <h3 className="text-sm font-semibold text-fg">GitHub App installations</h3>
                <p className="mt-1 text-xs text-muted">
                    Each linked installation gives this account access to a GitHub user or organization's repositories.
                </p>
            </header>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    disabled={installBusy}
                    onClick={() => void onInstallOnGithub()}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
                >
                    {installBusy ? 'Opening GitHub…' : 'Install on GitHub'}
                </button>
                <span className="text-xs text-muted">or paste an installation ID below</span>
            </div>

            <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
                <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                    Manual installation ID
                    <input
                        type="text"
                        inputMode="numeric"
                        value={manual}
                        onChange={(e) => setManual(e.target.value)}
                        placeholder="e.g. 12345678"
                        className={`${INPUT_CLASS} w-56`}
                    />
                </label>
                <button
                    type="submit"
                    disabled={busy}
                    className="rounded-md border border-line px-3 py-1.5 text-sm text-fg transition-colors hover:bg-elevated disabled:opacity-50"
                >
                    {busy ? 'Linking…' : 'Link'}
                </button>
            </form>
            {err && <p className="text-xs text-rose-500 dark:text-rose-300">{err}</p>}

            {loading && installations.length === 0 ? (
                <p className="text-sm text-muted">Loading…</p>
            ) : installations.length === 0 ? (
                <p className="text-sm text-muted">No installations linked yet.</p>
            ) : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-elevated">
                    {installations.map((inst) => (
                        <li key={inst.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                            <span className="font-mono text-accent">{inst.accountLogin}</span>
                            <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{inst.accountType}</span>
                            <span className="font-mono text-xs text-faint">id {inst.installationId}</span>
                            <span className="text-xs text-faint">linked {formatIso(inst.createdAt)}</span>
                            <button
                                type="button"
                                onClick={() => onUnlink(inst.id)}
                                className="ml-auto rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950"
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
                    <h3 className="text-sm font-semibold text-fg">Per-repository review configuration</h3>
                    <p className="mt-1 text-xs text-muted">
                        Each row controls how the AI reviews a single repository. Changes apply to the next review.
                    </p>
                </div>
                <button
                    type="button"
                    disabled={installations.length === 0}
                    onClick={() => setAdding(true)}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
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
                <p className="text-sm text-muted">Loading…</p>
            ) : configs.length === 0 ? (
                <p className="text-sm text-muted">
                    No repository configurations yet. Link an installation, then click "Add repository".
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
    const [customFocusInput, setCustomFocusInput] = useState('');
    const [focusErr, setFocusErr] = useState<string | null>(null);
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
        setDraft((d) => {
            const has = d.focusAreas.includes(area);
            if (has) {
                setFocusErr(null);
                return { ...d, focusAreas: d.focusAreas.filter((x) => x !== area) };
            }
            if (d.focusAreas.length >= MAX_FOCUS_AREAS) {
                setFocusErr(`At most ${MAX_FOCUS_AREAS} dimensions. Remove one first.`);
                return d;
            }
            setFocusErr(null);
            return { ...d, focusAreas: [...d.focusAreas, area] };
        });
    };

    const removeFocus = (tag: string) => {
        setDraft((d) => ({
            ...d,
            focusAreas: d.focusAreas.filter((x) => x !== tag),
        }));
        setFocusErr(null);
    };

    const addCustomFocus = () => {
        const raw = customFocusInput.trim().toLowerCase();
        if (!raw) {
            setFocusErr('Enter a dimension name.');
            return;
        }
        if (!FOCUS_TAG_PATTERN.test(raw)) {
            setFocusErr(
                'Use lowercase letters, numbers, underscores, or hyphens only (e.g. css, tailwind, graphql).',
            );
            return;
        }
        if (draft.focusAreas.includes(raw)) {
            setFocusErr('Already added.');
            return;
        }
        if (draft.focusAreas.length >= MAX_FOCUS_AREAS) {
            setFocusErr(`At most ${MAX_FOCUS_AREAS} dimensions.`);
            return;
        }
        setFocusErr(null);
        setCustomFocusInput('');
        setDraft((d) => ({ ...d, focusAreas: [...d.focusAreas, raw] }));
    };

    const onCustomFocusKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomFocus();
        }
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
        <div className="rounded-xl border border-line bg-surface p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h4 className="font-mono text-sm text-accent">{config.repoFullName}</h4>
                    <p className="text-xs text-muted">
                        installation {config.installationId} · last updated {formatIso(config.updatedAt)}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onDelete}
                    className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950"
                >
                    Delete config
                </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="lg:col-span-2 space-y-4 rounded-lg border border-line bg-elevated p-4">
                    <div>
                        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            Review focus dimensions
                        </h5>
                        <p className="mt-1 text-xs leading-relaxed text-muted">
                            Each tag becomes an extra scoring section and emphasis in the review (merged with{' '}
                            <code className="rounded bg-surface px-1 text-fg">security</code>,{' '}
                            <code className="rounded bg-surface px-1 text-fg">style</code>, and{' '}
                            <code className="rounded bg-surface px-1 text-fg">usability</code>). Use{' '}
                            <strong className="text-fg">Custom rules</strong> below for prose instructions.
                        </p>
                        <p className="mt-1 text-xs text-faint">
                            Up to {MAX_FOCUS_AREAS} dimensions · lowercase tags only
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                            Quick suggestions
                        </label>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {FOCUS_OPTIONS.map((area) => {
                                const on = draft.focusAreas.includes(area);
                                return (
                                    <button
                                        type="button"
                                        key={area}
                                        onClick={() => onToggleFocus(area)}
                                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                            on
                                                ? 'border-accent bg-accent/20 text-fg'
                                                : 'border-line bg-surface text-muted hover:bg-elevated'
                                        }`}
                                    >
                                        {area}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                        <label className="block min-w-[200px] flex-1 text-xs font-medium uppercase tracking-wide text-muted">
                            Add custom dimension
                            <input
                                type="text"
                                value={customFocusInput}
                                onChange={(e) => {
                                    setCustomFocusInput(e.target.value);
                                    setFocusErr(null);
                                }}
                                onKeyDown={onCustomFocusKeyDown}
                                placeholder="e.g. tailwind, graphql, api"
                                className={`${INPUT_CLASS} font-mono`}
                            />
                        </label>
                        <button
                            type="button"
                            onClick={addCustomFocus}
                            className="rounded-md border border-accent bg-accent/15 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/25"
                        >
                            Add
                        </button>
                    </div>
                    {focusErr && <p className="text-xs text-rose-500 dark:text-rose-400">{focusErr}</p>}

                    <div>
                        <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                            Active dimensions ({draft.focusAreas.length}/{MAX_FOCUS_AREAS})
                        </label>
                        {draft.focusAreas.length === 0 ? (
                            <p className="mt-2 text-xs text-faint">
                                None selected — the server falls back to defaults when this list is empty after save.
                            </p>
                        ) : (
                            <ul className="mt-2 flex flex-wrap gap-2">
                                {draft.focusAreas.map((tag) => (
                                    <li
                                        key={tag}
                                        className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-fg"
                                    >
                                        <span className="font-mono">{tag}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeFocus(tag)}
                                            className="rounded px-1 text-muted transition-colors hover:bg-elevated hover:text-fg"
                                            aria-label={`Remove ${tag}`}
                                        >
                                            ×
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-muted">Enforcement</label>
                    <div className="mt-2 flex gap-2">
                        {ENFORCEMENT_OPTIONS.map((level) => (
                            <button
                                type="button"
                                key={level}
                                onClick={() => setDraft((d) => ({ ...d, enforcementLevel: level }))}
                                className={`rounded-md border px-3 py-1.5 text-xs capitalize transition-colors ${
                                    draft.enforcementLevel === level
                                        ? 'border-accent bg-accent/20 text-fg'
                                        : 'border-line bg-elevated text-muted hover:bg-surface'
                                }`}
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="flex items-center gap-2 text-xs text-muted">
                        <input
                            type="checkbox"
                            className="accent-[var(--app-accent)]"
                            checked={draft.useAstGrep}
                            onChange={(e) => setDraft((d) => ({ ...d, useAstGrep: e.target.checked }))}
                        />
                        Run static analysis (ast-grep) and merge matches into findings
                    </label>
                </div>

                <div className="lg:col-span-2">
                    <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                            Merge minimum score
                        </label>
                        <span className="rounded-md bg-accent/15 px-2 py-0.5 text-sm font-semibold text-accent">
                            {draft.mergeMinScore}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={draft.mergeMinScore}
                        onChange={(e) => setDraft((d) => ({ ...d, mergeMinScore: Number(e.target.value) }))}
                        className="range-slider mt-3"
                        style={{
                            ['--range-fill' as string]: `linear-gradient(to right, var(--app-accent) ${draft.mergeMinScore}%, var(--app-elevated) ${draft.mergeMinScore}%)`,
                        }}
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-faint">
                        <span>0</span>
                        <span>100</span>
                    </div>
                </div>

                <div className="lg:col-span-2">
                    <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                        Custom rules / instructions (free-form)
                    </label>
                    <p className="mt-1 text-xs text-faint">
                        Detailed guidance for this repository — for example, review CSS consistency, naming, or
                        framework-specific patterns.
                    </p>
                    <textarea
                        value={draft.customRules}
                        onChange={(e) => setDraft((d) => ({ ...d, customRules: e.target.value }))}
                        rows={4}
                        maxLength={4000}
                        className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                    />
                    <p className="mt-1 text-right text-[10px] text-faint">{draft.customRules.length}/4000</p>
                </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
                <button
                    type="button"
                    onClick={onSave}
                    disabled={!dirty || saving}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-50"
                >
                    {saving ? 'Saving…' : 'Save changes'}
                </button>
                {savedAt && !dirty && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved {formatIso(savedAt)}</span>
                )}
                {err && <span className="text-xs text-rose-500 dark:text-rose-300">{err}</span>}
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
            <div className="w-full max-w-lg space-y-4 rounded-xl border border-line bg-surface p-5 shadow-xl">
                <header className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-fg">Add repository to AI review</h4>
                    <button onClick={onClose} className="text-xs text-muted transition-colors hover:text-fg">
                        Close
                    </button>
                </header>

                <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                    Installation
                    <select
                        value={installationId}
                        onChange={(e) => setInstallationId(e.target.value)}
                        className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                    >
                        {installations.map((i) => (
                            <option key={i.id} value={i.installationId}>
                                {i.accountLogin} (id {i.installationId})
                            </option>
                        ))}
                    </select>
                </label>

                {loading && <p className="text-sm text-muted">Loading repositories…</p>}
                {error && <p className="text-xs text-rose-500 dark:text-rose-300">{error}</p>}

                {!loading && !error && (
                    <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                        {repos.length === 0 && (
                            <li className="px-3 py-2 text-sm text-muted">No repositories accessible to this installation.</li>
                        )}
                        {repos.map((r) => {
                            const taken = existing.has(r.fullName);
                            return (
                                <li
                                    key={r.fullName}
                                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                                >
                                    <span className="font-mono text-accent">{r.fullName}</span>
                                    <span className="text-xs text-muted">{r.private ? 'private' : 'public'}</span>
                                    <button
                                        type="button"
                                        disabled={taken || creating === r.fullName}
                                        onClick={() => onCreate(r.fullName)}
                                        className="ml-auto rounded-md border border-line px-2 py-1 text-xs text-fg transition-colors hover:bg-elevated disabled:opacity-40"
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
