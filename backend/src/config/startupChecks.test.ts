import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    getGithubAppKeyStatus,
    isGithubAppPrivateKeyInlineSet,
    resolveGithubAppPrivateKeyPath,
} from './githubAppKey.js';
import { buildHealthSnapshot, collectStartupChecks, getGeminiReviewStatus } from './startupChecks.js';

describe('getGithubAppKeyStatus', () => {
    it('detects inline private key', () => {
        const s = getGithubAppKeyStatus({
            GITHUB_APP_ID: '123',
            GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----',
        });
        assert.equal(s.appIdSet, true);
        assert.equal(s.privateKeyInlineSet, true);
        assert.equal(s.privateKeyConfigured, true);
    });

    it('reports missing key when neither inline nor file', () => {
        const s = getGithubAppKeyStatus({
            GITHUB_APP_PRIVATE_KEY_PATH: '/nonexistent/path/key.pem',
        });
        assert.equal(s.privateKeyConfigured, false);
        assert.equal(s.privateKeyFileReadable, false);
    });
});

describe('isGithubAppPrivateKeyInlineSet', () => {
    it('returns false for empty', () => {
        assert.equal(isGithubAppPrivateKeyInlineSet({ GITHUB_APP_PRIVATE_KEY: '  ' }), false);
    });
});

describe('resolveGithubAppPrivateKeyPath', () => {
    it('uses GITHUB_APP_PRIVATE_KEY_PATH when set', () => {
        const p = resolveGithubAppPrivateKeyPath({ GITHUB_APP_PRIVATE_KEY_PATH: './custom.pem' });
        assert.ok(p.endsWith('custom.pem'));
    });
});

describe('collectStartupChecks', () => {
    it('flags missing mongo and github app', () => {
        const checks = collectStartupChecks({}, 0);
        const labels = checks.map((c) => c.label);
        assert.ok(labels.includes('MONGO_URI'));
        assert.ok(labels.includes('GITHUB_APP_ID'));
        assert.ok(labels.includes('GEMINI_API_KEY'));
        assert.ok(checks.some((c) => c.label === 'MONGO_URI' && !c.ok));
    });

    it('passes when required env is present', () => {
        const checks = collectStartupChecks(
            {
                MONGO_URI: 'mongodb+srv://u:p@cluster.example.net/db',
                GITHUB_APP_ID: '99',
                GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----',
                GITHUB_WEBHOOK_SECRET: 'secret',
                GEMINI_API_KEY: 'test-key',
            },
            1,
        );
        const required = checks.filter((c) =>
            ['MONGO_URI', 'MongoDB connected', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GEMINI_API_KEY'].includes(
                c.label,
            ),
        );
        assert.ok(required.every((c) => c.ok));
    });
});

describe('buildHealthSnapshot', () => {
    it('ok when mongo connected, github, and gemini configured', () => {
        const prev = { ...process.env };
        process.env.MONGO_URI = 'mongodb+srv://u:p@cluster.example.net/db';
        process.env.GITHUB_APP_ID = '1';
        process.env.GITHUB_APP_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----';
        process.env.GEMINI_API_KEY = 'test-key';
        try {
            const h = buildHealthSnapshot(1);
            assert.equal(h.ok, true);
            assert.equal(h.mongodb, 'connected');
            assert.equal(h.githubApp.appIdSet, true);
            assert.equal(h.githubApp.privateKeySet, true);
            assert.equal(h.gemini.apiKeySet, true);
            assert.equal(h.issues.length, 0);
        } finally {
            process.env = prev;
        }
    });

    it('lists issues when mongo disconnected', () => {
        const prev = { ...process.env };
        process.env.MONGO_URI = 'mongodb+srv://u:p@cluster.example.net/db';
        try {
            const h = buildHealthSnapshot(0);
            assert.equal(h.ok, false);
            assert.ok(h.issues.some((i) => i.includes('not connected')));
        } finally {
            process.env = prev;
        }
    });
});

describe('getGeminiReviewStatus', () => {
    it('reports api key and default model', () => {
        const g = getGeminiReviewStatus({ GEMINI_API_KEY: 'k' });
        assert.equal(g.apiKeySet, true);
        assert.equal(g.model, 'gemini-2.5-flash');
    });

    it('uses GEMINI_MODEL when set', () => {
        const g = getGeminiReviewStatus({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-1.5-pro' });
        assert.equal(g.model, 'gemini-1.5-pro');
    });
});
