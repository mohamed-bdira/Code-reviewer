import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedPrivateKey: string | null = null;

function loadPrivateKey(): string {
    if (cachedPrivateKey) {
        return cachedPrivateKey;
    }
    const envPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    const keyPath = envPath
        ? path.resolve(envPath)
        : path.resolve(__dirname, '..', '..', '..', 'github-app-key.pem');
    cachedPrivateKey = fs.readFileSync(keyPath, 'utf8');
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
