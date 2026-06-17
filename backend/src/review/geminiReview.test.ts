import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildReviewPrompt,
    computeRetryBackoffMs,
    isGeminiApiKeyConfigured,
    isRetriableUpstreamError,
} from './geminiReview.js';

describe('buildReviewPrompt', () => {
    it('merges prompt and diff with BEGIN_DIFF markers', () => {
        const out = buildReviewPrompt('Review this.', '+++ b/foo.ts');
        assert.match(out, /Review this\./);
        assert.match(out, /BEGIN_DIFF/);
        assert.match(out, /\+\+\+ b\/foo\.ts/);
        assert.match(out, /END_DIFF/);
    });

    it('returns prompt only when diff is empty', () => {
        assert.equal(buildReviewPrompt('Hello', ''), 'Hello');
        assert.equal(buildReviewPrompt('Hello', '   '), 'Hello');
    });
});

describe('isRetriableUpstreamError', () => {
    it('retries rate limits and overload responses', () => {
        assert.equal(isRetriableUpstreamError('upstream returned status 429'), true);
        assert.equal(isRetriableUpstreamError('resource_exhausted'), true);
        assert.equal(isRetriableUpstreamError('503 Service Unavailable'), true);
    });

    it('retries timeouts', () => {
        assert.equal(isRetriableUpstreamError('gemini review timed out after 120000ms'), true);
    });

    it('does not retry unrelated failures', () => {
        assert.equal(isRetriableUpstreamError('GEMINI_API_KEY is not set'), false);
        assert.equal(isRetriableUpstreamError('invalid api key'), false);
    });
});

describe('computeRetryBackoffMs', () => {
    it('uses exponential backoff with jitter floor', () => {
        const first = computeRetryBackoffMs(1, 5000);
        assert.ok(first >= 5000 && first < 5500);
        const second = computeRetryBackoffMs(2, 5000);
        assert.ok(second >= 10_000 && second < 10_500);
    });
});

describe('isGeminiApiKeyConfigured', () => {
    it('detects configured API key', () => {
        assert.equal(isGeminiApiKeyConfigured({ GEMINI_API_KEY: 'abc' }), true);
        assert.equal(isGeminiApiKeyConfigured({ GEMINI_API_KEY: '  ' }), false);
        assert.equal(isGeminiApiKeyConfigured({}), false);
    });
});
