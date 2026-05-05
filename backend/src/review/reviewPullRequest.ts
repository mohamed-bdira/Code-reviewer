import mongoose from 'mongoose';
import type { Octokit } from 'octokit';
import {
    buildScoreDimensions,
    evaluateMergeReadiness,
    formatEnforcerGithubBody,
    parseEnforcerResponse,
    type EnforcerPayload,
    type ParsedEnforcerResult,
} from '../enforcer/parseEnforcerResponse.js';
import { upsertPrReviewFindings } from '../findings/upsertPrReviewFindings.js';
import { fetchPrDiffString } from '../github/fetchPrDiff.js';
import type { EffectiveRepoConfig } from './effectiveRepoConfig.js';
import { runPythonReview } from './pythonReview.js';

const DIFF_MAX_FOR_AI = 10_000;
const DIFF_MAX_FOR_COMMENT = 8_000;

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
};

export type ReviewPullRequestResult = {
    effectiveData: EnforcerPayload | null;
    mergeRecommended: boolean;
    overall: number;
    reasons: string[];
    parsed: ParsedEnforcerResult;
    aiReviewText: string;
    findingsRecorded: number | null;
    diffForComment: string;
    diffCommentTruncated: boolean;
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
    } = args;

    console.log(`Downloading code diffs from Github (${repoFullName}#${prNumber})...`);
    const rawDiff = await fetchPrDiffString(octokit, repoOwner, repoName, prNumber, baseSha, headSha);
    const diffString = rawDiff.slice(0, DIFF_MAX_FOR_AI);
    const hasDiff = diffString.length > 0;
    if (!hasDiff) {
        console.warn(`No diff content available for PR #${prNumber}; continuing with metadata-only review.`);
    }

    const diffForComment = rawDiff.slice(0, DIFF_MAX_FOR_COMMENT);
    const diffCommentTruncated = rawDiff.length > DIFF_MAX_FOR_COMMENT;
    console.log(`Analyzing PR #${prNumber}: ${prTitle}`);

    const scoreDimensions = buildScoreDimensions(effectiveConfig.focusAreas);
    const dimensionsList = scoreDimensions.join(', ');

    const prompt = `You are a senior software engineer reviewing a pull request.
Repository: ${repoFullName}
PR title: ${prTitle}
PR description: ${prDescription}
Enforcement level: ${effectiveConfig.enforcementLevel}
Focus areas: ${effectiveConfig.focusAreas.join(', ')}
Score sections (you MUST score each): ${dimensionsList}
Merge minimum (minimum of section scores must be >= this for a green merge signal): ${effectiveConfig.mergeMinScore}
Use ast-grep signal: ${effectiveConfig.useAstGrep ? 'yes' : 'no'}
Additional repository rules: ${effectiveConfig.customRules}
Diff status: ${hasDiff ? 'available (truncated to 10k chars if needed)' : 'missing'}

Provide a detailed, actionable review (architecture, edge cases, security, tone professional). Prioritize findings from the code diff.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): ${dimensionsList.split(', ').map((s) => `"${s}"`).join(', ')}. Each value is an integer from 0 to 100.
- "notes": object with the same keys as "scores"; each value is one short line explaining that score.
- "blockers": array of strings listing critical issues that must be fixed before merge; use [] if none.
- "bugs": array of objects for concrete issues to store (use [] if none). Each object: "category" (e.g. security, bug, style, usability), "file" (repo-relative path), optional "lineStart" and "lineEnd" (1-based line numbers if known), "description" (short text).

Do not put any text after the closing \`\`\` of that JSON block.

BEGIN_DIFF
${hasDiff ? diffString : '[No diff content returned by GitHub API]'}
END_DIFF`;

    console.log('Generating review with AI...');
    const aiReviewText = await runPythonReview(prompt, diffString);

    const parsed = parseEnforcerResponse(aiReviewText);
    let effectiveData = parsed.data;
    let parseError = parsed.parseError;
    if (effectiveData) {
        const scored = effectiveData;
        const missingDims = scoreDimensions.filter((d) => !(d in scored.scores));
        if (missingDims.length > 0) {
            effectiveData = null;
            parseError = `Missing scores for sections: ${missingDims.join(', ')}`;
        }
    }

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
    if (effectiveData && mongoUri && mongoose.connection.readyState === 1) {
        try {
            if (effectiveData.bugs.length > 0) {
                await upsertPrReviewFindings(repoFullName, prNumber, effectiveData.bugs);
            }
            findingsRecorded = effectiveData.bugs.length;
        } catch (err) {
            console.error('PrReviewFinding persist error:', err);
            findingsRecorded = null;
        }
    }

    const commentBody = formatEnforcerGithubBody({
        enforcementLevel: effectiveConfig.enforcementLevel,
        mergeRecommended: Boolean(effectiveData && mergeRecommended),
        overall,
        mergeMinScore: effectiveConfig.mergeMinScore,
        data: effectiveData,
        prose: parsed.prose || aiReviewText.trim(),
        reasons,
        parseError,
        diffFencedBody: diffForComment,
        diffWasTruncated: diffCommentTruncated,
        findingsRecorded,
    });

    if (postComment) {
        await octokit.rest.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: prNumber,
            body: commentBody,
        });
        console.log('Review posted to GitHub.');
    }

    return {
        effectiveData,
        mergeRecommended: Boolean(effectiveData && mergeRecommended),
        overall,
        reasons,
        parsed,
        aiReviewText,
        findingsRecorded,
        diffForComment,
        diffCommentTruncated,
    };
}
