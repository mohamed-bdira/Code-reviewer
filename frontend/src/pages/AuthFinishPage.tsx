import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function AuthFinishPage() {
    const { setSessionFromToken } = useAuth();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const token = params.get('token');
        const next = params.get('next') ?? '/';
        if (!token) {
            setError('Missing token from GitHub OAuth callback');
            return;
        }
        setSessionFromToken(token)
            .then(() => navigate(next, { replace: true }))
            .catch(() => setError('Could not establish session from GitHub OAuth response'));
    }, [params, setSessionFromToken, navigate]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
            {error ? (
                <p className="text-sm text-rose-300">{error}</p>
            ) : (
                <p className="text-sm">Finishing GitHub sign-in…</p>
            )}
        </div>
    );
}
