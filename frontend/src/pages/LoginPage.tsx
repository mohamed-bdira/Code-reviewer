import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiBrowserUrl, isApiConfiguredForDeploy } from '../auth/apiFetch';
import { sanitizePostLoginPath } from '../auth/sanitizePostLoginPath';

export default function LoginPage() {
    const [params] = useSearchParams();
    const next = sanitizePostLoginPath(params.get('next'));

    const [error, setError] = useState<string | null>(null);

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
                    <h1 className="text-lg font-semibold text-fg">Sign in to Dashboard</h1>
                    <p className="mt-1 text-xs text-muted">Use your account to view findings and manage configs.</p>
                </header>

                {error && (
                    <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                        {error}
                    </p>
                )}

                <div className="space-y-2">
                    <a
                        href={apiBrowserUrl(`/api/auth/github/start?next=${encodeURIComponent(next)}`)}
                        onClick={onGithub}
                        target="_self"
                        rel="nofollow"
                        className="block w-full rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-accent-strong"
                    >
                        Sign in with GitHub
                    </a>
                    <p className="text-center text-[11px] text-muted">
                        Opens GitHub to authorize this app (OAuth), then returns you here.
                    </p>
                </div>
            </div>
        </div>
    );
}
