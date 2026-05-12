import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    extractNewPathFromDiffBlock,
    filterUnifiedDiffForAiReview,
} from './filterUnifiedDiffForReview.js';

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
