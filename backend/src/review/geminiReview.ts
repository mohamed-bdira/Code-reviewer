import { GoogleGenerativeAI } from '@google/generative-ai';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

let client: GoogleGenerativeAI | null = null;
let loggedModelName: string | null = null;

function geminiApiKey(): string {
    const key = process.env.GEMINI_API_KEY?.trim() ?? '';
    if (!key) {
        throw new Error('GEMINI_API_KEY is not set — PR AI reviews require a Google AI Studio API key');
    }
    return key;
}

export function resolveGeminiModelName(env: NodeJS.ProcessEnv = process.env): string {
    const raw = env.GEMINI_MODEL?.trim();
    const resolved = raw && raw.length > 0 ? raw : DEFAULT_GEMINI_MODEL;
    // #region agent log
    fetch('http://127.0.0.1:7361/ingest/ce185b65-e675-4766-a57b-ec2db6ddc92a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '09aad7' },
        body: JSON.stringify({
            sessionId: '09aad7',
            runId: 'pre-fix',
            hypothesisId: 'H1',
            location: 'geminiReview.ts:resolveGeminiModelName',
            message: 'gemini model resolved',
            data: {
                source: raw && raw.length > 0 ? 'env' : 'default',
                envModel: raw && raw.length > 0 ? raw : null,
                defaultModel: DEFAULT_GEMINI_MODEL,
                resolved,
            },
            timestamp: Date.now(),
        }),
    }).catch(() => {});
    // #endregion
    return resolved;
}

function getGeminiClient(): GoogleGenerativeAI {
    if (!client) {
        client = new GoogleGenerativeAI(geminiApiKey());
    }
    return client;
}

function upstreamTimeoutMs(): number {
    const raw = Number(process.env.AI_REVIEW_UPSTREAM_TIMEOUT_SEC ?? 120);
    if (!Number.isFinite(raw) || raw <= 0) {
        return 180_000;
    }
    return Math.min(300, Math.max(30, Math.floor(raw))) * 1000;
}

/** Same merge rules as the former pythonExploit.py build_final_prompt. */
export function buildReviewPrompt(prompt: string, diff: string): string {
    const p = prompt.trim();
    const d = diff.trim();
    if (p && d) {
        return `${p}\n\nBEGIN_DIFF\n${d}\nEND_DIFF`;
    }
    return p;
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
    if (/timed out|timeout|deadline exceeded/.test(m)) return true;
    if (/fetch failed|network|econnreset|etimedout/.test(m)) return true;
    if (/service unavailable/.test(m)) return true;
    return false;
}

export function computeRetryBackoffMs(attempt: number, baseDelayMs: number): number {
    const jitter = Math.floor(Math.random() * 500);
    return Math.floor(baseDelayMs * 2 ** (attempt - 1) + jitter);
}

async function runGeminiReviewOnce(prompt: string, diff: string): Promise<string> {
    const modelName = resolveGeminiModelName();
    if (loggedModelName !== modelName) {
        loggedModelName = modelName;
        console.log(`[geminiReview] model=${modelName}`);
    }
    const fullPrompt = buildReviewPrompt(prompt, diff);
    const model = getGeminiClient().getGenerativeModel({ model: modelName });    const timeoutMs = upstreamTimeoutMs();

    const result = await Promise.race([
        model.generateContent(fullPrompt),
        new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`gemini review timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);

    const text = result.response.text()?.trim() ?? '';
    if (!text) {
        throw new Error('gemini returned empty response');
    }
    return text;
}

/**
 * Runs the official Gemini SDK with retries after likely rate-limit / overload / timeout responses.
 */
export async function runGeminiReview(prompt: string, diff: string): Promise<string> {
    const maxAttemptsRaw = Number(process.env.AI_REVIEW_RETRY_MAX ?? 5);
    const maxAttempts = Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0 ? Math.floor(maxAttemptsRaw) : 5;
    const baseDelayRaw = Number(process.env.AI_REVIEW_RETRY_BASE_MS ?? 5000);
    const baseDelayMs = Number.isFinite(baseDelayRaw) && baseDelayRaw >= 0 ? baseDelayRaw : 5000;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await runGeminiReviewOnce(prompt, diff);
        } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            if (/403 forbidden|denied access/i.test(msg)) {
                // #region agent log
                fetch('http://127.0.0.1:7361/ingest/ce185b65-e675-4766-a57b-ec2db6ddc92a', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '09aad7' },
                    body: JSON.stringify({
                        sessionId: '09aad7',
                        runId: 'pre-fix',
                        hypothesisId: 'H2',
                        location: 'geminiReview.ts:runGeminiReview:403',
                        message: 'gemini 403 denied access',
                        data: {
                            model: resolveGeminiModelName(),
                            apiKeyConfigured: isGeminiApiKeyConfigured(),
                            errorSnippet: msg.slice(0, 120),
                        },
                        timestamp: Date.now(),
                    }),
                }).catch(() => {});
                // #endregion
                throw new Error(
                    `${msg.slice(0, 240)} — create a fresh API key at https://aistudio.google.com/apikey and set GEMINI_API_KEY on Railway`,
                );
            }
            if (/limit: 0.*gemini-2\.0/i.test(msg)) {
                throw new Error(
                    `Gemini model ${resolveGeminiModelName()} is shut down (quota limit 0). Set GEMINI_MODEL=${DEFAULT_GEMINI_MODEL} on Railway and redeploy.`,
                );
            }            const retriable = isRetriableUpstreamError(msg);
            if (!retriable || attempt >= maxAttempts) {
                throw err;
            }
            const backoff = computeRetryBackoffMs(attempt, baseDelayMs);
            console.warn(
                `[geminiReview] retriable upstream error (${attempt}/${maxAttempts}): ${msg.slice(0, 220)} … waiting ${backoff}ms`,
            );
            await delayMs(backoff);
        }
    }
    throw lastErr;
}

/** True when GEMINI_API_KEY is configured (startup / health checks). */
export function isGeminiApiKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.GEMINI_API_KEY?.trim());
}
