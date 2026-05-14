import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PFE_CONCAT_FILE_BOUNDARY } from '../github/fetchPrDiff.js';
import {
    extractNewPathFromDiffBlock,
    extractOldPathFromDiffBlock,
    filterUnifiedDiffForAiReview,
    restrictUnifiedDiffToPrPaths,
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

describe('extractOldPathFromDiffBlock', () => {
    it('reads --- a/ path', () => {
        const block = `--- a/backend/y.ts\n+++ b/backend/y.ts`;
        assert.equal(extractOldPathFromDiffBlock(block), 'backend/y.ts');
    });

    it('returns null for add-only (--- /dev/null)', () => {
        const block = `--- /dev/null\n+++ b/new.ts`;
        assert.equal(extractOldPathFromDiffBlock(block), null);
    });
});

describe('restrictUnifiedDiffToPrPaths', () => {
    const twoFiles = `diff --git a/good.ts b/good.ts
--- a/good.ts
+++ b/good.ts
@@ -1 +1 @@
-a
+b
diff --git a/bad.ts b/bad.ts
--- a/bad.ts
+++ b/bad.ts
@@ -1 +1 @@
-x
+y
`;

    it('keeps blocks whose path is in the allowlist', () => {
        const r = restrictUnifiedDiffToPrPaths(twoFiles, new Set(['good.ts']));
        assert.ok(r.restrictedDiff.includes('good.ts'));
        assert.ok(!r.restrictedDiff.includes('bad.ts'));
        assert.ok(r.droppedPaths.some((p) => p.includes('bad.ts')));
        assert.equal(r.droppedUnknownPathBlocks, 0);
    });

    it('preserves concat boundary when rejoining multiple kept blocks', () => {
        const chunkA = `--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+a`;
        const chunkB = `--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-b\n+b`;
        const glued = `${chunkA}${PFE_CONCAT_FILE_BOUNDARY}${chunkB}`;
        const r = restrictUnifiedDiffToPrPaths(glued, new Set(['a.ts', 'b.ts']));
        assert.ok(r.restrictedDiff.includes(PFE_CONCAT_FILE_BOUNDARY));
        assert.ok(r.restrictedDiff.includes('a.ts'));
        assert.ok(r.restrictedDiff.includes('b.ts'));
    });

    it('keeps delete-only hunks when old path is in the allowlist', () => {
        const del = `diff --git a/removed.ts b/removed.ts
deleted file mode 100644
--- a/removed.ts
+++ /dev/null
@@ -1 +0,0 @@
-old
`;
        const r = restrictUnifiedDiffToPrPaths(del, new Set(['removed.ts']));
        assert.ok(r.restrictedDiff.includes('removed.ts'));
        assert.equal(r.droppedPaths.length, 0);
    });

    it('matches renames when either previous or new path is allowlisted', () => {
        const rename = `diff --git a/oldname.ts b/newname.ts
rename from oldname.ts
rename to newname.ts
--- a/oldname.ts
+++ b/newname.ts
@@ -1 +1 @@
-a
+b
`;
        const rOld = restrictUnifiedDiffToPrPaths(rename, new Set(['oldname.ts', 'newname.ts']));
        assert.ok(rOld.restrictedDiff.includes('newname.ts'));

        const rNewOnly = restrictUnifiedDiffToPrPaths(rename, new Set(['newname.ts']));
        assert.ok(rNewOnly.restrictedDiff.length > 0);
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
