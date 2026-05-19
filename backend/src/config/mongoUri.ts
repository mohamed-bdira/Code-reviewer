/** Env keys checked in order (Railway Mongo plugin exposes `MONGO_URL`). */
const MONGO_URI_KEYS = ['MONGO_URI', 'MONGODB_URI', 'MONGO_URL', 'DATABASE_URL'] as const;

function stripQuotes(value: string): string {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

export function isValidMongoUri(uri: string): boolean {
    return uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://');
}

/**
 * Resolve a Mongo connection string from common env var names.
 * Returns undefined when unset or not a valid mongodb:// / mongodb+srv:// URI.
 */
export function resolveMongoUri(env: NodeJS.ProcessEnv = process.env): string | undefined {
    for (const key of MONGO_URI_KEYS) {
        const raw = env[key];
        if (typeof raw !== 'string' || !raw.trim()) {
            continue;
        }
        const uri = stripQuotes(raw);
        if (isValidMongoUri(uri)) {
            if (key !== 'MONGO_URI') {
                console.log(`[mongo] Using ${key} as connection string`);
            }
            return uri;
        }
        console.warn(
            `[mongo] ${key} is set but invalid (must start with mongodb:// or mongodb+srv://); value length=${uri.length}`,
        );
    }
    return undefined;
}

export function describeMissingMongoEnv(env: NodeJS.ProcessEnv = process.env): string {
    const invalid = MONGO_URI_KEYS.filter((key) => {
        const raw = env[key];
        return typeof raw === 'string' && raw.trim() && !isValidMongoUri(stripQuotes(raw));
    });
    if (invalid.length > 0) {
        return `${invalid.join(', ')} set but not valid mongodb:// URIs.`;
    }
    return (
        'No MongoDB URI found. Set MONGO_URI on Railway (Variables tab). ' +
        'If you added Railway MongoDB, reference it as MONGO_URI=${{MongoDB.MONGO_URL}} ' +
        'or rely on MONGO_URL from the linked plugin.'
    );
}
