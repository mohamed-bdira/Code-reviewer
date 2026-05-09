import type { DashboardSummary } from '../types/dashboard';
import { apiFetch } from '../auth/apiFetch';

export function fetchDashboardSummary(): Promise<DashboardSummary> {
    return apiFetch<DashboardSummary>('/api/dashboard/summary');
}
