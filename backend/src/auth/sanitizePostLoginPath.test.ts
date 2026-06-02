import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizePostLoginPath } from './sanitizePostLoginPath.js';

describe('sanitizePostLoginPath', () => {
    it('defaults empty to /', () => {
        assert.equal(sanitizePostLoginPath(null), '/');
        assert.equal(sanitizePostLoginPath(''), '/');
    });

    it('blocks protocol-relative paths', () => {
        assert.equal(sanitizePostLoginPath('//api/auth/github/start'), '/');
    });

    it('blocks /api routes', () => {
        assert.equal(sanitizePostLoginPath('/api/auth/github/start'), '/');
    });

    it('allows dashboard paths', () => {
        assert.equal(sanitizePostLoginPath('/configurations'), '/configurations');
    });
});
