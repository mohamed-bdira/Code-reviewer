import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGithubAppKeyStatus } from './githubAppKey.js';
import { describeMissingMongoEnv, resolveMongoUri } from './mongoUri.js';
import { getAstGrepStatus } from '../review/astGrep.js';

export type PythonBridgeStatus = {
    bin: string;
    scriptPath: string;
    scriptFound: boolean;
};

export type HealthSnapshot = {
    ok: boolean;
    mongodb: 'connected' | 'disconnected';
    mongoUriConfigured: boolean;
    githubApp: {
        appIdSet: boolean;
        privateKeySet: boolean;
    };
    python: PythonBridgeStatus;
    issues: string[];
};

function defaultPythonBin(env: NodeJS.ProcessEnv): string {
    if (env.PYTHON_BIN?.trim()) {
        return env.PYTHON_BIN.trim();
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

function resolvePythonScriptPath(env: NodeJS.ProcessEnv): string {
    const cwd = process.cwd();
    const envRaw = env.PYTHON_SCRIPT_PATH?.trim() ?? '';
    if (envRaw) {
        return path.resolve(cwd, envRaw);
    }
    const fromSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'pythonExploit.py');
    if (existsSync(fromSrc)) {
        return fromSrc;
    }
    return path.resolve(cwd, 'scripts', 'pythonExploit.py');
}

export function getPythonBridgeStatus(env: NodeJS.ProcessEnv = process.env): PythonBridgeStatus {
    const scriptPath = resolvePythonScriptPath(env);
    return {
        bin: defaultPythonBin(env),
        scriptPath,
        scriptFound: existsSync(scriptPath),
    };
}

export type StartupCheckItem = {
    ok: boolean;
    label: string;
    detail: string;
};

export function collectStartupChecks(
    env: NodeJS.ProcessEnv = process.env,
    mongoReadyState: number = 0,
): StartupCheckItem[] {
    const checks: StartupCheckItem[] = [];
    const mongoUri = resolveMongoUri(env);
    checks.push({
        ok: Boolean(mongoUri),
        label: 'MONGO_URI',
        detail: mongoUri
            ? 'MongoDB connection string resolved'
            : describeMissingMongoEnv(env),
    });
    checks.push({
        ok: mongoReadyState === 1,
        label: 'MongoDB connected',
        detail:
            mongoReadyState === 1
                ? 'mongoose readyState=1'
                : mongoUri
                  ? 'URI configured but not connected yet (check Atlas IP allowlist / credentials)'
                  : 'Skipped — no URI',
    });

    const gh = getGithubAppKeyStatus(env);
    checks.push({
        ok: gh.appIdSet,
        label: 'GITHUB_APP_ID',
        detail: gh.appIdSet ? 'Set' : 'Missing — GitHub App API calls will fail',
    });
    checks.push({
        ok: gh.privateKeyConfigured,
        label: 'GITHUB_APP_PRIVATE_KEY',
        detail: gh.privateKeyConfigured
            ? gh.privateKeyInlineSet
                ? 'Inline env var set'
                : `Readable file at ${gh.privateKeyPath}`
            : `Not set and PEM not readable at ${gh.privateKeyPath}. Docker excludes *.pem — set GITHUB_APP_PRIVATE_KEY on Railway.`,
    });
    checks.push({
        ok: Boolean(env.GITHUB_WEBHOOK_SECRET?.trim()),
        label: 'GITHUB_WEBHOOK_SECRET',
        detail: env.GITHUB_WEBHOOK_SECRET?.trim()
            ? 'Set (webhook signatures will be verified)'
            : 'Unset — webhooks accepted without signature verification (unsafe in production)',
    });

    const py = getPythonBridgeStatus(env);
    checks.push({
        ok: py.scriptFound,
        label: 'Python AI bridge',
        detail: py.scriptFound
            ? `${py.bin} → ${py.scriptPath}`
            : `Script not found at ${py.scriptPath}`,
    });

    const sg = getAstGrepStatus(env);
    checks.push({
        ok: sg.binFound && Boolean(sg.configDir),
        label: 'ast-grep (optional)',
        detail:
            sg.binFound && sg.configDir
                ? `${sg.bin} + ${sg.configDir}`
                : !sg.binFound
                  ? `Binary not found at ${sg.bin} (npm install @ast-grep/cli in backend)`
                  : 'Rules project missing (backend/ast-grep/sgconfig.yml)',
    });

    return checks;
}

export function logStartupChecklist(mongoReadyState: number = 0): StartupCheckItem[] {
    const checks = collectStartupChecks(process.env, mongoReadyState);
    const failed = checks.filter((c) => !c.ok);
    console.log('[startup] Configuration checklist:');
    for (const c of checks) {
        console.log(`[startup]   ${c.ok ? 'OK' : 'FAIL'} ${c.label}: ${c.detail}`);
    }
    if (failed.length > 0) {
        console.error(
            `[startup] ${failed.length} check(s) failed — PR reviews may not run until Railway Variables are set. ` +
                'See backend/.env.example for the full list.',
        );
    }
    return checks;
}

export function buildHealthSnapshot(mongoReadyState: number): HealthSnapshot {
    const mongoUriConfigured = Boolean(resolveMongoUri());
    const mongodb = mongoReadyState === 1 ? 'connected' : 'disconnected';
    const gh = getGithubAppKeyStatus();
    const python = getPythonBridgeStatus();
    const issues: string[] = [];

    if (!mongoUriConfigured) {
        issues.push(describeMissingMongoEnv());
    } else if (mongodb !== 'connected') {
        issues.push('MongoDB URI is set but mongoose is not connected');
    }
    if (!gh.appIdSet) {
        issues.push('GITHUB_APP_ID is missing');
    }
    if (!gh.privateKeyConfigured) {
        issues.push(
            'GITHUB_APP_PRIVATE_KEY is missing (PEM files are not copied into Docker — set the env var on Railway)',
        );
    }
    if (!python.scriptFound) {
        issues.push(`Python review script not found at ${python.scriptPath}`);
    }

    const ok =
        mongodb === 'connected' &&
        gh.appIdSet &&
        gh.privateKeyConfigured &&
        python.scriptFound;

    return {
        ok,
        mongodb,
        mongoUriConfigured,
        githubApp: {
            appIdSet: gh.appIdSet,
            privateKeySet: gh.privateKeyConfigured,
        },
        python,
        issues,
    };
}
