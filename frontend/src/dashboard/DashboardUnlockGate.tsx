import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getApiBaseUrl, getStoredServiceKey, getStoredToken } from '../auth/apiFetch';
import { useAuth } from '../auth/AuthContext';
import type { AuthUser } from '../api/auth';

type Props = {
    children: React.ReactNode;
};

async function readMeUser(authHeader: string, base: string): Promise<AuthUser | null> {
    const res = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: AuthUser };
    return data.user ?? null;
}

export default function DashboardUnlockGate({ children }: Props) {
    const navigate = useNavigate();
    const location = useLocation();
    const { token, serviceKey, setServiceKey } = useAuth();
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const unlocked = Boolean(serviceKey ?? getStoredServiceKey());
    const keysSectionPath = location.pathname === '/keys';
    if (!token) {
        return null;
    }

    if (unlocked || keysSectionPath) {
        return <>{children}</>;
    }

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed.startsWith('pfe_')) {
            setError('Key must start with pfe_');
            return;
        }
        const sessionJwt = getStoredToken();
        if (!sessionJwt) {
            setError('Session missing. Sign in again.');
            return;
        }
        setBusy(true);
        setError(null);
        const base = getApiBaseUrl();
        try {
            const userBySession = await readMeUser(`Bearer ${sessionJwt}`, base);
            const userByKey = await readMeUser(`Bearer ${trimmed}`, base);
            if (!userBySession || !userByKey) {
                setError('Invalid key or session. Check the key is active and try again.');
                return;
            }
            if (userBySession.id !== userByKey.id) {
                setError('This key belongs to a different account.');
                return;
            }
            setServiceKey(trimmed);
            setInput('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-200">
            <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
                <h1 className="text-lg font-semibold text-white">Unlock dashboard</h1>
                <p className="mt-2 text-sm text-slate-400">
                    Findings, summary, and configuration use your <strong className="text-slate-300">API key</strong> (not only
                    your login). Generate one under <em>API keys</em>, then paste the full <code className="text-emerald-300">pfe_…</code>{' '}
                    secret here. Key management still uses your session.
                </p>
                <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-slate-500">
                    <li>
                        <strong className="text-slate-400">Overview</strong> (stored counts) and <strong className="text-slate-400">Bug findings</strong> call the API with this key — they stay empty until you unlock.
                    </li>
                    <li>
                        Only the <strong className="text-slate-400">API keys</strong> page works without it (session only).
                    </li>
                    <li>
                        After unlocking, use DevTools <strong className="text-slate-400">Network</strong>: <code className="text-slate-400">GET /api/findings</code> should return <strong className="text-slate-400">200</strong> with <code className="text-slate-400">items</code> / <code className="text-slate-400">total</code>.
                    </li>
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                    GitHub webhooks cannot read this paste; optionally the server can delay reviews until you have created a
                    key—see <code className="text-slate-400">REQUIRE_API_KEY_FOR_REVIEWS</code> in backend env.
                </p>
                <form onSubmit={onSubmit} className="mt-5 space-y-3">
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        API key
                        <input
                            type="password"
                            autoComplete="off"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="pfe_…"
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                        />
                    </label>
                    {error && <p className="text-sm text-rose-400">{error}</p>}
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="submit"
                            disabled={busy || !input.trim()}
                            className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                        >
                            {busy ? 'Verifying…' : 'Unlock'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/keys')}
                            className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
                        >
                            Go to API keys
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
