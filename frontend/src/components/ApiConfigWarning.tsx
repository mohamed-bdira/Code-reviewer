import { getApiBaseUrl, isApiConfiguredForDeploy } from '../auth/apiFetch';

/** Shown when the Vercel build had no Railway backend configured. */
export default function ApiConfigWarning() {
    if (isApiConfiguredForDeploy()) {
        return null;
    }
    const base = getApiBaseUrl();
    return (
        <div className="rounded border border-amber-800 bg-amber-950/50 px-3 py-2 text-xs text-amber-100">
            <strong className="font-medium">API not configured.</strong> On Vercel → Environment Variables, set{' '}
            <code className="rounded bg-black/30 px-1">VITE_API_BASE_URL</code> to your Railway backend URL (e.g.{' '}
            <code className="rounded bg-black/30 px-1">https://….up.railway.app</code> — no trailing slash, no{' '}
            <code className="rounded bg-black/30 px-1">/api</code>), then <strong>Redeploy</strong>.
            {base ? (
                <span className="mt-1 block text-amber-200/80">Current build API base: {base}</span>
            ) : (
                <span className="mt-1 block text-amber-200/80">
                    This build has no API proxy; requests go to {typeof window !== 'undefined' ? window.location.origin : 'Vercel'}
                    /api/… and return 404.
                </span>
            )}
        </div>
    );
}
