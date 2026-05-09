import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function RegisterPage() {
    const { register } = useAuth();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const next = params.get('next') ?? '/';

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

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-200">
            <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow">
                <header>
                    <h1 className="text-lg font-semibold text-white">Create your account</h1>
                    <p className="mt-1 text-xs text-slate-500">
                        After signup, install the GitHub App to start receiving AI reviews.
                    </p>
                </header>

                <form className="space-y-3" onSubmit={onSubmit}>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Display name (optional)
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                        />
                    </label>
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
                        Password (min 8)
                        <input
                            type="password"
                            autoComplete="new-password"
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
                        {submitting ? 'Creating account…' : 'Create account'}
                    </button>
                </form>

                <div className="space-y-2 border-t border-slate-800 pt-4">
                    <a
                        href={`/api/auth/github/start?next=${encodeURIComponent(next)}`}
                        className="block w-full rounded border border-slate-600 bg-slate-800 px-4 py-2 text-center text-sm hover:bg-slate-700"
                    >
                        Continue with GitHub
                    </a>
                </div>

                <p className="text-center text-xs text-slate-500">
                    Already have an account?{' '}
                    <Link to={`/login?next=${encodeURIComponent(next)}`} className="text-violet-400 hover:underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
