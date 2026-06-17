import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCategoryCounts, parseCategoriesQueryParam } from './findingCategories.js';

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

describe('normalizeCategoryCounts', () => {
    it('returns all display categories with zero for missing rows', () => {
        assert.deepEqual(
            normalizeCategoryCounts([
                { _id: 'security', count: 10 },
                { _id: 'style', count: 5 },
                { _id: 'usability', count: 3 },
            ]),
            [
                { category: 'security', count: 10 },
                { category: 'style', count: 5 },
                { category: 'usability', count: 3 },
                { category: 'performance', count: 0 },
                { category: 'logic', count: 0 },
            ],
        );
    });
});
