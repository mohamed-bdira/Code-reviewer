import crypto from 'node:crypto';
import type express from 'express';

/**
 * GitHub sends `X-Hub-Signature-256: sha256=<hex>`.
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export function verifyGithubSignature256(
    rawBody: Buffer,
    signatureHeader: string | string[] | undefined,
    secret: string,
): boolean {
    if (!signatureHeader || typeof signatureHeader !== 'string') {
        return false;
    }
    if (!signatureHeader.startsWith('sha256=')) {
        return false;
    }
    const theirsHex = signatureHeader.slice('sha256='.length);
    const oursHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
        const a = Buffer.from(theirsHex, 'hex');
        const b = Buffer.from(oursHex, 'hex');
        if (a.length !== b.length) {
            return false;
        }
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

export type RequestWithRawBody = express.Request & { rawBody?: Buffer };
