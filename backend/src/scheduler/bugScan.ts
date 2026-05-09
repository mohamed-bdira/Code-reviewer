import mongoose from 'mongoose';
import Installation from '../../models/Installation.js';
import RepoConfig from '../../models/RepoConfig.js';
import { reviewPullRequest } from '../review/reviewPullRequest.js';
import { getEffectiveRepoConfig } from '../review/effectiveRepoConfig.js';
import { userHasActiveApiKey } from '../auth/apiKeys.js';
import { getInstallationOctokit } from '../github/octokit.js';

export type ScheduledScanEnvSnapshot = {
    enabled: boolean;
    intervalMinutes: number;
    maxPrsPerRepo: number;
    postComments: boolean;
    skipUnchanged: boolean;
    runOnStart: boolean;
};

/** Parses the same env vars used by {@link startBugScanScheduler}. */
export function readScheduledScanEnv(): ScheduledScanEnvSnapshot {
    return {
        enabled: process.env.ENABLE_BUG_SCAN === 'true',
        intervalMinutes: Math.max(1, Number(process.env.BUG_SCAN_INTERVAL_MINUTES ?? 60) || 60),
        maxPrsPerRepo: Math.max(1, Number(process.env.BUG_SCAN_MAX_PRS_PER_REPO ?? 10) || 10),
        postComments: process.env.BUG_SCAN_POST_COMMENTS === 'true',
        skipUnchanged: process.env.BUG_SCAN_SKIP_UNCHANGED !== 'false',
        runOnStart: process.env.BUG_SCAN_RUN_ON_START === 'true',
    };
}

function splitRepoFullName(repoFullName: string): { owner: string; repo: string } | null {
    const i = repoFullName.indexOf('/');
    if (i <= 0 || i === repoFullName.length - 1) {
        return null;
    }
    return {
        owner: repoFullName.slice(0, i),
        repo: repoFullName.slice(i + 1),
    };
}

export function startBugScanScheduler(deps: { mongoUri: string | undefined }): () => void {
    const snap = readScheduledScanEnv();
    if (!snap.enabled) {
        return () => {};
    }

    const minutes = snap.intervalMinutes;
    const maxPrs = snap.maxPrsPerRepo;
    const postComments = snap.postComments;
    const skipUnchanged = snap.skipUnchanged;

    const lastHeadByPr = new Map<string, string>();

    const ms = minutes * 60 * 1000;

    async function tick(): Promise<void> {
        if (mongoose.connection.readyState !== 1) {
            console.warn('[bug-scan] MongoDB not connected; skipping tick');
            return;
        }

        let installations;
        try {
            installations = await Installation.find().exec();
        } catch (e) {
            console.error('[bug-scan] Installation fetch failed:', e);
            return;
        }

        for (const install of installations) {
            const installationId = install.installationId;
            const userId = String(install.userId);
            if (process.env.REQUIRE_API_KEY_FOR_REVIEWS === 'true') {
                const hasKey = await userHasActiveApiKey(userId);
                if (!hasKey) {
                    continue;
                }
            }
            let octokit;
            try {
                octokit = getInstallationOctokit(installationId);
            } catch (e) {
                console.error(`[bug-scan] octokit init failed for installation ${installationId}:`, e);
                continue;
            }

            let configs;
            try {
                configs = await RepoConfig.find({ userId: install.userId }).exec();
            } catch (e) {
                console.error(`[bug-scan] RepoConfig fetch failed for user ${userId}:`, e);
                continue;
            }

            for (const cfg of configs) {
                if (cfg.installationId !== installationId) {
                    continue;
                }
                const repoFullName = cfg.repoFullName;
                const parts = splitRepoFullName(repoFullName);
                if (!parts) {
                    console.warn(`[bug-scan] Invalid repoFullName "${repoFullName}", skipping`);
                    continue;
                }
                const { owner, repo } = parts;

                let pulls;
                try {
                    const { data } = await octokit.rest.pulls.list({
                        owner,
                        repo,
                        state: 'open',
                        per_page: maxPrs,
                    });
                    pulls = data;
                } catch (e) {
                    console.error(`[bug-scan] pulls.list failed for ${repoFullName}:`, e);
                    continue;
                }

                const effectiveConfig = getEffectiveRepoConfig(cfg.toObject());

                for (const pr of pulls.slice(0, maxPrs)) {
                    const prNumber = pr.number;
                    const key = `${repoFullName}#${prNumber}`;
                    const headSha = pr.head?.sha ?? '';
                    if (skipUnchanged && headSha && lastHeadByPr.get(key) === headSha) {
                        continue;
                    }

                    try {
                        await reviewPullRequest({
                            octokit,
                            repoOwner: owner,
                            repoName: repo,
                            repoFullName,
                            prNumber,
                            prTitle: pr.title || 'No title.',
                            prDescription: pr.body || 'No description.',
                            ...(pr.base?.sha !== undefined ? { baseSha: pr.base.sha } : {}),
                            ...(pr.head?.sha !== undefined ? { headSha: pr.head.sha } : {}),
                            effectiveConfig,
                            postComment: postComments,
                            ...(deps.mongoUri !== undefined ? { mongoUri: deps.mongoUri } : {}),
                            userId,
                        });

                        if (headSha) {
                            lastHeadByPr.set(key, headSha);
                        }
                        console.log(`[bug-scan] Finished ${repoFullName}#${prNumber} (user ${userId})`);
                    } catch (e) {
                        console.error(`[bug-scan] review failed ${repoFullName}#${prNumber}:`, e);
                    }
                }
            }
        }
    }

    console.log(`[bug-scan] Enabled every ${minutes} min, max ${maxPrs} PRs/repo, postComments=${postComments}`);

    if (snap.runOnStart) {
        void tick();
    }

    const id = setInterval(() => void tick(), ms);

    return () => clearInterval(id);
}
