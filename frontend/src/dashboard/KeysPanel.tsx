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
        if (!window.confirm('Revoke this key? Anyone using it will start receiving 401 responses.')) {
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
                    <h3 className="text-sm font-semibold text-white">API keys</h3>
                    <p className="mt-1 text-xs text-slate-500">
                        Generate a key here (session login), then paste it on the <strong className="text-slate-300">unlock</strong>{' '}
                        screen or use <strong className="text-slate-300">Use this key to unlock dashboard</strong> below. Scripts
                        and CI use{' '}
                        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">Authorization: Bearer &lt;key&gt;</code>
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setCreating(true);
                        setJustCreated(null);
                        setCreateError(null);
                    }}
                    className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500"
                >
                    Generate key
                </button>
            </header>

            {error && (
                <div className="rounded border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
                    {error}
                </div>
            )}

            {creating && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                    {justCreated ? (
                        <div className="space-y-3">
                            <p className="text-sm text-emerald-300">
                                Key generated. Copy it now — you will not see it again.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                <code className="block flex-1 rounded bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-200">
                                    {justCreated.key}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => navigator.clipboard?.writeText(justCreated.key)}
                                    className="rounded border border-slate-600 px-3 py-1.5 text-xs hover:bg-slate-800"
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
                                    className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
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
                                className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800"
                            >
                                I saved it — close
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
                            <label className="block flex-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                                Key name
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="my-laptop, github-actions, …"
                                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                                />
                            </label>
                            <button
                                type="submit"
                                disabled={busy}
                                className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                            >
                                {busy ? 'Generating…' : 'Generate'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setCreating(false)}
                                className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
                            >
                                Cancel
                            </button>
                            {createError && <p className="w-full text-xs text-rose-300">{createError}</p>}
                        </form>
                    )}
                </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
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
                                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && keys.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                                    No keys yet. Generate one above to use the API outside the dashboard.
                                </td>
                            </tr>
                        )}
                        {!loading &&
                            keys.map((k) => {
                                const revoked = Boolean(k.revokedAt);
                                return (
                                    <tr key={k.id} className="border-b border-slate-800/80 hover:bg-slate-900/40">
                                        <td className="px-3 py-2 text-slate-200">{k.name}</td>
                                        <td className="px-3 py-2 font-mono text-xs text-emerald-300">{k.prefix}…</td>
                                        <td className="px-3 py-2 text-xs text-slate-500">
                                            {k.lastUsedAt ? formatIso(k.lastUsedAt) : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-slate-500">{formatIso(k.createdAt)}</td>
                                        <td className="px-3 py-2 text-xs">
                                            {revoked ? (
                                                <span className="text-rose-400">revoked</span>
                                            ) : (
                                                <span className="text-emerald-400">active</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {!revoked && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRevoke(k.id)}
                                                    className="rounded border border-rose-900 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
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

            <details className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400">
                <summary className="cursor-pointer text-slate-300">How to use a key</summary>
                <p className="mb-2 mt-2 text-slate-500">
                    The same key unlocks the dashboard (browser) and authenticates API calls. Webhooks do not receive your
                    paste; if <code className="text-slate-400">REQUIRE_API_KEY_FOR_REVIEWS</code> is enabled on the server,
                    reviews wait until you have created at least one key in this list.
                </p>
                <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-3 text-emerald-300">
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
