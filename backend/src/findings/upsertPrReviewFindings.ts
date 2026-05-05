import PrReviewFinding from '../../models/PrReviewFinding.js';
import { bugRowsForDb, findingDedupeKey, type ReviewBugInput } from '../enforcer/parseEnforcerResponse.js';

/** Upserts each bug by dedupeKey; bumps lastSeenAt on repeats. Returns number of bugs processed this run. */
export async function upsertPrReviewFindings(
    repoFullName: string,
    prNumber: number,
    bugs: ReviewBugInput[],
): Promise<number> {
    const now = new Date();
    const rows = bugRowsForDb(bugs, repoFullName, prNumber);

    for (const row of rows) {
        const dedupeKey = findingDedupeKey({
            repoFullName: row.repoFullName,
            prNumber: row.prNumber,
            filePath: row.filePath,
            description: row.description,
            ...(row.lineStart !== undefined ? { lineStart: row.lineStart } : {}),
            ...(row.lineEnd !== undefined ? { lineEnd: row.lineEnd } : {}),
        });

        await PrReviewFinding.findOneAndUpdate(
            { dedupeKey },
            {
                $set: {
                    dedupeKey,
                    repoFullName: row.repoFullName,
                    prNumber: row.prNumber,
                    category: row.category,
                    filePath: row.filePath,
                    lineStart: row.lineStart,
                    lineEnd: row.lineEnd,
                    linesAffected: row.linesAffected,
                    description: row.description,
                    lastSeenAt: now,
                },
                $setOnInsert: {
                    firstSeenAt: now,
                },
            },
            { upsert: true },
        );
    }

    return rows.length;
}
