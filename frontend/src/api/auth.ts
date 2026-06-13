import { apiFetch } from '../auth/apiFetch';

export type AuthUser = {
    id: string;
    email: string;
    displayName?: string | null;
    githubLogin?: string | null;
};

export function fetchMe(): Promise<{ user: AuthUser }> {
    return apiFetch<{ user: AuthUser }>('/api/auth/me');
}
