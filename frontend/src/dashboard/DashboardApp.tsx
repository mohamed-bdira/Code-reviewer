import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchDashboardSummary } from '../api/dashboard';
import { useAuth } from '../auth/AuthContext';
import type { DashboardSummary } from '../types/dashboard';
import AiPanel from './AiPanel';
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
    { id: 'ai' as const, label: 'AI & Python', path: '/ai' },
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
        <div className="min-h-screen bg-slate-950 text-slate-200">
            <div className="flex min-h-screen">
                <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60">
                    <div className="border-b border-slate-800 px-4 py-5">
                        <h1 className="text-sm font-semibold leading-tight text-white">PFE dashboard</h1>
                        <p className="mt-1 text-xs text-slate-500">Live · {connected ? 'connected' : 'reconnecting…'}</p>
                    </div>
                    <nav className="flex flex-1 flex-col gap-0.5 p-2">
                        {SECTIONS.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => navigate(s.path)}
                                className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                    section === s.id
                                        ? 'bg-violet-600/25 text-white ring-1 ring-violet-500/50'
                                        : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                                }`}
                            >
                                {s.label}
                                {s.id === 'schedule' && scanOn != null && (
                                    <span
                                        className={`float-right text-[10px] ${
                                            scanOn ? 'text-emerald-400' : 'text-slate-600'
                                        }`}
                                    >
                                        {scanOn ? '●' : '○'}
                                    </span>
                                )}
                            </button>
                        ))}
                    </nav>
                    <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-500">
                        <p className="truncate text-slate-300">{user?.email}</p>
                        {user?.githubLogin && (
                            <p className="truncate text-slate-500">@{user.githubLogin}</p>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                logout();
                                navigate('/login', { replace: true });
                            }}
                            className="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                        >
                            Sign out
                        </button>
                    </div>
                </aside>

                <div className="min-w-0 flex-1 overflow-auto">
                    <header className="border-b border-slate-800 px-6 py-6">
                        <h2 className="text-lg font-medium text-white">{SECTIONS.find((s) => s.id === section)?.label}</h2>
                        {summaryError && (
                            <p className="mt-2 text-sm text-amber-400">
                                Dashboard summary unavailable ({summaryError}). Some panels will be empty until the backend
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
                        {section === 'ai' && <AiPanel summary={summary} />}
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
