import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCategoriesQueryParam } from './findingCategories.js';

describe('parseCategoriesQueryParam', () => {
    it('returns undefined for empty or invalid input', () => {
        assert.equal(parseCategoriesQueryParam(undefined), undefined);
        assert.equal(parseCategoriesQueryParam(''), undefined);
        assert.equal(parseCategoriesQueryParam('a11y,bug'), undefined);
    });

    it('parses allowed categories case-insensitively', () => {
        assert.deepEqual(parseCategoriesQueryParam('Security,STYLE,logic'), ['security', 'style', 'logic']);
    });

    it('drops unknown categories and dedupes', () => {
        assert.deepEqual(parseCategoriesQueryParam('security,a11y,security,performance'), [
            'security',
            'performance',
        ]);
    });
});
