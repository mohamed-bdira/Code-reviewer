import { apiFetch } from '../auth/apiFetch';

export type AuthUser = {
    id: string;
    email: string;
    displayName?: string | null;
    githubLogin?: string | null;
};

export type AuthResponse = {
    token: string;
    user: AuthUser;
};

export function register(input: {
    email: string;
    password: string;
    displayName?: string;
}): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export function login(input: { email: string; password: string }): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export function fetchMe(): Promise<{ user: AuthUser }> {
    return apiFetch<{ user: AuthUser }>('/api/auth/me');
}
