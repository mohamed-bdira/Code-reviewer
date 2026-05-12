/**
 * PR unified diffs only contain **changed** files — not the whole repo.
 * Segment explosions usually come from huge generated/lock files; filter those for AI review.
 */

import { PFE_CONCAT_FILE_BOUNDARY } from '../github/fetchPrDiff.js';

/**
 * Split into per-file hunks.
 * Standard Git unified diffs use `diff --git`; fallbacks from `pulls.listFiles` / `compareCommits`
 * (`fetchPrDiff.ts`) join patches as `--- a/path` without `diff --git` — must split on `--- a/` too
 * or the whole PR becomes one block and filtering keeps only the first path while all bytes remain.
 */
function splitUnifiedDiffIntoFileBlocks(diff: string): string[] {
    const trimmed = diff.trim();
    if (!trimmed) {
        return [];
    }
    if (trimmed.includes(PFE_CONCAT_FILE_BOUNDARY)) {
        return trimmed
            .split(PFE_CONCAT_FILE_BOUNDARY)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }
    const lines = trimmed.split(/\r?\n/);
    const blocks: string[][] = [];
    let cur: string[] = [];

    const flush = (): void => {
        if (cur.length > 0) {
            blocks.push(cur);
            cur = [];
        }
    };

    /**
     * `fetchPrDiff` concat format always starts with `--- a/<path>` (no outer `diff --git`).
     * GitHub's per-file `patch` often *includes* inner `diff --git` lines — if we split only on
     * those, one logical file breaks into multiple blocks. Prefer outer `--- a/` boundaries first.
     */
    const outerPatchFormat = trimmed.startsWith('--- a/');

    const splitOnOuterPatchHeaders = (): void => {
        for (const line of lines) {
            if (line.startsWith('--- a/') && cur.length > 0) {
                flush();
                cur = [line];
            } else {
                cur.push(line);
            }
        }
        flush();
    };

    if (outerPatchFormat) {
        splitOnOuterPatchHeaders();
    } else {
        const hasGitHeaders = lines.some((l) => l.startsWith('diff --git '));
        if (hasGitHeaders) {
            for (const line of lines) {
                if (line.startsWith('diff --git ') && cur.length > 0) {
                    flush();
                    cur = [line];
                } else {
                    cur.push(line);
                }
            }
            flush();
        } else {
            splitOnOuterPatchHeaders();
        }
    }

    return blocks.map((b) => b.join('\n'));
}

/** Repo-relative path on the new side (HEAD), or null for binary/delete-only edge cases. */
export function extractNewPathFromDiffBlock(block: string): string | null {
    for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('+++ ')) {
            const after = line.slice(4).trim();
            if (after === '/dev/null') {
                return null;
            }
            return after.startsWith('b/') ? after.slice(2) : after;
        }
    }
    return null;
}

function parseCommaList(envVal: string | undefined): string[] {
    if (!envVal?.trim()) {
        return [];
    }
    return envVal
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function defaultExcludeSubstrings(): string[] {
    return [
        'package-lock.json',
        'npm-shrinkwrap.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'Cargo.lock',
        'Podfile.lock',
        'composer.lock',
        'Gemfile.lock',
        'poetry.lock',
        'uv.lock',
    ];
}

export type FilterUnifiedDiffResult = {
    filteredDiff: string;
    skippedPaths: string[];
    keptPaths: string[];
};

/**
 * Drops whole-file hunks whose paths match exclude rules or fail include-prefix rules.
 */
export function filterUnifiedDiffForAiReview(diff: string, env: NodeJS.ProcessEnv): FilterUnifiedDiffResult {
    const skipEnvFalse = env.DIFF_REVIEW_SKIP_LOCKFILES?.trim().toLowerCase();
    const skipLockfiles = skipEnvFalse !== '0' && skipEnvFalse !== 'false' && skipEnvFalse !== 'no';

    const customExcludes = parseCommaList(env.DIFF_REVIEW_EXCLUDE_PATH_CONTAINS);
    const excludeSubs = skipLockfiles
        ? [...defaultExcludeSubstrings(), ...customExcludes]
        : customExcludes.length > 0
          ? customExcludes
          : [];

    const includePrefixes = parseCommaList(env.DIFF_REVIEW_INCLUDE_PATH_PREFIXES).map((p) =>
        p.replace(/\\/g, '/'),
    );

    const blocks = splitUnifiedDiffIntoFileBlocks(diff);
    const kept: string[] = [];
    const skippedPaths: string[] = [];
    const keptPaths: string[] = [];

    for (const block of blocks) {
        const path = extractNewPathFromDiffBlock(block);
        const pathNorm = path?.replace(/\\/g, '/') ?? '';

        let skip = false;
        if (pathNorm && excludeSubs.some((sub) => pathNorm.includes(sub))) {
            skip = true;
        }
        if (!skip && includePrefixes.length > 0 && pathNorm) {
            const ok = includePrefixes.some((pre) => pathNorm.startsWith(pre) || pathNorm.includes(`/${pre}`));
            if (!ok) {
                skip = true;
            }
        }

        if (skip) {
            if (pathNorm) {
                skippedPaths.push(pathNorm);
            }
        } else {
            kept.push(block);
            if (pathNorm) {
                keptPaths.push(pathNorm);
            }
        }
    }

    const filteredDiff = kept.join('\n\n').trim();
    return { filteredDiff, skippedPaths, keptPaths };
}
