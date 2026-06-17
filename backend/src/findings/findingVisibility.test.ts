import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Types } from 'mongoose';
import { buildFindingsVisibilityMatch } from './findingVisibility.js';

describe('buildFindingsVisibilityMatch', () => {
    const userId = new Types.ObjectId();

    it('matches nothing when no repositories are configured', () => {
        assert.deepEqual(buildFindingsVisibilityMatch(userId, []), { repoFullName: { $in: [] } });
    });

    it('scopes userId and legacy rows to configured repo names', () => {
        const match = buildFindingsVisibilityMatch(userId, ['owner/repo']);
        assert.equal(typeof match.$or, 'object');
        assert.equal(Array.isArray(match.$or), true);
        assert.equal((match.$or as unknown[]).length, 2);
    });
});
