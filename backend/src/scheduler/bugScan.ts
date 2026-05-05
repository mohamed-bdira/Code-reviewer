import mongoose from 'mongoose';
import type { Octokit } from 'octokit';
import RepoConfig from '../../models/RepoConfig.js';
import { reviewPullRequest } from '../review/reviewPullRequest.js';
import { getEffectiveRepoConfig } from '../review/effectiveRepoConfig.js';

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

export function startBugScanScheduler(deps: { octokit: Octokit; mongoUri: string | undefined }): () => void {
    if (process.env.ENABLE_BUG_SCAN !== 'true') {
        return () => {};
    }

    const minutes = Math.max(1, Number(process.env.BUG_SCAN_INTERVAL_MINUTES ?? 60) || 60);
    const maxPrs = Math.max(1, Number(process.env.BUG_SCAN_MAX_PRS_PER_REPO ?? 10) || 10);
    const postComments = process.env.BUG_SCAN_POST_COMMENTS === 'true';
    const skipUnchanged = process.env.BUG_SCAN_SKIP_UNCHANGED !== 'false';

    const lastHeadByPr = new Map<string, string>();

    const ms = minutes * 60 * 1000;

    async function tick(): Promise<void> {
        if (mongoose.connection.readyState !== 1) {
            console.warn('[bug-scan] MongoDB not connected; skipping tick');
            return;
        }

        let configs;
        try {
            configs = await RepoConfig.find().exec();
        } catch (e) {
            console.error('[bug-scan] RepoConfig fetch failed:', e);
            return;
        }

        for (const cfg of configs) {
            const repoFullName = cfg.repoFullName;
            const parts = splitRepoFullName(repoFullName);
            if (!parts) {
                console.warn(`[bug-scan] Invalid repoFullName "${repoFullName}", skipping`);
                continue;
            }
            const { owner, repo } = parts;

            let pulls;
            try {
                const { data } = await deps.octokit.rest.pulls.list({
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
                        octokit: deps.octokit,
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
                    });

                    if (headSha) {
                        lastHeadByPr.set(key, headSha);
                    }
                    console.log(`[bug-scan] Finished ${repoFullName}#${prNumber}`);
                } catch (e) {
                    console.error(`[bug-scan] review failed ${repoFullName}#${prNumber}:`, e);
                }
            }
        }
    }

    console.log(`[bug-scan] Enabled every ${minutes} min, max ${maxPrs} PRs/repo, postComments=${postComments}`);

    if (process.env.BUG_SCAN_RUN_ON_START === 'true') {
        void tick();
    }

    const id = setInterval(() => void tick(), ms);

    return () => clearInterval(id);
}
