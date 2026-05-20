import { getApiBaseUrl } from '../auth/apiFetch';

/** Shown when VITE_API_BASE_URL was not set at Vercel build time (API calls hit Vercel → 404). */
export default function ApiConfigWarning() {
    const base = getApiBaseUrl();
    if (base) {
        return null;
    }
    return (
        <div className="rounded border border-amber-800 bg-amber-950/50 px-3 py-2 text-xs text-amber-100">
            <strong className="font-medium">API not configured.</strong> Set{' '}
            <code className="rounded bg-black/30 px-1">VITE_API_BASE_URL</code> on Vercel to your Railway backend URL
            (e.g. <code className="rounded bg-black/30 px-1">https://….up.railway.app</code>), then{' '}
            <strong>redeploy</strong>. Without it, login and GitHub sign-in request{' '}
            <code className="rounded bg-black/30 px-1">/api/…</code> on Vercel and return 404.
        </div>
    );
}
