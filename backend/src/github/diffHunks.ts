import type { ReviewBugInput } from '../enforcer/parseEnforcerResponse.js';

export type HunkMap = Map<string, Set<number>>;

/**
 * Parse a unified diff and return, per file path, the set of RIGHT-side line
 * numbers covered by hunks (added or context lines on the new revision).
 *
 * Only the RIGHT side is collected because GitHub PR review inline comments
 * anchor to lines on the head revision (added/changed lines you can click on
 * in the "Files changed" view).
 */
export function parseDiffHunks(diff: string): HunkMap {
    const map: HunkMap = new Map();
    if (!diff) {
        return map;
    }

    const lines = diff.split(/\r?\n/);
    let currentPath: string | null = null;
    let rightLine = 0;
    let inHunk = false;

    const ensureSet = (path: string): Set<number> => {
        let set = map.get(path);
        if (!set) {
            set = new Set<number>();
            map.set(path, set);
        }
        return set;
    };

    for (const line of lines) {
        if (line.startsWith('diff --git ')) {
            currentPath = null;
            inHunk = false;
            continue;
        }

        if (line.startsWith('+++ ')) {
            const after = line.slice(4).trim();
            if (after === '/dev/null') {
                currentPath = null;
            } else {
                currentPath = after.startsWith('b/') ? after.slice(2) : after;
            }
            inHunk = false;
            continue;
        }

        if (line.startsWith('--- ')) {
            continue;
        }

        if (line.startsWith('@@')) {
            const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
            if (match && match[1] !== undefined) {
                rightLine = Number(match[1]);
                inHunk = currentPath !== null;
            } else {
                inHunk = false;
            }
            continue;
        }

        if (!inHunk || !currentPath) {
            continue;
        }

        const first = line.charAt(0);
        if (first === '+') {
            ensureSet(currentPath).add(rightLine);
            rightLine += 1;
        } else if (first === '-') {
            // Removed lines do not advance the right side.
        } else if (first === '\\') {
            // "\ No newline at end of file" — skip without advancing.
        } else {
            ensureSet(currentPath).add(rightLine);
            rightLine += 1;
        }
    }

    return map;
}

/**
 * Shape accepted by octokit.rest.pulls.createReview's `comments[]` parameter.
 * Either a single line (`line`) or a multi-line span (`start_line` + `line`).
 */
export type InlineReviewComment = {
    path: string;
    body: string;
    side: 'RIGHT';
    line: number;
    start_line?: number;
    start_side?: 'RIGHT';
};

export type BugMappingResult = {
    inline: InlineReviewComment[];
    orphans: ReviewBugInput[];
};

function formatInlineBody(bug: ReviewBugInput): string {
    const tag = bug.category ? `**[${bug.category}]** ` : '';
    return `${tag}${bug.description}`.trim();
}

/**
 * Split AI bugs into anchorable inline comments (line lives in a diff hunk on
 * the RIGHT side) and orphans (no line, or line not in the diff).
 */
export function bugsToReviewComments(bugs: ReviewBugInput[], hunks: HunkMap): BugMappingResult {
    const inline: InlineReviewComment[] = [];
    const orphans: ReviewBugInput[] = [];

    for (const bug of bugs) {
        const path = bug.file?.replace(/^\.\//, '').replace(/\\/g, '/');
        if (!path || bug.lineStart === undefined) {
            orphans.push(bug);
            continue;
        }

        const fileHunks = hunks.get(path);
        if (!fileHunks || !fileHunks.has(bug.lineStart)) {
            orphans.push(bug);
            continue;
        }

        if (bug.lineEnd !== undefined && bug.lineEnd > bug.lineStart) {
            if (!fileHunks.has(bug.lineEnd)) {
                orphans.push(bug);
                continue;
            }
            inline.push({
                path,
                body: formatInlineBody(bug),
                side: 'RIGHT',
                line: bug.lineEnd,
                start_line: bug.lineStart,
                start_side: 'RIGHT',
            });
        } else {
            inline.push({
                path,
                body: formatInlineBody(bug),
                side: 'RIGHT',
                line: bug.lineStart,
            });
        }
    }

    return { inline, orphans };
}
