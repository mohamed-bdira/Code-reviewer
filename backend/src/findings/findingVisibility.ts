import { Types } from 'mongoose';
import RepoConfig from '../../models/RepoConfig.js';

/**
 * Build Mongo match for findings visible to a user: only rows from configured repositories.
 * Legacy rows without userId are included when repoFullName is configured for this user.
 */
export function buildFindingsVisibilityMatch(
    userId: Types.ObjectId,
    repoNames: readonly string[],
): Record<string, unknown> {
    if (repoNames.length === 0) {
        return { repoFullName: { $in: [] } };
    }
    return {
        $or: [
            { $and: [{ userId }, { repoFullName: { $in: [...repoNames] } }] },
            {
                $and: [
                    { $or: [{ userId: { $exists: false } }, { userId: null }] },
                    { repoFullName: { $in: [...repoNames] } },
                ],
            },
        ],
    };
}

/**
 * Findings are scoped to repositories the user currently has configured in RepoConfig.
 */
export async function matchFindingsVisibleToUser(userId: string): Promise<Record<string, unknown>> {
    const oid = new Types.ObjectId(userId);
    const repoNames: string[] = await RepoConfig.find({ userId: oid }).distinct('repoFullName').exec();
    return buildFindingsVisibilityMatch(oid, repoNames);
}
