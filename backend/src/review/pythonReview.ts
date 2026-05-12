import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Small pause between segmented AI calls to reduce upstream rate limiting. */
export async function delayMs(ms: number): Promise<void> {
    const n = Math.max(0, Math.floor(ms));
    if (n <= 0) return;
    await new Promise<void>((resolve) => {
        setTimeout(resolve, n);
    });
}

function isLikelyAiRateLimitOrOverload(message: string): boolean {
    const m = message.toLowerCase();
    if (/\b429\b/.test(m)) return true;
    if (/\b502\b|\b503\b|\b504\b/.test(m)) return true;
    if (/rate[\s_-]?limit/.test(m)) return true;
    if (/too many requests/.test(m)) return true;
    if (/resource_exhausted/.test(m)) return true;
    if (/overload|unavailable|try again/.test(m)) return true;
    return false;
}

function runPythonReviewOnce(prompt: string, diff: string): Promise<string> {
    const pythonBin = process.env.PYTHON_BIN || 'python';
    const scriptPath = resolvePythonScriptPath();

    return new Promise((resolve, reject) => {
        const child = spawn(pythonBin, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
            },
        });

        const timeoutMs = 90_000;
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

            if (code === 0 && output) {
                resolve(output);
                return;
            }

            if (output) {
                console.warn('Python review returned non-zero status, using fallback output:', stderr.trim());
                resolve(output);
                return;
            }

            reject(new Error(`python review failed with code ${code}. stderr: ${stderr.trim()}`));
        });

        child.stdin.write(JSON.stringify({ prompt, diff }));
        child.stdin.end();
    });
}

/**
 * Runs the Gemini bridge script with retries after likely rate-limit / overload responses.
 * Large PRs fire many sequential segment calls — combine with AI_REVIEW_SEGMENT_DELAY_MS between segments if needed.
 */
export async function runPythonReview(prompt: string, diff: string): Promise<string> {
    const maxAttemptsRaw = Number(process.env.AI_REVIEW_RETRY_MAX ?? 3);
    const maxAttempts = Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0 ? Math.floor(maxAttemptsRaw) : 3;
    const baseDelayRaw = Number(process.env.AI_REVIEW_RETRY_BASE_MS ?? 2000);
    const baseDelayMs = Number.isFinite(baseDelayRaw) && baseDelayRaw >= 0 ? baseDelayRaw : 2000;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await runPythonReviewOnce(prompt, diff);
        } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const retriable = isLikelyAiRateLimitOrOverload(msg);
            if (!retriable || attempt >= maxAttempts) {
                throw err;
            }
            const backoff = Math.floor(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500);
            console.warn(
                `[pythonReview] retriable upstream error (${attempt}/${maxAttempts}): ${msg.slice(0, 180)} … waiting ${backoff}ms`,
            );
            await delayMs(backoff);
        }
    }
    throw lastErr;
}
