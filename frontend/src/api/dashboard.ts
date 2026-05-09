import type { DashboardSummary } from '../types/dashboard';

const BASE = () => import.meta.env.VITE_API_BASE_URL ?? '';

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
    const res = await fetch(`${BASE()}/api/dashboard/summary`);
    const data = (await res.json().catch(() => ({}))) as DashboardSummary & { error?: string };
    if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return data as DashboardSummary;
}
