import { strict as assert } from 'node:assert';
import {
    astGrepMatchesToBugs,
    filterScannablePaths,
    formatAstGrepPromptBlock,
    parseAstGrepJsonOutput,
} from './astGrep.js';

{
    const paths = filterScannablePaths([
        'src/a.ts',
        'README.md',
        'package-lock.json',
        'src/b.tsx',
        'src/a.ts',
    ]);
    assert.deepEqual(paths, ['src/a.ts', 'src/b.tsx']);
}

{
    const json = JSON.stringify([
        {
            ruleId: 'no-eval',
            severity: 'error',
            message: 'Avoid eval',
            file: 'src/x.ts',
            range: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
        },
    ]);
    const matches = parseAstGrepJsonOutput(json);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.ruleId, 'no-eval');
    assert.equal(matches[0]?.lineStart, 3);
    const bugs = astGrepMatchesToBugs(matches);
    assert.equal(bugs[0]?.category, 'security');
    assert.ok(bugs[0]?.description.includes('no-eval'));
}

{
    const block = formatAstGrepPromptBlock(
        [
            {
                ruleId: 'empty-catch',
                severity: 'warning',
                message: 'Empty catch',
                file: 'lib.ts',
                lineStart: 10,
            },
        ],
        3,
    );
    assert.ok(block.includes('empty-catch'));
    assert.ok(block.includes('lib.ts:10'));
}

console.log('astGrep.test.ts: ok');
