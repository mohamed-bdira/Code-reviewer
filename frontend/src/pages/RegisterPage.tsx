import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiBrowserUrl, isApiConfiguredForDeploy } from '../auth/apiFetch';
import { sanitizePostLoginPath } from '../auth/sanitizePostLoginPath';

export default function RegisterPage() {
    const { register } = useAuth();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const next = sanitizePostLoginPath(params.get('next'));

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }
        setSubmitting(true);
        try {
            await register(email.trim(), password, displayName.trim() || undefined);
            navigate('/configurations?welcome=1', { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Registration failed');
        } finally {
            setSubmitting(false);
        }
    };

    const onGithub = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        if (!isApiConfiguredForDeploy()) {
            setError(
                'GitHub sign-in is disabled on this deployment because VITE_API_BASE_URL is not set on Vercel for this environment. Add it (Production + Preview) and redeploy.',
            );
            return;
        }
        window.location.assign(apiBrowserUrl(`/api/auth/github/start?next=${encodeURIComponent(next)}`));
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-fg">
            <div className="w-full max-w-sm space-y-6 rounded-xl border border-line bg-surface p-6 shadow-lg">
                <header>
                    <h1 className="text-lg font-semibold text-fg">Create your account</h1>
                    <p className="mt-1 text-xs text-muted">
                        After signup, install the GitHub App to start receiving AI reviews.
                    </p>
                </header>

                <form className="space-y-3" onSubmit={onSubmit}>
                    <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                        Display name (optional)
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                        Email
                        <input
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-wide text-muted">
                        Password (min 8)
                        <input
                            type="password"
                            autoComplete="new-password"
                            required
                            minLength={8}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                    </label>

                    {error && (
                        <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
                    >
                        {submitting ? 'Creating account…' : 'Create account'}
                    </button>
                </form>

                <div className="space-y-2 border-t border-line pt-4">
                    <a
                        href={apiBrowserUrl(`/api/auth/github/start?next=${encodeURIComponent(next)}`)}
                        onClick={onGithub}
                        target="_self"
                        rel="nofollow"
                        className="block w-full rounded-md border border-line bg-elevated px-4 py-2 text-center text-sm font-medium text-fg transition-colors hover:bg-surface"
                    >
                        Continue with GitHub
                    </a>
                    <p className="text-center text-[11px] text-muted">
                        Opens GitHub to sign in or create access, then returns you here.
                    </p>
                </div>

                <p className="text-center text-xs text-muted">
                    Already have an account?{' '}
                    <Link to={`/login?next=${encodeURIComponent(next)}`} className="text-accent hover:underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
