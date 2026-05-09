/**
 * Quick checks for enforcer parsing and merge rules (no network).
 * Run: npx tsx scripts/enforcer-smoke.ts
 */
import {
    buildScoreDimensions,
    evaluateMergeReadiness,
    formatEnforcerReviewSummary,
    parseEnforcerResponse,
} from '../src/enforcer/parseEnforcerResponse.js';
import { bugsToReviewComments, parseDiffHunks } from '../src/github/diffHunks.js';

function assert(name: string, cond: boolean) {
    if (!cond) {
        throw new Error(`FAIL: ${name}`);
    }
    console.log(`ok: ${name}`);
}

const good = `
Narrative review here.

\`\`\`json
{
  "scores": { "security": 80, "style": 90, "usability": 85 },
  "notes": { "security": "ok", "style": "ok", "usability": "ok" },
  "blockers": [],
  "bugs": []
}
\`\`\`
`;

{
    const p = parseEnforcerResponse(good);
    assert('parses fence', p.data !== null && p.parseError === null);
    assert('prose omits json', p.prose.includes('Narrative') && !p.prose.includes('```json'));
    const ev = evaluateMergeReadiness(p.data!, 70);
    assert('merge ok', ev.mergeRecommended && ev.overall === 80);
}

{
    const lowSec = parseEnforcerResponse(`\`\`\`json
{"scores":{"security":40,"style":90,"usability":90},"notes":{},"blockers":[],"bugs":[]}
\`\`\``);
    const ev = evaluateMergeReadiness(lowSec.data!, 70);
    assert('security veto', !ev.mergeRecommended);
}

{
    const blockers = parseEnforcerResponse(`\`\`\`json
{"scores":{"security":100,"style":100,"usability":100},"notes":{},"blockers":["SQL injection"],"bugs":[]}
\`\`\``);
    const ev = evaluateMergeReadiness(blockers.data!, 70);
    assert('blockers block merge', !ev.mergeRecommended);
}

{
    const dims = buildScoreDimensions(['Performance']);
    assert('dims union', dims.includes('security') && dims.includes('performance'));
}

{
    const body = formatEnforcerReviewSummary({
        enforcementLevel: 'warning',
        mergeRecommended: true,
        overall: 80,
        mergeMinScore: 70,
        data: parseEnforcerResponse(good).data,
        prose: 'hello',
        reasons: [],
        parseError: null,
        orphanBugs: [],
        inlineCommentsPosted: 0,
        findingsRecorded: 0,
    });
    assert(
        'markdown has table and no diff dump',
        body.includes('| Section |') &&
            body.includes('Ready to merge') &&
            !body.includes('```diff') &&
            !body.includes('### Diff'),
    );
}

{
    const withBugs = parseEnforcerResponse(`\`\`\`json
{"scores":{"security":70,"style":70,"usability":70},"notes":{},"blockers":[],"bugs":[{"category":"security","file":"src/x.ts","lineStart":1,"lineEnd":3,"description":"issue"}]}
\`\`\``);
    assert('parses bugs', withBugs.data?.bugs.length === 1 && withBugs.data.bugs[0]?.file === 'src/x.ts');
}

{
    const sampleDiff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,5 @@
 const a = 1;
-const old = 2;
+const replacement = 2;
+const extra = 3;
 const c = 4;
`;
    const hunks = parseDiffHunks(sampleDiff);
    assert('hunk parser sees right-side lines', hunks.get('src/x.ts')?.has(2) === true && hunks.get('src/x.ts')?.has(3) === true);

    const split = bugsToReviewComments(
        [
            { category: 'security', file: 'src/x.ts', lineStart: 2, description: 'anchored bug' },
            { category: 'style', file: 'src/x.ts', lineStart: 999, description: 'orphan bug' },
            { category: 'bug', file: 'src/x.ts', description: 'no-line bug' },
        ],
        hunks,
    );
    assert('inline anchors line in diff', split.inline.length === 1 && split.inline[0]?.line === 2);
    assert('orphans collected', split.orphans.length === 2);
}

console.log('\nAll enforcer smoke checks passed.');
