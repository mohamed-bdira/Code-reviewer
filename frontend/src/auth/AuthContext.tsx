import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchMe, type AuthUser } from '../api/auth';
import {
    getStoredServiceKey,
    getStoredToken,
    setOnUnauthorized,
    setStoredServiceKey,
    setStoredToken,
} from './apiFetch';

type AuthContextShape = {
    user: AuthUser | null;
    token: string | null;
    serviceKey: string | null;
    initializing: boolean;
    logout: () => void;
    setSessionFromToken: (token: string) => Promise<void>;
    setServiceKey: (key: string | null) => void;
};

const AuthContext = createContext<AuthContextShape | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [token, setToken] = useState<string | null>(() => getStoredToken());
    const [serviceKey, setServiceKeyState] = useState<string | null>(() => getStoredServiceKey());
    const [initializing, setInitializing] = useState<boolean>(Boolean(getStoredToken()));
    const initializingRef = useRef(initializing);
    initializingRef.current = initializing;

    const setServiceKey = useCallback((key: string | null) => {
        setStoredServiceKey(key);
        setServiceKeyState(key && key.trim().length > 0 ? key.trim() : null);
    }, []);

    const logout = useCallback(() => {
        setStoredToken(null);
        setStoredServiceKey(null);
        setToken(null);
        setServiceKeyState(null);
        setUser(null);
    }, []);

    useEffect(() => {
        setOnUnauthorized(() => logout());
        return () => setOnUnauthorized(null);
    }, [logout]);

    useEffect(() => {
        let cancelled = false;
        if (!token) {
            setInitializing(false);
            setUser(null);
            return;
        }
        setInitializing(true);
        fetchMe()
            .then((res) => {
                if (!cancelled) setUser(res.user);
            })
            .catch(() => {
                if (!cancelled) {
                    setStoredToken(null);
                    setToken(null);
                    setUser(null);
                }
            })
            .finally(() => {
                if (!cancelled) setInitializing(false);
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    const setSessionFromToken = useCallback(async (incoming: string) => {
        setStoredServiceKey(null);
        setServiceKeyState(null);
        setStoredToken(incoming);
        setToken(incoming);
        try {
            const me = await fetchMe();
            setUser(me.user);
        } catch {
            setStoredToken(null);
            setToken(null);
            setUser(null);
        }
    }, []);

    const value = useMemo<AuthContextShape>(
        () => ({
            user,
            token,
            serviceKey,
            initializing,
            logout,
            setSessionFromToken,
            setServiceKey,
        }),
        [user, token, serviceKey, initializing, logout, setSessionFromToken, setServiceKey],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextShape {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used inside <AuthProvider>');
    }
    return ctx;
}
