import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchDashboardSummary } from '../api/dashboard';
import { useAuth } from '../auth/AuthContext';
import ThemeToggle from '../theme/ThemeToggle';
import type { DashboardSummary } from '../types/dashboard';
import ConfigurationsPanel from './ConfigurationsPanel';
import FindingsPanel from './FindingsPanel';
import GithubPanel from './GithubPanel';
import KeysPanel from './KeysPanel';
import OverviewPanel from './OverviewPanel';
import SchedulePanel from './SchedulePanel';
import { useEventStream } from './useEventStream';

const SECTIONS = [
    { id: 'overview' as const, label: 'Overview', path: '/' },
    { id: 'github' as const, label: 'GitHub & CI', path: '/github' },
    { id: 'configurations' as const, label: 'Configurations', path: '/configurations' },
    { id: 'schedule' as const, label: 'Scheduled scan', path: '/schedule' },
    { id: 'findings' as const, label: 'Bug findings', path: '/findings' },
    { id: 'keys' as const, label: 'API keys', path: '/keys' },
];

type SectionId = (typeof SECTIONS)[number]['id'];

function pathToSection(pathname: string): SectionId {
    if (pathname === '/' || pathname === '') return 'overview';
    const trimmed = pathname.replace(/^\//, '').split('/')[0] ?? '';
    const match = SECTIONS.find((s) => s.id === trimmed);
    return match ? match.id : 'overview';
}

export default function DashboardApp() {
    const { user, token, serviceKey, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const section = pathToSection(location.pathname);

    const [summary, setSummary] = useState<DashboardSummary | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(true);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    const loadSummary = useCallback(async () => {
        setSummaryLoading(true);
        setSummaryError(null);
        try {
            const s = await fetchDashboardSummary();
            setSummary(s);
        } catch (e) {
            setSummaryError(extractMessage(e));
            setSummary(null);
        } finally {
            setSummaryLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSummary();
    }, [loadSummary]);

    const { lastEvent, connected } = useEventStream(token, serviceKey);

    useEffect(() => {
        if (!lastEvent) return;
        if (
            lastEvent.type === 'finding-created' ||
            lastEvent.type === 'finding-updated' ||
            lastEvent.type === 'repo-config-updated' ||
            lastEvent.type === 'installation-linked'
        ) {
            void loadSummary();
        }
    }, [lastEvent, loadSummary]);

    const scanOn = summary?.scheduledBugScan.enabled;

    return (
        <div className="min-h-screen bg-bg text-fg">
            <div className="flex min-h-screen">
                <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col overflow-hidden border-r border-line bg-surface">
                    <div className="border-b border-line px-4 py-5">
                        <h1 className="text-sm font-semibold leading-tight text-fg">PFE dashboard</h1>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                            <span
                                className={`inline-block h-1.5 w-1.5 rounded-full ${
                                    connected ? 'bg-emerald-500' : 'bg-amber-500'
                                }`}
                            />
                            {connected ? 'Live' : 'Reconnecting…'}
                        </p>
                    </div>
                    <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
                        {SECTIONS.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => navigate(s.path)}
                                className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                    section === s.id
                                        ? 'bg-accent/15 text-fg ring-1 ring-accent/40'
                                        : 'text-muted hover:bg-elevated hover:text-fg'
                                }`}
                            >
                                {s.label}
                                {s.id === 'schedule' && scanOn != null && (
                                    <span
                                        className={`float-right text-[10px] ${
                                            scanOn ? 'text-emerald-500' : 'text-faint'
                                        }`}
                                    >
                                        {scanOn ? '●' : '○'}
                                    </span>
                                )}
                            </button>
                        ))}
                    </nav>
                    <div className="shrink-0 space-y-3 border-t border-line px-4 py-3 text-xs text-muted">
                        <ThemeToggle />
                        <div>
                            {user?.githubLogin ? (
                                <p className="truncate text-fg">@{user.githubLogin}</p>
                            ) : (
                                <p className="truncate text-fg">{user?.email}</p>
                            )}
                            {user?.githubLogin && user?.email && (
                                <p className="truncate text-muted">{user.email}</p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                logout();
                                navigate('/login', { replace: true });
                            }}
                            className="w-full rounded-md border border-line px-2 py-1.5 text-xs text-muted transition-colors hover:bg-elevated hover:text-fg"
                        >
                            Sign out
                        </button>
                    </div>
                </aside>

                <div className="min-w-0 flex-1 overflow-auto">
                    <header className="border-b border-line bg-surface/60 px-6 py-6 backdrop-blur">
                        <h2 className="text-lg font-medium text-fg">{SECTIONS.find((s) => s.id === section)?.label}</h2>
                        {summaryError && (
                            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                                Dashboard data is temporarily unavailable. Some panels may stay empty until the service
                                responds.
                            </p>
                        )}
                    </header>
                    <div className="px-6 py-8">
                        {section === 'overview' && (
                            <OverviewPanel summary={summary} loading={summaryLoading} onRefresh={loadSummary} />
                        )}
                        {section === 'github' && <GithubPanel summary={summary} />}
                        {section === 'configurations' && <ConfigurationsPanel />}
                        {section === 'schedule' && <SchedulePanel summary={summary} />}
                        {section === 'findings' && <FindingsPanel lastEvent={lastEvent} />}
                        {section === 'keys' && <KeysPanel />}
                    </div>
                </div>
            </div>
        </div>
    );
}

function extractMessage(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'message' in err) {
        const m = (err as { message?: unknown }).message;
        if (typeof m === 'string') return m;
    }
    if (err instanceof Error) return err.message;
    return 'Failed to load summary';
}
