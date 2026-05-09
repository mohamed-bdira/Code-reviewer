import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import ApiKey from '../../models/ApiKey.js';
import type { IApiKey } from '../../models/ApiKey.js';

const PREFIX = 'pfe_';
const SECRET_BYTES = 32;
const PREFIX_VISIBLE = 8;

export type GeneratedKey = {
    plaintext: string;
    prefix: string;
    keyHash: string;
};

/** Mints a new key string, returning the plaintext (shown to user once) and the bcrypt hash to store. */
export async function generateKey(): Promise<GeneratedKey> {
    const secret = crypto.randomBytes(SECRET_BYTES).toString('hex');
    const plaintext = `${PREFIX}${secret}`;
    const prefix = plaintext.slice(0, PREFIX.length + PREFIX_VISIBLE);
    const keyHash = await bcrypt.hash(plaintext, 10);
    return { plaintext, prefix, keyHash };
}

/** Returns the matching ApiKey doc if the plaintext is valid and not revoked, else null. */
export async function verifyKey(plaintext: string): Promise<IApiKey | null> {
    if (typeof plaintext !== 'string' || !plaintext.startsWith(PREFIX)) {
        return null;
    }
    const prefix = plaintext.slice(0, PREFIX.length + PREFIX_VISIBLE);
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
    return value.startsWith(PREFIX);
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
