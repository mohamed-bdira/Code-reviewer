import { useCallback, useEffect, useState } from 'react';
import { fetchDashboardSummary } from '../api/dashboard';
import type { DashboardSummary } from '../types/dashboard';
import AiPanel from './AiPanel';
import FindingsPanel from './FindingsPanel';
import GithubPanel from './GithubPanel';
import OverviewPanel from './OverviewPanel';
import ReposPanel from './ReposPanel';
import SchedulePanel from './SchedulePanel';

const SECTIONS = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'github' as const, label: 'GitHub & CI' },
    { id: 'repos' as const, label: 'Repo config' },
    { id: 'schedule' as const, label: 'Scheduled scan' },
    { id: 'ai' as const, label: 'AI & Python' },
    { id: 'findings' as const, label: 'Bug findings' },
];

type SectionId = (typeof SECTIONS)[number]['id'];

export default function DashboardApp() {
    const [section, setSection] = useState<SectionId>('overview');
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
            setSummaryError(e instanceof Error ? e.message : 'Failed to load summary');
            setSummary(null);
        } finally {
            setSummaryLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSummary();
    }, [loadSummary]);

    const scanOn = summary?.scheduledBugScan.enabled;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200">
            <div className="flex min-h-screen">
                <aside className="flex w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60">
                    <div className="border-b border-slate-800 px-4 py-5">
                        <h1 className="text-sm font-semibold leading-tight text-white">PFE dashboard</h1>
                        <p className="mt-1 text-xs text-slate-500">Webhook + Mongo + findings</p>
                    </div>
                    <nav className="flex flex-1 flex-col gap-0.5 p-2">
                        {SECTIONS.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => setSection(s.id)}
                                className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                    section === s.id
                                        ? 'bg-violet-600/25 text-white ring-1 ring-violet-500/50'
                                        : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                                }`}
                            >
                                {s.label}
                                {s.id === 'schedule' && scanOn != null && (
                                    <span className={`float-right text-[10px] ${scanOn ? 'text-emerald-400' : 'text-slate-600'}`}>
                                        {scanOn ? '●' : '○'}
                                    </span>
                                )}
                            </button>
                        ))}
                    </nav>
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
                        {section === 'repos' && <ReposPanel summary={summary} />}
                        {section === 'schedule' && <SchedulePanel summary={summary} />}
                        {section === 'ai' && <AiPanel summary={summary} />}
                        {section === 'findings' && <FindingsPanel />}
                    </div>
                </div>
            </div>
        </div>
    );
}
