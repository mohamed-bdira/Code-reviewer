import { useCallback, useEffect, useState } from 'react';
import { createKey, listKeys, revokeKey, type ApiKeyView, type CreatedApiKey } from '../api/keys';
import { useAuth } from '../auth/AuthContext';
import { formatIso } from './formatters';

export default function KeysPanel() {
    const { setServiceKey } = useAuth();
    const [keys, setKeys] = useState<ApiKeyView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await listKeys();
            setKeys(res.items);
        } catch (err) {
            setError(extractMessage(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const onCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setCreateError('Name is required');
            return;
        }
        setBusy(true);
        setCreateError(null);
        try {
            const created = await createKey(name.trim());
            setJustCreated(created);
            setName('');
            void reload();
        } catch (err) {
            setCreateError(extractMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const onRevoke = async (id: string) => {
        if (!window.confirm('Revoke this key? Anyone using it will lose access immediately.')) {
            return;
        }
        try {
            await revokeKey(id);
            void reload();
        } catch (err) {
            window.alert(extractMessage(err));
        }
    };

    return (
        <div className="space-y-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-fg">API keys</h3>
                    <p className="mt-1 text-xs text-muted">
                        Generate a key to unlock the dashboard and to authenticate API calls from scripts or CI using{' '}
                        <code className="rounded bg-elevated px-1.5 py-0.5 text-fg">Authorization: Bearer &lt;key&gt;</code>.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setCreating(true);
                        setJustCreated(null);
                        setCreateError(null);
                    }}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
                >
                    Generate key
                </button>
            </header>

            {error && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                    {error}
                </div>
            )}

            {creating && (
                <div className="rounded-xl border border-line bg-surface p-4">
                    {justCreated ? (
                        <div className="space-y-3">
                            <p className="text-sm text-emerald-600 dark:text-emerald-300">
                                Key generated. Copy it now — you will not see it again.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                <code className="block flex-1 rounded-md bg-elevated px-3 py-2 font-mono text-xs text-fg">
                                    {justCreated.key}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => navigator.clipboard?.writeText(justCreated.key)}
                                    className="rounded-md border border-line px-3 py-1.5 text-xs text-fg transition-colors hover:bg-elevated"
                                >
                                    Copy
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setServiceKey(justCreated.key);
                                        setCreating(false);
                                        setJustCreated(null);
                                    }}
                                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
                                >
                                    Use this key to unlock dashboard
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreating(false);
                                    setJustCreated(null);
                                }}
                                className="rounded-md border border-line px-3 py-1.5 text-xs text-fg transition-colors hover:bg-elevated"
                            >
                                I saved it — close
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
                            <label className="block flex-1 text-xs font-medium uppercase tracking-wide text-muted">
                                Key name
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="my-laptop, github-actions, …"
                                    className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
                                />
                            </label>
                            <button
                                type="submit"
                                disabled={busy}
                                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-50"
                            >
                                {busy ? 'Generating…' : 'Generate'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setCreating(false)}
                                className="rounded-md border border-line px-3 py-1.5 text-sm text-fg transition-colors hover:bg-elevated"
                            >
                                Cancel
                            </button>
                            {createError && <p className="w-full text-xs text-rose-500 dark:text-rose-300">{createError}</p>}
                        </form>
                    )}
                </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Prefix</th>
                            <th className="px-3 py-2">Last used</th>
                            <th className="px-3 py-2">Created</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && keys.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                                    No keys yet. Generate one above to use the API outside the dashboard.
                                </td>
                            </tr>
                        )}
                        {!loading &&
                            keys.map((k) => {
                                const revoked = Boolean(k.revokedAt);
                                return (
                                    <tr key={k.id} className="border-b border-line hover:bg-elevated">
                                        <td className="px-3 py-2 text-fg">{k.name}</td>
                                        <td className="px-3 py-2 font-mono text-xs text-accent">{k.prefix}…</td>
                                        <td className="px-3 py-2 text-xs text-faint">
                                            {k.lastUsedAt ? formatIso(k.lastUsedAt) : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-faint">{formatIso(k.createdAt)}</td>
                                        <td className="px-3 py-2 text-xs">
                                            {revoked ? (
                                                <span className="text-rose-500 dark:text-rose-400">revoked</span>
                                            ) : (
                                                <span className="text-emerald-600 dark:text-emerald-400">active</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {!revoked && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRevoke(k.id)}
                                                    className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950"
                                                >
                                                    Revoke
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                    </tbody>
                </table>
            </div>

            <details className="rounded-xl border border-line bg-surface p-4 text-xs text-muted">
                <summary className="cursor-pointer text-fg">How to use a key</summary>
                <p className="mb-2 mt-2 text-muted">
                    The same key unlocks the dashboard in the browser and authenticates API calls from scripts or CI.
                </p>
                <pre className="mt-1 overflow-x-auto rounded-md bg-elevated p-3 text-fg">
                    {`curl -H "Authorization: Bearer <your-api-key>" \\
  ${window.location.origin}/api/findings?limit=10`}
                </pre>
            </details>
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
