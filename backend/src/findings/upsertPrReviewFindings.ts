import PrReviewFinding from '../../models/PrReviewFinding.js';
import { bugRowsForDb, findingDedupeKey, type ReviewBugInput } from '../enforcer/parseEnforcerResponse.js';
import { publish, type FindingPayload } from '../events/bus.js';

/** Upserts each bug by dedupeKey; bumps lastSeenAt on repeats. Returns number of bugs processed this run. */
export async function upsertPrReviewFindings(
    repoFullName: string,
    prNumber: number,
    bugs: ReviewBugInput[],
    userId?: string,
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

        const setFields: Record<string, unknown> = {
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
        };
        if (userId) {
            setFields.userId = userId;
        }

        const updateRes = await PrReviewFinding.findOneAndUpdate(
            { dedupeKey },
            {
                $set: setFields,
                $setOnInsert: {
                    firstSeenAt: now,
                },
            },
            { upsert: true, new: true, includeResultMetadata: true },
        );

        const meta = updateRes as unknown as {
            value?: { _id: unknown; firstSeenAt?: Date; lastSeenAt?: Date } | null;
            lastErrorObject?: { upserted?: unknown };
        } | null;
        const doc = meta?.value ?? null;
        const wasInsert = Boolean(meta?.lastErrorObject?.upserted);

        if (userId && doc) {
            const firstSeenAt = doc.firstSeenAt;
            const lastSeenAt = doc.lastSeenAt;
            const payload: FindingPayload = {
                id: String(doc._id),
                repoFullName: row.repoFullName,
                prNumber: row.prNumber,
                category: row.category,
                filePath: row.filePath,
                description: row.description,
                ...(row.lineStart !== undefined ? { lineStart: row.lineStart } : {}),
                ...(row.lineEnd !== undefined ? { lineEnd: row.lineEnd } : {}),
                ...(firstSeenAt ? { firstSeenAt: firstSeenAt.toISOString() } : {}),
                ...(lastSeenAt ? { lastSeenAt: lastSeenAt.toISOString() } : {}),
            };
            publish({
                type: wasInsert ? 'finding-created' : 'finding-updated',
                userId,
                payload,
            });
        }
    }

    return rows.length;
}
