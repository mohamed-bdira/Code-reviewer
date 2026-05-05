import type { IRepoConfig } from '../../models/RepoConfig.js';

export type RepoConfigSnapshot = Pick<
    IRepoConfig,
    'focusAreas' | 'enforcementLevel' | 'useAstGrep' | 'customRules' | 'mergeMinScore'
>;

export function clampMergeMinScore(n: number | undefined): number {
    const v = n ?? 70;
    return Math.min(100, Math.max(0, Math.round(Number(v))));
}

export function getEffectiveRepoConfig(repoConfig: RepoConfigSnapshot | null) {
    return {
        focusAreas: repoConfig?.focusAreas?.length ? repoConfig.focusAreas : ['security', 'style'],
        enforcementLevel: repoConfig?.enforcementLevel ?? 'warning',
        useAstGrep: repoConfig?.useAstGrep ?? false,
        customRules: repoConfig?.customRules?.trim() || 'Ensure standard REST principles are followed.',
        mergeMinScore: clampMergeMinScore(repoConfig?.mergeMinScore as number | undefined),
    };
}

export type EffectiveRepoConfig = ReturnType<typeof getEffectiveRepoConfig>;
