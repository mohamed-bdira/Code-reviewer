import { Types } from 'mongoose';
import RepoConfig from '../../models/RepoConfig.js';

/**
 * Findings are scoped by userId. Older rows may lack userId; allow those only when
 * repoFullName is one of the user's configured repositories (same tenant UX).
 */
export async function matchFindingsVisibleToUser(userId: string): Promise<Record<string, unknown>> {
    const oid = new Types.ObjectId(userId);
    const repoNames: string[] = await RepoConfig.find({ userId: oid }).distinct('repoFullName').exec();
    const branches: Record<string, unknown>[] = [{ userId: oid }];
    if (repoNames.length > 0) {
        branches.push({
            $and: [
                {
                    $or: [{ userId: { $exists: false } }, { userId: null }],
                },
                { repoFullName: { $in: repoNames } },
            ],
        });
    }
    return { $or: branches };
}
