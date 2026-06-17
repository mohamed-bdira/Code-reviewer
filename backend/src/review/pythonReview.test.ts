import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { buildPythonChildEnv, isForbiddenPythonEnvKey, isRetriableUpstreamError } from './pythonReview.js';

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
    it('does not reference cookies, bearer tokens, or API keys in the bridge script', () => {
        const scriptPath = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '..',
            '..',
            'scripts',
            'pythonExploit.py',
        );
        const source = readFileSync(scriptPath, 'utf8');
        assert.match(source, /NO COOKIES OR API TOKENS/);
        assert.match(source, /assert_no_credential_env/);
        assert.doesNotMatch(source, /["']Cookie["']\s*:/i);
        assert.doesNotMatch(source, /["']Authorization["']\s*:/i);
        assert.doesNotMatch(source, /os\.environ\.get\(["']GEMINI_/);
        assert.doesNotMatch(source, /Bearer\s+/i);
    });
});
