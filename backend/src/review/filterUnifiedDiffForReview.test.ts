import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PFE_CONCAT_FILE_BOUNDARY } from '../github/fetchPrDiff.js';
import {
    extractNewPathFromDiffBlock,
    filterUnifiedDiffForAiReview,
} from './filterUnifiedDiffForReview.js';

/** Patch-only format from pulls.listFiles/compareCommits fallback (no diff --git lines). */
const patchOnlyLockAndTs = `--- a/backend/a.ts
+++ b/backend/a.ts
@@ -1 +1 @@
-old
+new

--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-x
+y
`;

const sampleTwoFiles = `diff --git a/backend/a.ts b/backend/a.ts
index 111..222 100644
--- a/backend/a.ts
+++ b/backend/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/package-lock.json b/package-lock.json
index 333..444 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-x
+y
`;

describe('extractNewPathFromDiffBlock', () => {
    it('reads +++ b/ path', () => {
        const block = `diff --git a/foo b/foo\n+++ b/backend/x.ts`;
        assert.equal(extractNewPathFromDiffBlock(block), 'backend/x.ts');
    });
});

describe('filterUnifiedDiffForAiReview', () => {
    it('splits concatPatches output using explicit boundary marker', () => {
        const innerDup =
            'diff --git a/frontend/package-lock.json b/frontend/package-lock.json\n@@ -1 +1 @@\n-x\n+y';
        const chunkA = `--- a/backend/a.ts\n+++ b/backend/a.ts\n@@ -1 +1 @@\n-a\n+b`;
        const chunkB = `--- a/frontend/package-lock.json\n+++ b/frontend/package-lock.json\n${innerDup}`;
        const glued = `${chunkA}${PFE_CONCAT_FILE_BOUNDARY}${chunkB}`;
        const r = filterUnifiedDiffForAiReview(glued, {});
        assert.ok(r.filteredDiff.includes('backend/a.ts'));
        assert.ok(!r.filteredDiff.includes('package-lock'));
        assert.deepEqual(r.keptPaths, ['backend/a.ts']);
    });

    it('splits patch-only fallback into multiple files (no diff --git)', () => {
        const r = filterUnifiedDiffForAiReview(patchOnlyLockAndTs, {});
        assert.ok(r.filteredDiff.includes('backend/a.ts'));
        assert.ok(!r.filteredDiff.includes('package-lock'));
        assert.deepEqual(r.keptPaths, ['backend/a.ts']);
        assert.ok(r.skippedPaths.some((p) => p.includes('package-lock')));
    });

    it('drops lockfile by default', () => {
        const r = filterUnifiedDiffForAiReview(sampleTwoFiles, {});
        assert.ok(r.filteredDiff.includes('backend/a.ts'));
        assert.ok(!r.filteredDiff.includes('package-lock.json'));
        assert.equal(r.skippedPaths.length, 1);
        assert.ok(r.skippedPaths[0]?.includes('package-lock'));
    });

    it('include prefix keeps only matching paths', () => {
        const r = filterUnifiedDiffForAiReview(sampleTwoFiles, {
            DIFF_REVIEW_SKIP_LOCKFILES: 'false',
            DIFF_REVIEW_INCLUDE_PATH_PREFIXES: 'backend/',
        });
        assert.ok(r.filteredDiff.includes('backend/a.ts'));
        assert.ok(!r.filteredDiff.includes('package-lock'));
        assert.equal(r.skippedPaths.length, 1);
    });
});
