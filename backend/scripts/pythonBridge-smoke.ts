import assert from 'node:assert/strict';
import { parseEnforcerResponse } from '../src/enforcer/parseEnforcerResponse.js';
import { delayMs, runPythonReview } from '../src/review/pythonReview.js';

const prompt = `You are a senior software engineer reviewing a pull request.
Repository: owner/demo
PR title: Add demo file
Enforcement level: warning
Focus areas: security, style
Score sections: security, style, usability
Merge minimum: 70

Provide a short professional review of the diff. After your narrative, output exactly one JSON object in a fenced code block with language tag json:
- "scores": object with keys security, style, usability (integers 0-100)
- "notes": object with same keys, one short line each
- "blockers": array of strings ([] if none)
- "bugs": array with at least one object: category, file, lineStart, lineEnd, description

Do not put any text after the closing fence.

BEGIN_DIFF
--- /dev/null
+++ b/backend/test.ts
@@ -0,0 +1,3 @@
+const ADMIN_PASSWORD = 'demo-admin-12345';
+const JWT_SECRET = 'super-secret-demo-key';
END_DIFF`;

async function main(): Promise<void> {
    if (process.env.SKIP_PYTHON_BRIDGE_SMOKE === '1') {
        console.log('[pythonBridge-smoke] skipped (SKIP_PYTHON_BRIDGE_SMOKE=1)');
        return;
    }

    const diff = "--- /dev/null\n+++ b/backend/test.ts\n@@ -0,0 +1,3 @@\n+const ADMIN_PASSWORD = 'demo-admin-12345';\n";
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            console.log(`[pythonBridge-smoke] attempt ${attempt}/2…`);
            const raw = await runPythonReview(prompt, diff);
            assert.ok(raw.length > 40, 'expected non-trivial model output');
            const parsed = parseEnforcerResponse(raw);
            assert.ok(parsed.data || parsed.orphanParsedBugs.length > 0, 'expected structured JSON in model output');
            console.log(
                '[pythonBridge-smoke] ok — bugs:',
                parsed.data?.bugs.length ?? parsed.orphanParsedBugs.length,
            );
            return;
        } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            if (/barderrorinfo code 1155/i.test(msg)) {
                console.warn(
                    '[pythonBridge-smoke] Gemini returned BardErrorInfo 1155 (rate limit). Wait 15–30 minutes, then retry the PR.',
                );
            }
            if (attempt < 2) {
                console.warn('[pythonBridge-smoke] retrying after upstream flake…');
                await delayMs(8000);
            }
        }
    }
    throw lastErr;
}

main().catch((err) => {
    console.error('[pythonBridge-smoke] failed:', err);
    process.exit(1);
});
