/**
 * GitHub REST secondary rate limits hit oversized PR review POSTs (body + comments[] JSON).
 * These helpers decide when to send a slim payload before making any network call.
 */

import type { InlineReviewComment } from '../github/diffHunks.js';

/** Rough UTF-8 byte count for JSON payload alongside body text (Octokit serializes comments array). */
export function estimateCreateReviewPayloadChars(body: string, comments: readonly InlineReviewComment[]): number {
    let commentsJsonLen = 2;
    try {
        commentsJsonLen = comments.length === 0 ? 2 : JSON.stringify(comments).length;
    } catch {
        commentsJsonLen = comments.reduce((acc, c) => acc + (c.body?.length ?? 0) + (c.path?.length ?? 0) + 80, 2);
    }
    return body.length + commentsJsonLen;
}

function envPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
    const n = Number(env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * When true, POST only the abbreviated markdown review (no inline comments array).
 * Conservative defaults avoid triggering GitHub "secondary rate limit / content creation" 403s.
 */
export function shouldUsePreemptiveSlimGithubPost(
    body: string,
    comments: readonly InlineReviewComment[],
    env: NodeJS.ProcessEnv,
): boolean {
    const raw = env.GITHUB_REVIEW_PREEMPTIVE_SLIM?.trim();
    if (raw) {
        const l = raw.toLowerCase();
        if (l === '0' || l === 'false' || l === 'no') {
            return false;
        }
        if (l === '1' || l === 'true' || l === 'yes') {
            return true;
        }
    }

    const maxBody = envPositiveInt(env, 'GITHUB_REVIEW_PREEMPTIVE_BODY_BYTES', 18_000);
    const maxInline = envPositiveInt(env, 'GITHUB_REVIEW_PREEMPTIVE_INLINE_MAX', 5);
    const maxPayload = envPositiveInt(env, 'GITHUB_REVIEW_PREEMPTIVE_PAYLOAD_BYTES', 42_000);

    const estimated = estimateCreateReviewPayloadChars(body, comments);

    if (body.length > maxBody) {
        return true;
    }
    if (comments.length > maxInline) {
        return true;
    }
    if (estimated > maxPayload) {
        return true;
    }
    return false;
}

export function buildMinimalGithubRateLimitStub(repoFullName: string, prNumber: number): string {
    return [
        '## PFE automated review',
        '',
        'GitHub blocked posting the full review (secondary rate limit / oversized payload).',
        '',
        `- **Repository:** ${repoFullName}`,
        `- **PR:** #${prNumber}`,
        '',
        'Open the **PFE dashboard** for the complete scores, narrative, segment reviews, and findings.',
    ].join('\n');
}
