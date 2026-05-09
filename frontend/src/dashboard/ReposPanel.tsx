import type { DashboardSummary } from '../types/dashboard';
import { formatIso } from './formatters';

export default function ReposPanel({ summary }: { summary: DashboardSummary | null }) {
    const repos = summary?.repos ?? [];

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-400">
                Each row mirrors <code className="text-slate-300">RepoConfig</code> in Mongo — focus areas extend score
                dimensions; <code className="text-slate-300">useAstGrep</code> hints the model only (no bundled ast-grep
                runner); <code className="text-slate-300">mergeMinScore</code> + enforcement level gate the merge banner.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-3 py-2">Repo</th>
                            <th className="px-3 py-2">Focus</th>
                            <th className="px-3 py-2">Policy</th>
                            <th className="px-3 py-2">AST hint</th>
                            <th className="px-3 py-2">Min score</th>
                            <th className="max-w-[200px] px-3 py-2">Custom rules excerpt</th>
                            <th className="px-3 py-2">Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        {repos.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                                    No repos yet — webhook on a repo auto-creates a default config row.
                                </td>
                            </tr>
                        )}
                        {repos.map((r) => (
                            <tr key={r.repoFullName} className="border-b border-slate-800/80 hover:bg-slate-900/30">
                                <td className="px-3 py-2 align-top font-mono text-xs text-emerald-300">{r.repoFullName}</td>
                                <td className="max-w-[120px] px-3 py-2 align-top text-xs text-slate-400">{r.focusAreas.join(', ')}</td>
                                <td className="px-3 py-2 align-top text-slate-300">{r.enforcementLevel}</td>
                                <td className="px-3 py-2 align-top">{r.useAstGrep ? 'yes' : 'no'}</td>
                                <td className="px-3 py-2 align-top font-mono">{r.mergeMinScore}</td>
                                <td className="max-w-[220px] px-3 py-2 align-top text-xs text-slate-500">{r.customRules}</td>
                                <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-slate-600">
                                    {formatIso(r.updatedAt ?? r.createdAt)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
