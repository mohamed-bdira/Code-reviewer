import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
    buildPythonChildEnv,
    computeRetryBackoffMs,
    isBardRateLimitError,
    isForbiddenPythonEnvKey,
    isRetriableUpstreamError,
} from './pythonReview.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pythonExploitPath = path.join(backendRoot, 'scripts', 'pythonExploit.py');
const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

describe('isRetriableUpstreamError', () => {
    it('retries read timeouts from the Python bridge', () => {
        assert.equal(
            isRetriableUpstreamError(
                "HTTPSConnectionPool(host='gemini.google.com', port=443): Read timed out. (read timeout=60)",
            ),
            true,
        );
    });

    it('retries empty parse failures from upstream', () => {
        assert.equal(isRetriableUpstreamError('pythonExploit error: no response parsed from upstream'), true);
    });

    it('retries rate limits and overload responses', () => {
        assert.equal(isRetriableUpstreamError('upstream returned status 429'), true);
        assert.equal(isRetriableUpstreamError('resource_exhausted'), true);
    });

    it('retries BardErrorInfo rate-limit responses', () => {
        assert.equal(isRetriableUpstreamError('upstream returned BardErrorInfo code 1155'), true);
    });

    it('does not retry unrelated failures', () => {
        assert.equal(isRetriableUpstreamError('ENOENT: python3 not found'), false);
    });
});

describe('isBardRateLimitError and computeRetryBackoffMs', () => {
    it('detects BardErrorInfo 1155', () => {
        assert.equal(isBardRateLimitError('upstream returned BardErrorInfo code 1155'), true);
        assert.equal(isBardRateLimitError('upstream returned status 429'), false);
    });

    it('uses longer base delay for Bard 1155 than generic errors', () => {
        const bard = computeRetryBackoffMs(1, 5000, 'upstream returned BardErrorInfo code 1155');
        const generic = computeRetryBackoffMs(1, 5000, 'upstream returned status 502');
        assert.ok(bard >= 15_000);
        assert.ok(generic >= 5000 && generic < 6000);
    });

    it('preserves DEBUG_PYTHON_EXPLOIT in child env', () => {
        const env = buildPythonChildEnv({ DEBUG_PYTHON_EXPLOIT: '1', PATH: '/usr/bin' });
        assert.equal(env.DEBUG_PYTHON_EXPLOIT, '1');
    });
});

describe('buildPythonChildEnv', () => {
    it('strips cookie and Gemini credential env vars', () => {
        const env = buildPythonChildEnv({
            PATH: '/usr/bin',
            GEMINI_API_KEY: 'secret',
            GEMINI_COOKIE: 'sid=abc',
            PYTHON_EXPLOIT_TOKEN: 'tok',
            AI_REVIEW_UPSTREAM_TIMEOUT_SEC: '120',
            HTTP_COOKIE: 'ignored',
        });
        assert.equal(env.PATH, '/usr/bin');
        assert.equal(env.AI_REVIEW_UPSTREAM_TIMEOUT_SEC, '120');
        assert.equal(env.PYTHONIOENCODING, 'utf-8');
        assert.equal(env.GEMINI_API_KEY, undefined);
        assert.equal(env.GEMINI_COOKIE, undefined);
        assert.equal(env.PYTHON_EXPLOIT_TOKEN, undefined);
        assert.equal(env.HTTP_COOKIE, undefined);
    });

    it('flags credential-like env keys', () => {
        assert.equal(isForbiddenPythonEnvKey('GEMINI_API_KEY'), true);
        assert.equal(isForbiddenPythonEnvKey('MY_APP_COOKIE'), true);
        assert.equal(isForbiddenPythonEnvKey('PATH'), false);
        assert.equal(isForbiddenPythonEnvKey('DEBUG_PYTHON_EXPLOIT'), false);
    });
});

describe('pythonExploit credential policy', () => {
    it('does not reference session cookies, bearer tokens, or API keys in the bridge script', () => {
        const source = readFileSync(pythonExploitPath, 'utf8');
        assert.match(source, /NO SESSION COOKIES OR API KEYS/);
        assert.match(source, /assert_no_credential_env/);
        assert.doesNotMatch(source, /["']Cookie["']\s*:/i);
        assert.doesNotMatch(source, /["']Authorization["']\s*:/i);
        assert.doesNotMatch(source, /os\.environ\.get\(["']GEMINI_/);
        assert.doesNotMatch(source, /Bearer\s+/i);
    });

    it('uses cookieless page bootstrap with at and bl query params', () => {
        const source = readFileSync(pythonExploitPath, 'utf8');
        assert.match(source, /fetch_page_bootstrap/);
        assert.match(source, /parse_bootstrap_from_html/);
        assert.match(source, /SNlM0e/);
        assert.match(source, /["']at["']/);
        assert.match(source, /["']bl["']/);
        assert.match(source, /user-agent/);
    });
});

describe('pythonExploit bootstrap parsing', () => {
    it('parses SNlM0e, bl, and sid from sample HTML', () => {
        const sampleHtml = String.raw`
            SNlM0e\":\"test-at-token-xyz\"
            "FdrFJe":"1234567890"
            boq_assistant-bard-web-server_20260101.01_p0
        `;
        const script = `
import sys
sys.path.insert(0, ${JSON.stringify(path.dirname(pythonExploitPath))})
from pythonExploit import parse_bootstrap_from_html
html = ${JSON.stringify(sampleHtml)}
b = parse_bootstrap_from_html(html)
assert b is not None, "bootstrap parse failed"
assert b.at_token == "test-at-token-xyz", b.at_token
assert b.sid == "1234567890", b.sid
assert "boq_assistant-bard-web-server" in b.bl, b.bl
print("ok")
`;
        const result = spawnSync(pythonBin, ['-c', script], {
            cwd: backendRoot,
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /ok/);
    });
});
