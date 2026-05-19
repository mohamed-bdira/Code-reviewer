import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_GITHUB_APP_PEM_RELATIVE = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'github-app-key.pem',
);

export type GithubAppKeyStatus = {
    appIdSet: boolean;
    privateKeyInlineSet: boolean;
    privateKeyPath: string;
    privateKeyFileReadable: boolean;
    privateKeyConfigured: boolean;
};

export function resolveGithubAppPrivateKeyPath(env: NodeJS.ProcessEnv = process.env): string {
    const envPath = env.GITHUB_APP_PRIVATE_KEY_PATH?.trim();
    return envPath ? path.resolve(envPath) : DEFAULT_GITHUB_APP_PEM_RELATIVE;
}

export function isGithubAppPrivateKeyInlineSet(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.GITHUB_APP_PRIVATE_KEY?.trim());
}

export function isGithubAppPrivateKeyFileReadable(keyPath: string): boolean {
    try {
        fs.accessSync(keyPath, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

export function getGithubAppKeyStatus(env: NodeJS.ProcessEnv = process.env): GithubAppKeyStatus {
    const appIdSet = Boolean(env.GITHUB_APP_ID?.trim());
    const privateKeyInlineSet = isGithubAppPrivateKeyInlineSet(env);
    const privateKeyPath = resolveGithubAppPrivateKeyPath(env);
    const privateKeyFileReadable = privateKeyInlineSet ? false : isGithubAppPrivateKeyFileReadable(privateKeyPath);
    const privateKeyConfigured = privateKeyInlineSet || privateKeyFileReadable;
    return {
        appIdSet,
        privateKeyInlineSet,
        privateKeyPath,
        privateKeyFileReadable,
        privateKeyConfigured,
    };
}

export function loadGithubAppPrivateKey(env: NodeJS.ProcessEnv = process.env): string {
    const inline = env.GITHUB_APP_PRIVATE_KEY?.trim();
    if (inline) {
        return inline.replace(/\\n/g, '\n');
    }
    const keyPath = resolveGithubAppPrivateKeyPath(env);
    try {
        return fs.readFileSync(keyPath, 'utf8');
    } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
        const hint =
            'Set GITHUB_APP_PRIVATE_KEY in Railway (Variables tab). PEM files (*.pem) are excluded from Docker — ' +
            'a local github-app-key.pem is not copied into the production image.';
        if (code === 'ENOENT') {
            throw new Error(`GitHub App private key not found at ${keyPath}. ${hint}`);
        }
        throw new Error(
            `Cannot read GitHub App private key at ${keyPath}${code ? ` (${code})` : ''}. ${hint}`,
            { cause: err },
        );
    }
}
