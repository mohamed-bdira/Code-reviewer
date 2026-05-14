import type { Octokit } from 'octokit';

/** Inserted between listFiles/compareCommits patches so filters can split reliably (patches may repeat `--- a/`). */
export const PFE_CONCAT_FILE_BOUNDARY = '<<<PFE_FILE_BOUNDARY_a9f3e>>>';

export function normalizeDiffPayload(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload.trim();
    }

    if (payload == null) {
        return '';
    }

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
        return payload.toString('utf8').trim();
    }

    if (payload instanceof Uint8Array) {
        return Buffer.from(payload).toString('utf8').trim();
    }

    try {
        const serialized = JSON.stringify(payload, null, 2);
        return serialized.trim();
    } catch {
        return String(payload).trim();
    }
}

function isUnifiedDiffUnavailable(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        (err as { status: number }).status === 406
    );
}

async function fetchUnifiedDiffFromPullGet(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
): Promise<string> {
    try {
        const { data } = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber,
            mediaType: { format: 'diff' },
        });
        return normalizeDiffPayload(data);
    } catch (err) {
        if (isUnifiedDiffUnavailable(err)) {
            console.warn(
                `[fetchPrDiff] unified diff unavailable for ${owner}/${repo}#${pullNumber} (GitHub rejects oversized diff); falling back to per-file patches.`,
            );
            return '';
        }
        throw err;
    }
}

async function concatPatchesFromListFiles(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
): Promise<string> {
    const parts: string[] = [];
    let page = 1;

    while (true) {
        const { data } = await octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: pullNumber,
            per_page: 100,
            page,
        });

        for (const f of data) {
            if (!f.filename || typeof f.patch !== 'string' || f.patch.length === 0) {
                continue;
            }
            const chunk = `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`;
            parts.push(parts.length === 0 ? chunk : `${PFE_CONCAT_FILE_BOUNDARY}${chunk}`);
        }

        if (data.length < 100) {
            break;
        }
        page += 1;
    }

    return parts.join('').trim();
}

async function concatPatchesFromCompare(
    octokit: Octokit,
    owner: string,
    repo: string,
    baseSha: string,
    headSha: string,
): Promise<string> {
    if (!baseSha || !headSha) {
        return '';
    }

    const { data } = await octokit.rest.repos.compareCommits({
        owner,
        repo,
        base: baseSha,
        head: headSha,
    });

    const parts: string[] = [];
    for (const f of data.files ?? []) {
        if (typeof f.patch === 'string' && f.patch.length > 0 && f.filename) {
            const chunk = `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`;
            parts.push(parts.length === 0 ? chunk : `${PFE_CONCAT_FILE_BOUNDARY}${chunk}`);
        }
    }

    return parts.join('').trim();
}

/**
 * Authoritative repo-relative paths for this PR (GitHub `pulls.listFiles`).
 * Includes `previous_filename` for renames so diff hunks referencing either side match.
 */
export async function fetchPullRequestChangedPaths(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
): Promise<Set<string>> {
    const paths = new Set<string>();
    let page = 1;

    while (true) {
        const { data } = await octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: pullNumber,
            per_page: 100,
            page,
        });

        for (const f of data) {
            if (f.filename) {
                paths.add(f.filename.replace(/\\/g, '/'));
            }
            if (f.previous_filename) {
                paths.add(f.previous_filename.replace(/\\/g, '/'));
            }
        }

        if (data.length < 100) {
            break;
        }
        page += 1;
    }

    return paths;
}

export async function fetchPrDiffString(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
    baseSha: string | undefined,
    headSha: string | undefined,
): Promise<string> {
    let s = await fetchUnifiedDiffFromPullGet(octokit, owner, repo, pullNumber);
    if (s.length > 0) {
        return s;
    }

    s = await concatPatchesFromListFiles(octokit, owner, repo, pullNumber);
    if (s.length > 0) {
        return s;
    }

    if (baseSha && headSha) {
        s = await concatPatchesFromCompare(octokit, owner, repo, baseSha, headSha);
    }

    return s;
}
