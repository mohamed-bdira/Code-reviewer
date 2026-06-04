import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

type ThemeContextShape = {
    theme: ThemePreference;
    resolved: 'light' | 'dark';
    setTheme: (next: ThemePreference) => void;
};

const STORAGE_KEY = 'pfe-theme';
const ThemeContext = createContext<ThemeContextShape | null>(null);

function readStored(): ThemePreference {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value === 'light' || value === 'dark' || value === 'system') {
            return value;
        }
    } catch {
        /* ignore */
    }
    return 'system';
}

function systemPrefersDark(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<ThemePreference>(() => readStored());
    const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, []);

    const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('dark', resolved === 'dark');
    }, [resolved]);

    const setTheme = useCallback((next: ThemePreference) => {
        setThemeState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            /* ignore */
        }
    }, []);

    const value = useMemo<ThemeContextShape>(
        () => ({ theme, resolved, setTheme }),
        [theme, resolved, setTheme],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextShape {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        throw new Error('useTheme must be used inside <ThemeProvider>');
    }
    return ctx;
}
