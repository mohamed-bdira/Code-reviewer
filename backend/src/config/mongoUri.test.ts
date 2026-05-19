import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeMissingMongoEnv, isValidMongoUri, resolveMongoUri } from './mongoUri.js';

describe('resolveMongoUri', () => {
    it('prefers MONGO_URI when valid', () => {
        const uri = resolveMongoUri({
            MONGO_URI: 'mongodb+srv://user:pass@cluster.example.net/db',
            MONGO_URL: 'mongodb://localhost/other',
        });
        assert.equal(uri, 'mongodb+srv://user:pass@cluster.example.net/db');
    });

    it('falls back to MONGO_URL (Railway plugin)', () => {
        const uri = resolveMongoUri({
            MONGO_URL: 'mongodb+srv://user:pass@cluster.example.net/db',
        });
        assert.equal(uri, 'mongodb+srv://user:pass@cluster.example.net/db');
    });

    it('strips surrounding quotes', () => {
        const uri = resolveMongoUri({
            MONGO_URI: '"mongodb://127.0.0.1:27017/pfe"',
        });
        assert.equal(uri, 'mongodb://127.0.0.1:27017/pfe');
    });

    it('returns undefined for invalid scheme', () => {
        assert.equal(resolveMongoUri({ MONGO_URI: 'cluster.example.net' }), undefined);
        assert.equal(resolveMongoUri({ MONGO_URI: '' }), undefined);
    });
});

describe('isValidMongoUri', () => {
    it('accepts mongodb and mongodb+srv', () => {
        assert.equal(isValidMongoUri('mongodb://localhost'), true);
        assert.equal(isValidMongoUri('mongodb+srv://host/db'), true);
        assert.equal(isValidMongoUri('postgres://host'), false);
    });
});

describe('describeMissingMongoEnv', () => {
    it('mentions invalid vars when present', () => {
        const msg = describeMissingMongoEnv({ MONGO_URI: 'not-a-uri' });
        assert.match(msg, /MONGO_URI/);
    });
});
