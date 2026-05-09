import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function RequireAuth({ children }: { children: ReactNode }) {
    const { user, initializing } = useAuth();
    const location = useLocation();

    if (initializing) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
                <p className="text-sm">Loading session…</p>
            </div>
        );
    }

    if (!user) {
        const next = encodeURIComponent(location.pathname + location.search);
        return <Navigate to={`/login?next=${next}`} replace />;
    }

    return <>{children}</>;
}
