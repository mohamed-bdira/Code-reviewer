import { getGithubAppKeyStatus } from './githubAppKey.js';
import { describeMissingMongoEnv, resolveMongoUri } from './mongoUri.js';
import { isGeminiApiKeyConfigured, resolveGeminiModelName } from '../review/geminiReview.js';
import { getAstGrepStatus } from '../review/astGrep.js';

export type GeminiReviewStatus = {
    apiKeySet: boolean;
    model: string;
};

export type HealthSnapshot = {
    ok: boolean;
    mongodb: 'connected' | 'disconnected';
    mongoUriConfigured: boolean;
    githubApp: {
        appIdSet: boolean;
        privateKeySet: boolean;
    };
    gemini: GeminiReviewStatus;
    issues: string[];
};

export function getGeminiReviewStatus(env: NodeJS.ProcessEnv = process.env): GeminiReviewStatus {
    const model = resolveGeminiModelName(env);
    return {
        apiKeySet: isGeminiApiKeyConfigured(env),
        model,
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

    const gemini = getGeminiReviewStatus(env);
    if (env.GEMINI_MODEL?.trim() === 'gemini-3.5-flash') {
        console.warn(
            '[startup] GEMINI_MODEL=gemini-3.5-flash overrides the code default (gemini-2.5-flash). ' +
                'Remove or change it on Railway — 3.5 often returns 403/503.',
        );
    }
    checks.push({
        ok: gemini.apiKeySet,
        label: 'GEMINI_API_KEY',
        detail: gemini.apiKeySet
            ? `Set (model: ${gemini.model})`
            : 'Missing — PR AI reviews will fail',
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
    const gemini = getGeminiReviewStatus();
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
    if (!gemini.apiKeySet) {
        issues.push('GEMINI_API_KEY is missing — PR AI reviews will fail');
    }

    const ok =
        mongodb === 'connected' &&
        gh.appIdSet &&
        gh.privateKeyConfigured &&
        gemini.apiKeySet;

    return {
        ok,
        mongodb,
        mongoUriConfigured,
        githubApp: {
            appIdSet: gh.appIdSet,
            privateKeySet: gh.privateKeyConfigured,
        },
        gemini,
        issues,
    };
}
