/**
 * PR unified diffs only contain **changed** files — not the whole repo.
 * Segment explosions usually come from huge generated/lock files; filter those for AI review.
 */

function splitUnifiedDiffIntoFileBlocks(diff: string): string[] {
    if (!diff.trim()) {
        return [];
    }
    const lines = diff.split(/\r?\n/);
    const blocks: string[][] = [];
    let cur: string[] = [];
    for (const line of lines) {
        if (line.startsWith('diff --git ') && cur.length > 0) {
            blocks.push(cur);
            cur = [line];
        } else {
            cur.push(line);
        }
    }
    if (cur.length > 0) {
        blocks.push(cur);
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
