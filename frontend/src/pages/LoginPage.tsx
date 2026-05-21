import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiBrowserUrl, getApiBaseUrl } from '../auth/apiFetch';
import { sanitizePostLoginPath } from '../auth/sanitizePostLoginPath';
import ApiConfigWarning from '../components/ApiConfigWarning';

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const next = sanitizePostLoginPath(params.get('next'));

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await login(email.trim(), password);
            navigate(next, { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Login failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-200">
            <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow">
                <header>
                    <h1 className="text-lg font-semibold text-white">Sign in to PFE Reviewer</h1>
                    <p className="mt-1 text-xs text-slate-500">Use your account to view findings and manage configs.</p>
                </header>

                <ApiConfigWarning />

                <form className="space-y-3" onSubmit={onSubmit}>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Email
                        <input
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                        />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Password
                        <input
                            type="password"
                            autoComplete="current-password"
                            required
                            minLength={8}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                        />
                    </label>

                    {error && (
                        <p className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
                    >
                        {submitting ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>

                <div className="space-y-2 border-t border-slate-800 pt-4">
                    <a
                        href={apiBrowserUrl(`/api/auth/github/start?next=${encodeURIComponent(next)}`)}
                        target="_self"
                        rel="nofollow"
                        className="block w-full rounded border border-slate-600 bg-slate-800 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-700"
                    >
                        Sign in with GitHub
                    </a>
                    <p className="text-center text-[11px] text-slate-500">
                        Opens GitHub to authorize this app (OAuth), then returns you here.
                    </p>
                    {getApiBaseUrl() ? (
                        <p className="break-all text-center text-[10px] text-slate-600">
                            API: {apiBrowserUrl('/api/auth/github/start')}
                        </p>
                    ) : null}
                </div>

                <p className="text-center text-xs text-slate-500">
                    No account?{' '}
                    <Link to={`/register?next=${encodeURIComponent(next)}`} className="text-violet-400 hover:underline">
                        Create one
                    </Link>
                </p>
            </div>
        </div>
    );
}
