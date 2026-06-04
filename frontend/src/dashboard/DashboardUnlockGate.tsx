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
        if (trimmed.length < 8) {
            setError('Paste the full API key from the keys page.');
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
        <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-fg">
            <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-xl">
                <h1 className="text-lg font-semibold text-fg">Unlock dashboard</h1>
                <p className="mt-2 text-sm text-muted">
                    Findings and configuration are protected by your <strong className="text-fg">API key</strong>.
                    Generate one under <em>API keys</em>, then paste it here to unlock the dashboard.
                </p>
                <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-muted">
                    <li>
                        <strong className="text-fg">Overview</strong> and <strong className="text-fg">Bug findings</strong>{' '}
                        stay empty until you unlock.
                    </li>
                    <li>
                        Only the <strong className="text-fg">API keys</strong> page is available before unlocking.
                    </li>
                </ul>
                <form onSubmit={onSubmit} className="mt-5 space-y-3">
                    <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                        API key
                        <input
                            type="password"
                            autoComplete="off"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Paste your API key"
                            className="mt-1 w-full rounded-md border border-line bg-elevated px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
                        />
                    </label>
                    {error && <p className="text-sm text-rose-500 dark:text-rose-400">{error}</p>}
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="submit"
                            disabled={busy || !input.trim()}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-50"
                        >
                            {busy ? 'Verifying…' : 'Unlock'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/keys')}
                            className="rounded-md border border-line px-4 py-2 text-sm text-fg transition-colors hover:bg-elevated"
                        >
                            Go to API keys
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
