import jwt from 'jsonwebtoken';

const DEFAULT_EXPIRES_IN = '30d';

function getSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.trim().length < 8) {
        throw new Error('JWT_SECRET is missing or too short (set it in the environment, min 8 chars).');
    }
    return secret;
}

export type SessionPayload = {
    sub: string;
    email: string;
};

export function signSession(payload: SessionPayload): string {
    return jwt.sign(payload, getSecret(), { expiresIn: DEFAULT_EXPIRES_IN });
}

export function verifySession(token: string): SessionPayload | null {
    try {
        const decoded = jwt.verify(token, getSecret());
        if (typeof decoded !== 'object' || decoded === null) {
            return null;
        }
        const sub = (decoded as { sub?: unknown }).sub;
        const email = (decoded as { email?: unknown }).email;
        if (typeof sub !== 'string' || typeof email !== 'string') {
            return null;
        }
        return { sub, email };
    } catch {
        return null;
    }
}

/**
 * Sign a short-lived state token for the GitHub App install handshake.
 * State carries the userId so the setup callback can attribute the installation.
 */
export function signInstallState(userId: string): string {
    return jwt.sign({ kind: 'install', sub: userId }, getSecret(), { expiresIn: '15m' });
}

export function verifyInstallState(token: string): string | null {
    try {
        const decoded = jwt.verify(token, getSecret());
        if (typeof decoded !== 'object' || decoded === null) {
            return null;
        }
        const kind = (decoded as { kind?: unknown }).kind;
        const sub = (decoded as { sub?: unknown }).sub;
        if (kind !== 'install' || typeof sub !== 'string') {
            return null;
        }
        return sub;
    } catch {
        return null;
    }
}
