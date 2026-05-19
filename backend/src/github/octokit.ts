import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';
import { loadGithubAppPrivateKey } from '../config/githubAppKey.js';

let cachedPrivateKey: string | null = null;

function loadPrivateKey(): string {
    if (cachedPrivateKey) {
        return cachedPrivateKey;
    }
    cachedPrivateKey = loadGithubAppPrivateKey();
    return cachedPrivateKey;
}

function requireAppId(): string {
    const id = process.env.GITHUB_APP_ID;
    if (!id) {
        throw new Error('GITHUB_APP_ID is missing');
    }
    return id;
}

/** Octokit authenticated as the App itself (no installation) — for endpoints like apps.getInstallation. */
export function getAppOctokit(): Octokit {
    return new Octokit({
        authStrategy: createAppAuth,
        auth: {
            appId: requireAppId(),
            privateKey: loadPrivateKey(),
        },
    });
}

/** Octokit scoped to a single GitHub App installation — required for repo/PR operations. */
export function getInstallationOctokit(installationId: string | number): Octokit {
    return new Octokit({
        authStrategy: createAppAuth,
        auth: {
            appId: requireAppId(),
            privateKey: loadPrivateKey(),
            installationId: String(installationId),
        },
    });
}
