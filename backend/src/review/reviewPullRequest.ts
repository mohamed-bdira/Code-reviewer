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
import { fetchPrDiffString } from '../github/fetchPrDiff.js';
import { bugsToReviewComments, parseDiffHunks, type InlineReviewComment } from '../github/diffHunks.js';
import type { EffectiveRepoConfig } from './effectiveRepoConfig.js';
import { runPythonReview } from './pythonReview.js';

/** Max characters of unified diff per AI segment (prompt + subprocess budget). */
const DIFF_MAX_FOR_AI = 10_000;

/** Max lines per segment; exceeded diffs are reviewed in multiple AI passes. */
const DIFF_MAX_LINES_PER_SEGMENT = Math.max(
    50,
    Number(process.env.DIFF_REVIEW_MAX_LINES_PER_SEGMENT ?? 400) || 400,
);

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

    const segments = hasDiff
        ? splitUnifiedDiffIntoSegments(rawDiff, DIFF_MAX_LINES_PER_SEGMENT, DIFF_MAX_FOR_AI)
        : [];

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

    const body = formatEnforcerReviewSummary({
        enforcementLevel: effectiveConfig.enforcementLevel,
        mergeRecommended: Boolean(effectiveData && mergeRecommended),
        overall,
        mergeMinScore: effectiveConfig.mergeMinScore,
        data: effectiveData,
        prose: parsed.prose || aiReviewText.trim(),
        reasons,
        parseError,
        orphanBugs,
        inlineCommentsPosted: inlineComments.length,
        findingsRecorded,
    });

    if (postComment) {
        try {
            const reviewPayload: Parameters<typeof octokit.rest.pulls.createReview>[0] = {
                owner: repoOwner,
                repo: repoName,
                pull_number: prNumber,
                event: 'COMMENT',
                body,
                ...(headSha ? { commit_id: headSha } : {}),
                ...(inlineComments.length > 0 ? { comments: inlineComments } : {}),
            };
            await octokit.rest.pulls.createReview(reviewPayload);
            console.log(
                `Review posted to GitHub (${inlineComments.length} inline, ${orphanBugs.length} orphan).`,
            );
        } catch (err) {
            console.error('pulls.createReview failed; falling back to issue comment:', err);
            await octokit.rest.issues.createComment({
                owner: repoOwner,
                repo: repoName,
                issue_number: prNumber,
                body,
            });
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
