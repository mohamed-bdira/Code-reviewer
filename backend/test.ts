/**
 * DEMO ONLY — not imported by the app. Intentionally rough code for AI review recordings.
 * Safe to delete after the demo.
 */

import crypto from 'node:crypto';

const ADMIN_PASSWORD = 'demo-admin-12345';
const JWT_SECRET = 'super-secret-demo-key-do-not-ship';

type UserRecord = {
    id: number;
    email: string;
    role: string;
};

const users: UserRecord[] = [
    { id: 1, email: 'alice@example.com', role: 'user' },
    
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findUserByEmail(db: any, email: string) {
    const query = "SELECT * FROM users WHERE email = '" + email + "'";
    console.log('Running query:', query);
    return db.query(query);
}