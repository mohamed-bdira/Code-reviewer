import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Must stay in sync with pythonExploit.py when upstream generation fails. */
export const REVIEW_UNAVAILABLE_MARKER = '[Review generation unavailable]';

function findBundledPythonExploit(): string | null {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
        const candidate = path.join(dir, 'scripts', 'pythonExploit.py');
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function resolvePythonScriptPath(): string {
    const cwd = process.cwd();
    const envRaw = process.env.PYTHON_SCRIPT_PATH?.trim() ?? '';
    const envResolved = envRaw ? path.resolve(cwd, envRaw) : '';
    if (envResolved && existsSync(envResolved)) {
        return envResolved;
    }
    const bundled = findBundledPythonExploit();
    if (bundled) {
        if (envResolved && !existsSync(envResolved)) {
            console.warn(
                `[pythonReview] PYTHON_SCRIPT_PATH (${envResolved}) does not exist; using ${bundled}`,
            );
        }
        return bundled;
    }
    return path.resolve(cwd, 'scripts', 'pythonExploit.py');
}

function upstreamTimeoutSec(): number {
    const raw = Number(process.env.AI_REVIEW_UPSTREAM_TIMEOUT_SEC ?? 120);
    if (!Number.isFinite(raw) || raw <= 0) {
        return 180;
    }
    return Math.min(300, Math.max(30, Math.floor(raw)));
}

/** Node subprocess budget: upstream read timeout plus buffer for Python startup/parsing/retries. */
function pythonSubprocessTimeoutMs(): number {
    return (upstreamTimeoutSec() + 30) * 1000;
}

/** Small pause between segmented AI calls to reduce upstream rate limiting. */
export async function delayMs(ms: number): Promise<void> {
    const n = Math.max(0, Math.floor(ms));
    if (n <= 0) return;
    await new Promise<void>((resolve) => {
        setTimeout(resolve, n);
    });
}

export function isRetriableUpstreamError(message: string): boolean {
    const m = message.toLowerCase();
    if (/\b429\b/.test(m)) return true;
    if (/\b502\b|\b503\b|\b504\b/.test(m)) return true;
    if (/rate[\s_-]?limit/.test(m)) return true;
    if (/too many requests/.test(m)) return true;
    if (/resource_exhausted/.test(m)) return true;
    if (/overload|unavailable|try again/.test(m)) return true;
    if (/timed out|timeout|read timeout|connect timeout/.test(m)) return true;
    if (/no response parsed from upstream/.test(m)) return true;
    if (/upstream returned status/.test(m)) return true;
    if (/barderrorinfo/.test(m)) return true;
    return false;
}

function isUnavailableReviewOutput(output: string): boolean {
    return output.includes(REVIEW_UNAVAILABLE_MARKER);
}

function defaultPythonBin(): string {
    if (process.env.PYTHON_BIN?.trim()) {
        return process.env.PYTHON_BIN.trim();
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

/** Strip cookie/token env vars so the Python bridge cannot pick up credentials. */
export function isForbiddenPythonEnvKey(key: string): boolean {
    const upper = key.toUpperCase();
    if (FORBIDDEN_PYTHON_ENV_KEYS.has(upper)) {
        return true;
    }
    if (upper.startsWith('GEMINI_') && /API|COOKIE|TOKEN|AUTH/.test(upper)) {
        return true;
    }
    if (upper.includes('_COOKIE') || upper.endsWith('_COOKIES')) {
        return true;
    }
    return false;
}

const FORBIDDEN_PYTHON_ENV_KEYS = new Set([
    'GEMINI_API_KEY',
    'GEMINI_COOKIE',
    'GEMINI_COOKIES',
    'GEMINI_TOKEN',
    'GOOGLE_API_KEY',
    'PYTHON_EXPLOIT_COOKIE',
    'PYTHON_EXPLOIT_COOKIES',
    'PYTHON_EXPLOIT_TOKEN',
    'HTTP_COOKIE',
    'COOKIE',
]);

/** Minimal env for the child process — credentials never forwarded. */
export function buildPythonChildEnv(parentEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...parentEnv, PYTHONIOENCODING: 'utf-8' };
    for (const key of Object.keys(env)) {
        if (isForbiddenPythonEnvKey(key)) {
            delete env[key];
        }
    }
    return env;
}

function runPythonReviewOnce(prompt: string, diff: string): Promise<string> {
    const pythonBin = defaultPythonBin();
    const scriptPath = resolvePythonScriptPath();

    return new Promise((resolve, reject) => {
        const child = spawn(pythonBin, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: buildPythonChildEnv(),
        });

        const timeoutMs = pythonSubprocessTimeoutMs();
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`python review timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            const output = stdout.trim();
            const errText = stderr.trim();

            if (code === 0 && output && !isUnavailableReviewOutput(output)) {
                resolve(output);
                return;
            }

            if (isUnavailableReviewOutput(output)) {
                reject(new Error(errText || 'upstream review generation unavailable'));
                return;
            }

            if (code !== 0) {
                reject(new Error(errText || `python review failed with code ${code}`));
                return;
            }

            if (!output) {
                reject(new Error(errText || 'python review returned empty output'));
                return;
            }

            resolve(output);
        });

        child.stdin.write(JSON.stringify({ prompt, diff }));
        child.stdin.end();
    });
}

/**
 * Runs the Gemini bridge script with retries after likely rate-limit / overload / timeout responses.
 * Large PRs fire many sequential segment calls — combine with AI_REVIEW_SEGMENT_DELAY_MS between segments if needed.
 */
export async function runPythonReview(prompt: string, diff: string): Promise<string> {
    const maxAttemptsRaw = Number(process.env.AI_REVIEW_RETRY_MAX ?? 3);
    const maxAttempts = Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0 ? Math.floor(maxAttemptsRaw) : 3;
    const baseDelayRaw = Number(process.env.AI_REVIEW_RETRY_BASE_MS ?? 5000);
    const baseDelayMs = Number.isFinite(baseDelayRaw) && baseDelayRaw >= 0 ? baseDelayRaw : 5000;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await runPythonReviewOnce(prompt, diff);
        } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const retriable = isRetriableUpstreamError(msg);
            if (!retriable || attempt >= maxAttempts) {
                throw err;
            }
            const backoff = Math.floor(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500);
            console.warn(
                `[pythonReview] retriable upstream error (${attempt}/${maxAttempts}): ${msg.slice(0, 220)} … waiting ${backoff}ms`,
            );
            await delayMs(backoff);
        }
    }
    throw lastErr;
}
