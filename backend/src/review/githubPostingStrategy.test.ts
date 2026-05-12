import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InlineReviewComment } from '../github/diffHunks.js';
import {
    buildMinimalGithubRateLimitStub,
    estimateCreateReviewPayloadChars,
    shouldUsePreemptiveSlimGithubPost,
} from './githubPostingStrategy.js';

describe('estimateCreateReviewPayloadChars', () => {
    it('sums body and JSON comments length', () => {
        const comments: InlineReviewComment[] = [
            { path: 'a.ts', body: 'hi', side: 'RIGHT', line: 1 },
        ];
        const body = 'hello';
        const est = estimateCreateReviewPayloadChars(body, comments);
        assert.ok(est > body.length + 10);
        assert.ok(est < body.length + 500);
    });

    it('empty comments yields body + tiny bracket overhead', () => {
        assert.equal(estimateCreateReviewPayloadChars('abc', []), 5);
    });
});

describe('shouldUsePreemptiveSlimGithubPost', () => {
    const mini = (): InlineReviewComment[] => [];

    it('respects GITHUB_REVIEW_PREEMPTIVE_SLIM=false', () => {
        assert.equal(
            shouldUsePreemptiveSlimGithubPost('x'.repeat(100_000), mini(), {
                GITHUB_REVIEW_PREEMPTIVE_SLIM: 'false',
            }),
            false,
        );
    });

    it('respects GITHUB_REVIEW_PREEMPTIVE_SLIM=true', () => {
        assert.equal(
            shouldUsePreemptiveSlimGithubPost('short', mini(), {
                GITHUB_REVIEW_PREEMPTIVE_SLIM: 'true',
            }),
            true,
        );
    });

    it('triggers when body exceeds default max', () => {
        assert.equal(
            shouldUsePreemptiveSlimGithubPost('x'.repeat(19_000), mini(), {}),
            true,
        );
    });

    it('triggers when inline count exceeds default max', () => {
        const six: InlineReviewComment[] = Array.from({ length: 6 }, (_, i) => ({
            path: `f${i}.ts`,
            body: 'n',
            side: 'RIGHT' as const,
            line: i + 1,
        }));
        assert.equal(shouldUsePreemptiveSlimGithubPost('small', six, {}), true);
    });

    it('does not trigger for small single-inline review', () => {
        const one: InlineReviewComment[] = [
            { path: 'a.ts', body: 'fix', side: 'RIGHT', line: 2 },
        ];
        assert.equal(
            shouldUsePreemptiveSlimGithubPost('Summary only.', one, {}),
            false,
        );
    });

    it('triggers when JSON payload estimate exceeds default max', () => {
        const fat: InlineReviewComment[] = Array.from({ length: 5 }, (_, i) => ({
            path: `f${i}.ts`,
            body: 'x'.repeat(9_000),
            side: 'RIGHT' as const,
            line: i + 1,
        }));
        assert.equal(shouldUsePreemptiveSlimGithubPost('tiny', fat, {}), true);
    });
});

describe('buildMinimalGithubRateLimitStub', () => {
    it('includes repo and PR number', () => {
        const s = buildMinimalGithubRateLimitStub('org/repo', 42);
        assert.match(s, /org\/repo/);
        assert.match(s, /#42/);
    });
});
