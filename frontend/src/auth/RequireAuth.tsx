import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { sanitizePostLoginPath } from './sanitizePostLoginPath';

export default function RequireAuth({ children }: { children: ReactNode }) {
    const { user, initializing } = useAuth();
    const location = useLocation();

    if (initializing) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-bg text-muted">
                <p className="text-sm">Loading session…</p>
            </div>
        );
    }

    if (!user) {
        const next = sanitizePostLoginPath(location.pathname + location.search);
        return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }

    return <>{children}</>;
}
