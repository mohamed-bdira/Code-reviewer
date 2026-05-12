import mongoose from 'mongoose';
import type { Octokit } from 'octokit';
import {
    buildScoreDimensions,
    evaluateMergeReadiness,
    findingDedupeKey,
    formatEnforcerReviewSummary,
    parseEnforcerResponse,
    type EnforcerPayload,
    type ParsedEnforcerResult,
    type ReviewBugInput,
} from '../enforcer/parseEnforcerResponse.js';
import { upsertPrReviewFindings } from '../findings/upsertPrReviewFindings.js';
import { fetchPrDiffString, PFE_CONCAT_FILE_BOUNDARY } from '../github/fetchPrDiff.js';
import { filterUnifiedDiffForAiReview } from './filterUnifiedDiffForReview.js';
import { bugsToReviewComments, parseDiffHunks, type InlineReviewComment } from '../github/diffHunks.js';
import type { EffectiveRepoConfig } from './effectiveRepoConfig.js';
import {
    buildMinimalGithubRateLimitStub,
    shouldUsePreemptiveSlimGithubPost,
} from './githubPostingStrategy.js';
import { delayMs, runPythonReview } from './pythonReview.js';

/** Max characters of unified diff per AI segment (prompt + subprocess budget). */
const DIFF_MAX_FOR_AI = 10_000;

/** Max lines per segment; exceeded diffs are reviewed in multiple AI passes. */
const DIFF_MAX_LINES_PER_SEGMENT = Math.max(
    50,
    Number(process.env.DIFF_REVIEW_MAX_LINES_PER_SEGMENT ?? 400) || 400,
);

/** Pause between multi-segment AI calls (ms); reduces Gemini/web burst traffic. Default 0. */
function segmentDelayBetweenAiCallsMs(): number {
    const n = Number(process.env.AI_REVIEW_SEGMENT_DELAY_MS ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Cap AI segment passes after filtering. Default 25; set DIFF_REVIEW_MAX_AI_SEGMENTS=0 (or unlimited) to disable. */
function maxAiSegmentsFromEnv(): number {
    const raw = process.env.DIFF_REVIEW_MAX_AI_SEGMENTS?.trim();
    if (raw === undefined || raw === '') return 25;
    const lower = raw.toLowerCase();
    if (raw === '0' || lower === 'unlimited' || lower === 'none') return Number.POSITIVE_INFINITY;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
}

/** GitHub secondary rate limits / abuse heuristics trigger on huge reviews (body + many inline comments). */
const DEFAULT_GITHUB_REVIEW_BODY_MAX_CHARS = 48_000;
const DEFAULT_GITHUB_REVIEW_MAX_INLINE_COMMENTS = 5;
/** Multi-segment runs append huge "### Segment …" prose; cap before assembling the Markdown body. */
const DEFAULT_GITHUB_REVIEW_PROSE_MAX_CHARS = 28_000;
/** Orphan Markdown tables can dominate body size after multi-segment merges. */
const DEFAULT_GITHUB_REVIEW_ORPHAN_ROWS_MAX = 64;
/** When GitHub rejects the full review, regenerate a minimal body (no prose wall, tiny orphan sample). */
const DEFAULT_GITHUB_REVIEW_EMERGENCY_BODY_CHARS = 12_000;
const DEFAULT_GITHUB_REVIEW_SLIM_ORPHAN_ROWS = 8;

function envPositiveInt(name: string, fallback: number): number {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function sleepGithubBackoff(ms: number): Promise<void> {
    const clamped = Math.min(Math.max(0, ms), 3_600_000);
    return new Promise((resolve) => {
        setTimeout(resolve, clamped);
    });
}

function githubErrorText(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    if (typeof err === 'object' && err !== null && 'message' in err) {
        return String((err as { message: unknown }).message);
    }
    return String(err);
}

function isGithubSecondaryOrPrimaryContentLimit(err: unknown): boolean {
    const o = err as { status?: number; response?: { data?: { message?: string } } };
    const msg =
        `${githubErrorText(err)} ${o.response?.data?.message ?? ''}`.toLowerCase();
    if (o.status === 429) {
        return true;
    }
    if (o.status === 403 && (msg.includes('secondary rate limit') || msg.includes('content creation'))) {
        return true;
    }
    return false;
}

function getGithubRetryAfterMs(err: unknown): number | null {
    const o = err as { response?: { headers?: Record<string, unknown> } };
    const h = o.response?.headers;
    if (!h) {
        return null;
    }
    const raw = h['retry-after'] ?? h['Retry-After'];
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
        const sec = Number(raw.trim());
        if (sec > 0) {
            return Math.min(sec * 1000, 3_600_000);
        }
    }
    return null;
}

async function runWithGithubContentRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 4;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (!isGithubSecondaryOrPrimaryContentLimit(e) || attempt >= maxAttempts) {
                throw e;
            }
            const headerMs = getGithubRetryAfterMs(e);
            const o = e as { status?: number };
            let computedFloor = Math.min(60_000 * 2 ** (attempt - 1), 480_000);
            if (o.status === 403) {
                computedFloor = Math.max(computedFloor, 90_000 + 120_000 * (attempt - 1));
            }
            const wait = Math.min(Math.max(headerMs ?? 0, computedFloor), 900_000);
            console.warn(
                `[review] GitHub ${label} rate-limited (attempt ${attempt}/${maxAttempts}); waiting ${wait}ms`,
            );
            await sleepGithubBackoff(wait);
        }
    }
    throw lastErr;
}

function truncateGithubMarkdownBody(body: string, maxChars: number): string {
    if (body.length <= maxChars) {
        return body;
    }
    const budget = Math.max(2000, maxChars - 320);
    let head = body.slice(0, budget);
    const cutSection = head.lastIndexOf('\n### ');
    if (cutSection > budget * 0.35) {
        head = head.slice(0, cutSection);
    } else {
        const cutLine = head.lastIndexOf('\n\n');
        if (cutLine > budget * 0.45) {
            head = head.slice(0, cutLine);
        }
    }
    const omitted = body.length - head.length;
    return `${head.trimEnd()}\n\n---\n\n_…Truncated ~${omitted} characters for GitHub size / rate limits. Remaining findings may still be stored in your dashboard._`;
}

function truncateProseForGithubReview(prose: string, maxChars: number): string {
    if (!prose || prose.length <= maxChars) {
        return prose;
    }
    let head = prose.slice(0, maxChars);
    const cutSeg = head.lastIndexOf('\n### Segment ');
    if (cutSeg > maxChars * 0.2) {
        head = head.slice(0, cutSeg);
    } else {
        const nl = head.lastIndexOf('\n\n');
        if (nl > maxChars * 0.35) {
            head = head.slice(0, nl);
        }
    }
    const omitted = prose.length - head.length;
    return `${head.trimEnd()}\n\n---\n\n_Omitted ~${omitted} characters of segment narrative — raise GITHUB_REVIEW_PROSE_MAX_CHARS if you need more on GitHub._`;
}

function githubReviewBodyOnlyMode(): boolean {
    const v = process.env.GITHUB_REVIEW_BODY_ONLY?.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function inlineCommentToOrphan(ic: InlineReviewComment): ReviewBugInput {
    const start = ic.start_line ?? ic.line;
    const end = ic.line;
    return {
        category: 'review',
        file: ic.path,
        lineStart: start,
        ...(end !== start ? { lineEnd: end } : {}),
        description: `(Not posted inline — review size cap) ${ic.body.replace(/\s+/g, ' ').trim().slice(0, 800)}`,
    };
}

function capInlineReviewComments(
    inline: InlineReviewComment[],
    orphans: ReviewBugInput[],
    maxInline: number,
): { inline: InlineReviewComment[]; orphans: ReviewBugInput[] } {
    if (inline.length <= maxInline) {
        return { inline, orphans };
    }
    const kept = inline.slice(0, maxInline);
    const overflow = inline.slice(maxInline);
    console.warn(
        `[review] Capping inline review comments at ${maxInline}; ${overflow.length} moved to PR body table`,
    );
    return { inline: kept, orphans: [...orphans, ...overflow.map(inlineCommentToOrphan)] };
}

function buildSlimGithubReviewBody(options: {
    enforcementLevel: 'warning' | 'error';
    mergeRecommended: boolean;
    overall: number;
    mergeMinScore: number;
    data: EnforcerPayload | null;
    reasons: string[];
    parseError: string | null;
    orphanSample: ReviewBugInput[];
    findingsRecorded: number | null;
    maxChars: number;
}): string {
    const raw = formatEnforcerReviewSummary({
        enforcementLevel: options.enforcementLevel,
        mergeRecommended: options.mergeRecommended,
        overall: options.overall,
        mergeMinScore: options.mergeMinScore,
        data: options.data,
        prose: '**Automated review (abbreviated)** — GitHub limited this post. Use the PFE dashboard for the full narrative, segment output, and all findings.',
        reasons: options.reasons,
        parseError: options.parseError,
        orphanBugs: options.orphanSample,
        inlineCommentsPosted: 0,
        findingsRecorded: options.findingsRecorded,
    });
    return truncateGithubMarkdownBody(raw, options.maxChars);
}

function splitUnifiedDiffIntoSegments(diff: string, maxLines: number, maxChars: number): string[] {
    if (!diff.trim()) {
        return [];
    }
    const lines = diff.split(/\r?\n/);
    const segments: string[] = [];
    let cur: string[] = [];
    let curChars = 0;

    const flush = (): void => {
        if (cur.length > 0) {
            segments.push(cur.join('\n'));
            cur = [];
            curChars = 0;
        }
    };

    for (const line of lines) {
        const lineCost = line.length + 1;
        const wouldExceedLines = cur.length >= maxLines && cur.length > 0;
        const wouldExceedChars = curChars + lineCost > maxChars && cur.length > 0;
        if (wouldExceedLines || wouldExceedChars) {
            flush();
        }
        cur.push(line);
        curChars += lineCost;
    }
    flush();
    return segments;
}

function dedupeBugs(bugs: ReviewBugInput[], repoFullName: string, prNumber: number): ReviewBugInput[] {
    const seen = new Set<string>();
    const out: ReviewBugInput[] = [];
    for (const b of bugs) {
        const k = findingDedupeKey({
            repoFullName,
            prNumber,
            filePath: b.file,
            ...(b.lineStart !== undefined ? { lineStart: b.lineStart } : {}),
            ...(b.lineEnd !== undefined ? { lineEnd: b.lineEnd } : {}),
            description: b.description,
        });
        if (seen.has(k)) {
            continue;
        }
        seen.add(k);
        out.push(b);
    }
    return out;
}

export type ReviewPullRequestArgs = {
    octokit: Octokit;
    repoOwner: string;
    repoName: string;
    repoFullName: string;
    prNumber: number;
    prTitle: string;
    prDescription: string;
    baseSha?: string;
    headSha?: string;
    effectiveConfig: EffectiveRepoConfig;
    postComment: boolean;
    mongoUri?: string;
    userId?: string;
};

export type ReviewPullRequestResult = {
    effectiveData: EnforcerPayload | null;
    mergeRecommended: boolean;
    overall: number;
    reasons: string[];
    parsed: ParsedEnforcerResult;
    aiReviewText: string;
    findingsRecorded: number | null;
    inlineComments: InlineReviewComment[];
    orphanBugs: ReviewBugInput[];
};

export async function reviewPullRequest(args: ReviewPullRequestArgs): Promise<ReviewPullRequestResult> {
    const {
        octokit,
        repoOwner,
        repoName,
        repoFullName,
        prNumber,
        prTitle,
        prDescription,
        baseSha,
        headSha,
        effectiveConfig,
        postComment,
        mongoUri,
        userId,
    } = args;

    console.log(`Downloading code diffs from Github (${repoFullName}#${prNumber})...`);
    const rawDiff = await fetchPrDiffString(octokit, repoOwner, repoName, prNumber, baseSha, headSha);
    const hasDiff = rawDiff.trim().length > 0;
    if (!hasDiff) {
        console.warn(`No diff content available for PR #${prNumber}; continuing with metadata-only review.`);
    }

    const filterResult = hasDiff ? filterUnifiedDiffForAiReview(rawDiff, process.env) : null;
    let diffForAi = filterResult?.filteredDiff ?? '';
    if (hasDiff && filterResult && filterResult.skippedPaths.length > 0) {
        console.log(
            `[review] Excluded ${filterResult.skippedPaths.length} path(s) from AI diff (lockfiles / DIFF_REVIEW_* filters): ${filterResult.skippedPaths.slice(0, 8).join(', ')}${filterResult.skippedPaths.length > 8 ? '…' : ''}`,
        );
    }
    if (hasDiff && diffForAi.trim().length === 0) {
        console.warn(
            `[review] Filter removed all file hunks; reviewing full PR diff for AI (adjust DIFF_REVIEW_INCLUDE_PATH_PREFIXES / DIFF_REVIEW_EXCLUDE_PATH_CONTAINS).`,
        );
        diffForAi = rawDiff;
    }
    if (hasDiff && filterResult && filterResult.keptPaths.length > 0) {
        console.log(`[review] AI review covers ${filterResult.keptPaths.length} file(s): ${filterResult.keptPaths.slice(0, 12).join(', ')}${filterResult.keptPaths.length > 12 ? '…' : ''}`);
    }

    console.log(`Analyzing PR #${prNumber}: ${prTitle}`);

    const scoreDimensions = buildScoreDimensions(effectiveConfig.focusAreas);
    const dimensionsList = scoreDimensions.join(', ');

    const sharedHeader = `You are a senior software engineer reviewing a pull request.
Repository: ${repoFullName}
PR title: ${prTitle}
PR description: ${prDescription}
Enforcement level: ${effectiveConfig.enforcementLevel}
Focus areas: ${effectiveConfig.focusAreas.join(', ')}
Score sections (for final segment only; keys must be lowercase): ${dimensionsList}
Merge minimum (minimum of section scores must be >= this for a green merge signal): ${effectiveConfig.mergeMinScore}
Use ast-grep signal: ${effectiveConfig.useAstGrep ? 'yes' : 'no'}
Additional repository rules: ${effectiveConfig.customRules}`;

    let segments =
        hasDiff && diffForAi.trim().length > 0
            ? splitUnifiedDiffIntoSegments(diffForAi, DIFF_MAX_LINES_PER_SEGMENT, DIFF_MAX_FOR_AI)
            : [];
    const maxSegments = maxAiSegmentsFromEnv();
    if (hasDiff && Number.isFinite(maxSegments) && segments.length > maxSegments) {
        console.warn(
            `[review] Capping AI segments ${segments.length} → ${maxSegments} (DIFF_REVIEW_MAX_AI_SEGMENTS); remaining diff not sent to the model.`,
        );
        segments = segments.slice(0, maxSegments);
    }

    if (hasDiff && diffForAi.trim().length > 0) {
        const lineCount = diffForAi.split(/\r?\n/).length;
        console.log(
            `[review] AI diff stats: ${lineCount} line(s) → ${segments.length} segment(s); max ${DIFF_MAX_LINES_PER_SEGMENT} lines / ${DIFF_MAX_FOR_AI} chars per chunk`,
        );
    }

    // #region agent log
    if (hasDiff) {
        console.log(
            '[review] diff-debug',
            JSON.stringify({
                sessionId: '748d0a',
                hypothesisId: 'H_concat_boundary',
                rawChars: rawDiff.length,
                diffForAiChars: diffForAi.length,
                hasConcatBoundary: rawDiff.includes(PFE_CONCAT_FILE_BOUNDARY),
                keptFileCount: filterResult?.keptPaths.length ?? 0,
                skippedFileCount: filterResult?.skippedPaths.length ?? 0,
                segmentCount: segments.length,
                prNumber,
            }),
        );
    }
    // #endregion

    let aiReviewText: string;
    let parsed: ParsedEnforcerResult;

    if (!hasDiff) {
        const prompt = `${sharedHeader}
Diff status: missing

Provide a detailed, actionable review (architecture, edge cases, security, tone professional). The code diff was not available — review from title/description and general best practices only.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): ${dimensionsList.split(', ').map((s) => `"${s}"`).join(', ')}. Each value is an integer from 0 to 100.
- "notes": object with the same keys as "scores"; each value is one short line explaining that score.
- "blockers": array of strings listing critical issues that must be fixed before merge; use [] if none.
- "bugs": array of objects for concrete issues to store (use [] if none). Each object: "category" (e.g. security, bug, style, usability), "file" (repo-relative path), "lineStart" and "lineEnd" (1-based line numbers if applicable), "description" (short text).

Do not put any text after the closing \`\`\` of that JSON block.

BEGIN_DIFF
[No diff content returned by GitHub API]
END_DIFF`;
        console.log('Generating review with AI (no diff)...');
        aiReviewText = await runPythonReview(prompt, '');
        parsed = parseEnforcerResponse(aiReviewText);
    } else if (segments.length === 1) {
        const diffString = segments[0] ?? '';
        const prompt = `${sharedHeader}
Diff status: single segment (${diffString.split(/\r?\n/).length} lines)

Provide a detailed, actionable review (architecture, edge cases, security, tone professional). Prioritize findings from the code diff. Do NOT quote the diff back at me — your output is rendered next to the diff in GitHub's PR view.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): ${dimensionsList.split(', ').map((s) => `"${s}"`).join(', ')}. Each value is an integer from 0 to 100.
- "notes": object with the same keys as "scores"; each value is one short line explaining that score.
- "blockers": array of strings listing critical issues that must be fixed before merge; use [] if none.
- "bugs": array of objects for concrete issues to store (use [] if none). Each object: "category" (e.g. security, bug, style, usability), "file" (repo-relative path matching the diff's b/<path>), "lineStart" and "lineEnd" (1-based line numbers, REQUIRED for inline rendering on the PR diff — pick lines that actually appear in the supplied diff hunks on the new revision side; multi-line spans use lineEnd > lineStart, single-line uses lineStart === lineEnd or omit lineEnd), "description" (short text). Bugs without anchorable lines will be downgraded to a footnote.

Do not put any text after the closing \`\`\` of that JSON block.

BEGIN_DIFF
${diffString}
END_DIFF`;
        console.log('Generating review with AI (single diff segment)...');
        aiReviewText = await runPythonReview(prompt, diffString);
        parsed = parseEnforcerResponse(aiReviewText);
    } else {
        console.log(
            `Diff split into ${segments.length} segments (max ${DIFF_MAX_LINES_PER_SEGMENT} lines / ${DIFF_MAX_FOR_AI} chars each); running AI per segment...`,
        );
        const segmentOutputs: string[] = [];
        const mergedBugs: ReviewBugInput[] = [];
        let lastStructured: ParsedEnforcerResult | null = null;

        for (let i = 0; i < segments.length; i++) {
            const chunk = segments[i] ?? '';
            const k = i + 1;
            const isLast = i === segments.length - 1;
            const lineCount = chunk.split(/\r?\n/).length;

            let prompt: string;
            if (isLast) {
                prompt = `${sharedHeader}
Diff status: **Final segment ${k}/${segments.length}** (${lineCount} lines). Earlier segments were reviewed separately; scores must reflect the **whole PR** using evidence from this segment and the context above (title, description, rules).

Provide a detailed, actionable review focused on **this** diff fragment. Prioritize findings visible here. Do NOT quote the diff back verbatim.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): ${dimensionsList.split(', ').map((s) => `"${s}"`).join(', ')}. Each value is an integer from 0 to 100.
- "notes": object with the same keys as "scores"; each value is one short line explaining that score.
- "blockers": array of strings listing critical issues that must be fixed before merge; use [] if none.
- "bugs": array of objects for concrete issues **in this segment only**: "category", "file" (repo-relative, matching b/<path> in this diff), "lineStart", "lineEnd", "description".

Do not put any text after the closing \`\`\` of that JSON block.

BEGIN_DIFF
${chunk}
END_DIFF`;
            } else {
                prompt = `${sharedHeader}
Diff status: **Segment ${k}/${segments.length}** (${lineCount} lines); this is a **partial** unified diff, not the full PR.

Analyze **only** issues evidenced in the fragment below. Do NOT invent findings for files/lines not shown here.

Provide a concise narrative, then **exactly one** fenced \`\`\`json code block containing **only** this object shape (no scores, notes, or blockers):
{"bugs":[...]}
Each bug: "category", "file", "lineStart", "lineEnd" (optional), "description". Use line numbers as they appear in this fragment's @@ hunks (new-file side).

BEGIN_DIFF
${chunk}
END_DIFF`;
            }

            console.log(`Generating review segment ${k}/${segments.length}...`);
            const segmentText = await runPythonReview(prompt, chunk);
            const pauseMs = segmentDelayBetweenAiCallsMs();
            if (pauseMs > 0 && !isLast) {
                await delayMs(pauseMs);
            }
            segmentOutputs.push(`### Segment ${k}/${segments.length}\n\n${segmentText.trim()}`);
            const segParsed = parseEnforcerResponse(segmentText);
            if (isLast) {
                lastStructured = segParsed;
            }
            const segBugs = segParsed.data?.bugs ?? segParsed.orphanParsedBugs ?? [];
            mergedBugs.push(...segBugs);
        }

        aiReviewText = segmentOutputs.join('\n\n---\n\n');
        if (!lastStructured) {
            parsed = {
                data: null,
                prose: aiReviewText,
                parseError: 'No structured output from final segment.',
                orphanParsedBugs: dedupeBugs(mergedBugs, repoFullName, prNumber),
            };
        } else {
            const bugsCombined = dedupeBugs(mergedBugs, repoFullName, prNumber);
            let data: EnforcerPayload | null = lastStructured.data;
            let parseError = lastStructured.parseError;
            if (lastStructured.data) {
                data = {
                    ...lastStructured.data,
                    bugs: bugsCombined,
                };
                const scored = data;
                const missingDims = scoreDimensions.filter((d) => !(d in scored.scores));
                if (missingDims.length > 0) {
                    data = null;
                    parseError = `Missing scores for sections: ${missingDims.join(', ')}`;
                }
            } else {
                parseError =
                    lastStructured.parseError ??
                    (bugsCombined.length > 0
                        ? 'Structured scores missing or invalid; bugs merged from all segments.'
                        : 'Structured output missing.');
            }
            parsed = {
                data,
                prose: [lastStructured.prose, segmentOutputs.slice(0, -1).join('\n\n')].filter(Boolean).join('\n\n'),
                parseError,
                orphanParsedBugs: data ? [] : bugsCombined,
            };
        }
    }

    const structuredData = parsed.data;
    let effectiveData = structuredData;
    let parseError = parsed.parseError;
    if (effectiveData) {
        const scored = effectiveData;
        const missingDims = scoreDimensions.filter((d) => !(d in scored.scores));
        if (missingDims.length > 0) {
            effectiveData = null;
            parseError = `Missing scores for sections: ${missingDims.join(', ')}`;
        }
    }

    /** Bugs are persisted whenever the model lists them in JSON, even if scores failed validation. */
    const bugsFromAi = dedupeBugs(
        [...(parsed.data?.bugs ?? []), ...parsed.orphanParsedBugs],
        repoFullName,
        prNumber,
    );

    let mergeRecommended = false;
    let overall = 0;
    const reasons: string[] = [];

    if (effectiveData) {
        const ev = evaluateMergeReadiness(effectiveData, effectiveConfig.mergeMinScore);
        mergeRecommended = ev.mergeRecommended;
        overall = ev.overall;
        reasons.push(...ev.reasons);
    } else {
        reasons.push(...(parseError ? [parseError] : ['Structured output missing.']));
    }

    let findingsRecorded: number | null = null;
    if (bugsFromAi.length > 0 && mongoUri && mongoose.connection.readyState === 1) {
        try {
            await upsertPrReviewFindings(repoFullName, prNumber, bugsFromAi, userId);
            findingsRecorded = bugsFromAi.length;
        } catch (err) {
            console.error('PrReviewFinding persist error:', err);
            findingsRecorded = null;
        }
    }

    const hunks = parseDiffHunks(rawDiff);
    let { inline: inlineComments, orphans: orphanBugs } = bugsToReviewComments(bugsFromAi, hunks);
    if (inlineComments.length > 0 && !headSha) {
        console.warn(
            `[review] PR #${prNumber}: skipping ${inlineComments.length} inline comment(s) (missing head SHA); listing in review body instead`,
        );
        inlineComments = [];
        orphanBugs = bugsFromAi;
    }

    const inlineCap = envPositiveInt('GITHUB_REVIEW_MAX_INLINE_COMMENTS', DEFAULT_GITHUB_REVIEW_MAX_INLINE_COMMENTS);
    const cappedInline = capInlineReviewComments(inlineComments, orphanBugs, inlineCap);
    inlineComments = cappedInline.inline;
    orphanBugs = cappedInline.orphans;

    if (githubReviewBodyOnlyMode()) {
        if (inlineComments.length > 0) {
            console.warn(
                `[review] GITHUB_REVIEW_BODY_ONLY: merging ${inlineComments.length} inline comment(s) into PR body only`,
            );
            orphanBugs = [...orphanBugs, ...inlineComments.map(inlineCommentToOrphan)];
            inlineComments = [];
        }
    }

    const proseSource = parsed.prose || aiReviewText.trim();
    const proseCap = envPositiveInt(
        'GITHUB_REVIEW_PROSE_MAX_CHARS',
        DEFAULT_GITHUB_REVIEW_PROSE_MAX_CHARS,
    );
    const proseForGithub = truncateProseForGithubReview(proseSource, proseCap);

    const orphanRowCap = envPositiveInt(
        'GITHUB_REVIEW_ORPHAN_ROWS_MAX',
        DEFAULT_GITHUB_REVIEW_ORPHAN_ROWS_MAX,
    );
    let orphansForGithubBody = orphanBugs;
    let orphanRowsOmitted = 0;
    if (orphanBugs.length > orphanRowCap) {
        orphanRowsOmitted = orphanBugs.length - orphanRowCap;
        orphansForGithubBody = orphanBugs.slice(0, orphanRowCap);
        console.warn(
            `[review] Orphan findings table capped at ${orphanRowCap} rows for GitHub; ${orphanRowsOmitted} not shown`,
        );
    }

    let body = formatEnforcerReviewSummary({
        enforcementLevel: effectiveConfig.enforcementLevel,
        mergeRecommended: Boolean(effectiveData && mergeRecommended),
        overall,
        mergeMinScore: effectiveConfig.mergeMinScore,
        data: effectiveData,
        prose: proseForGithub,
        reasons,
        parseError,
        orphanBugs: orphansForGithubBody,
        inlineCommentsPosted: inlineComments.length,
        findingsRecorded,
    });

    const bodyMaxChars = envPositiveInt(
        'GITHUB_REVIEW_BODY_MAX_CHARS',
        DEFAULT_GITHUB_REVIEW_BODY_MAX_CHARS,
    );
    if (orphanRowsOmitted > 0) {
        body = `${body}\n\n_${orphanRowsOmitted} orphan row(s) omitted (GITHUB_REVIEW_ORPHAN_ROWS_MAX=${orphanRowCap}); full list in dashboard._`;
    }
    body = truncateGithubMarkdownBody(body, bodyMaxChars);

    if (postComment) {
        const emergencyChars = envPositiveInt(
            'GITHUB_REVIEW_EMERGENCY_BODY_CHARS',
            DEFAULT_GITHUB_REVIEW_EMERGENCY_BODY_CHARS,
        );
        const slimOrphanRows = envPositiveInt(
            'GITHUB_REVIEW_SLIM_ORPHAN_ROWS',
            DEFAULT_GITHUB_REVIEW_SLIM_ORPHAN_ROWS,
        );

        const postPullsReview = (reviewBody: string, comments?: InlineReviewComment[]) =>
            runWithGithubContentRetry('pulls.createReview', () =>
                octokit.rest.pulls.createReview({
                    owner: repoOwner,
                    repo: repoName,
                    pull_number: prNumber,
                    event: 'COMMENT',
                    body: reviewBody,
                    ...(headSha ? { commit_id: headSha } : {}),
                    ...(comments && comments.length > 0 ? { comments } : {}),
                }),
            );

        let postBody = body;
        let postComments: InlineReviewComment[] | undefined =
            inlineComments.length > 0 ? inlineComments : undefined;

        if (shouldUsePreemptiveSlimGithubPost(body, inlineComments, process.env)) {
            console.warn(
                `[review] Preemptive slim GitHub post (body=${body.length} chars, inline=${inlineComments.length}); expand via dashboard or set GITHUB_REVIEW_PREEMPTIVE_SLIM=false`,
            );
            postBody = buildSlimGithubReviewBody({
                enforcementLevel: effectiveConfig.enforcementLevel,
                mergeRecommended: Boolean(effectiveData && mergeRecommended),
                overall,
                mergeMinScore: effectiveConfig.mergeMinScore,
                data: effectiveData,
                reasons,
                parseError,
                orphanSample: orphansForGithubBody.slice(0, slimOrphanRows),
                findingsRecorded,
                maxChars: emergencyChars,
            });
            postComments = undefined;
        }

        let postedToGithub = false;
        try {
            await postPullsReview(postBody, postComments);
            postedToGithub = true;
            console.log(
                `Review posted to GitHub (${postComments?.length ?? 0} inline, ${orphanBugs.length} orphan).`,
            );
        } catch (err) {
            console.error('pulls.createReview failed:', err);
            let fallbackCommentBody = truncateGithubMarkdownBody(body, emergencyChars);
            const rateLimited = isGithubSecondaryOrPrimaryContentLimit(err);

            if (rateLimited) {
                fallbackCommentBody = buildSlimGithubReviewBody({
                    enforcementLevel: effectiveConfig.enforcementLevel,
                    mergeRecommended: Boolean(effectiveData && mergeRecommended),
                    overall,
                    mergeMinScore: effectiveConfig.mergeMinScore,
                    data: effectiveData,
                    reasons,
                    parseError,
                    orphanSample: orphansForGithubBody.slice(0, slimOrphanRows),
                    findingsRecorded,
                    maxChars: emergencyChars,
                });
                try {
                    console.warn(
                        '[review] Retrying pulls.createReview with slim body and no inline (secondary rate limit recovery)',
                    );
                    await postPullsReview(fallbackCommentBody, undefined);
                    postedToGithub = true;
                    console.log('Review posted to GitHub (slim recovery, 0 inline).');
                } catch (err2) {
                    console.error('Slim pulls.createReview failed:', err2);
                }
            }

            if (!postedToGithub) {
                try {
                    await runWithGithubContentRetry('issues.createComment', () =>
                        octokit.rest.issues.createComment({
                            owner: repoOwner,
                            repo: repoName,
                            issue_number: prNumber,
                            body: fallbackCommentBody,
                        }),
                    );
                    console.log('Review posted as issue comment (fallback).');
                } catch (err3) {
                    console.error('issues.createComment failed:', err3);
                    try {
                        const stub = buildMinimalGithubRateLimitStub(repoFullName, prNumber);
                        await runWithGithubContentRetry('issues.createComment.stub', () =>
                            octokit.rest.issues.createComment({
                                owner: repoOwner,
                                repo: repoName,
                                issue_number: prNumber,
                                body: stub,
                            }),
                        );
                        console.warn('[review] Posted minimal stub comment after repeated GitHub failures.');
                    } catch (err4) {
                        console.error('Minimal stub issues.createComment failed:', err4);
                    }
                }
            }
        }
    }

    return {
        effectiveData,
        mergeRecommended: Boolean(effectiveData && mergeRecommended),
        overall,
        reasons,
        parsed,
        aiReviewText,
        findingsRecorded,
        inlineComments,
        orphanBugs,
    };
}
