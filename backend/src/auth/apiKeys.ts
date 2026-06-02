import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import ApiKey from '../../models/ApiKey.js';
import type { IApiKey } from '../../models/ApiKey.js';

const LEGACY_PREFIX = 'pfe_';
const SECRET_BYTES = 32;
const PREFIX_VISIBLE = 8;
const KEY_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export type GeneratedKey = {
    plaintext: string;
    prefix: string;
    keyHash: string;
};

/** Mints a new key string, returning the plaintext (shown to user once) and the bcrypt hash to store. */
export async function generateKey(): Promise<GeneratedKey> {
    const plaintext = crypto.randomBytes(SECRET_BYTES).toString('hex');
    const prefix = plaintext.slice(0, PREFIX_VISIBLE);
    const keyHash = await bcrypt.hash(plaintext, 10);
    return { plaintext, prefix, keyHash };
}

function lookupPrefix(plaintext: string): string | null {
    if (plaintext.startsWith(LEGACY_PREFIX)) {
        return plaintext.slice(0, LEGACY_PREFIX.length + PREFIX_VISIBLE);
    }
    if (KEY_HEX_PATTERN.test(plaintext)) {
        return plaintext.slice(0, PREFIX_VISIBLE);
    }
    return null;
}

/** Returns the matching ApiKey doc if the plaintext is valid and not revoked, else null. */
export async function verifyKey(plaintext: string): Promise<IApiKey | null> {
    if (typeof plaintext !== 'string') {
        return null;
    }
    const prefix = lookupPrefix(plaintext);
    if (!prefix) {
        return null;
    }
    const candidates = await ApiKey.find({ prefix, revokedAt: { $exists: false } }).exec();
    for (const doc of candidates) {
        const ok = await bcrypt.compare(plaintext, doc.keyHash);
        if (ok) {
            doc.lastUsedAt = new Date();
            await doc.save().catch(() => {});
            return doc;
        }
    }
    return null;
}

export function isApiKeyToken(value: string): boolean {
    if (value.startsWith(LEGACY_PREFIX)) {
        return true;
    }
    return KEY_HEX_PATTERN.test(value);
}

/** True if the user has at least one non-revoked API key (used for optional review gating). */
export async function userHasActiveApiKey(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
        return false;
    }
    const n = await ApiKey.countDocuments({
        userId: new Types.ObjectId(userId),
        revokedAt: { $exists: false },
    }).exec();
    return n > 0;
}
