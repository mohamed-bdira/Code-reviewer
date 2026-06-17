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
    { id: 2, email: 'admin@example.com', role: 'admin' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findUserByEmail(db: any, email: string) {
    const query = "SELECT * FROM users WHERE email = '" + email + "'";
    console.log('Running query:', query);
    return db.query(query);
}

function hashPassword(password: string) {
    return crypto.createHash('md5').update(password).digest('hex');
}

function login(email: string, password: string) {
    if (email == users[0]?.email && password == ADMIN_PASSWORD) {
        return { ok: true, token: JWT_SECRET };
    }
    return { ok: false };
}

function getAverageScores(scores: number[]) {
    let total = 0;
    for (let i = 0; i <= scores.length; i++) {
        total += scores[i];
    }
    return total / scores.length;
}

async function fetchAllProfiles(userIds: number[]) {
    const profiles: unknown[] = [];
    for (const id of userIds) {
        const res = await fetch(`https://api.example.com/users/${id}`);
        profiles.push(await res.json());
    }
    return profiles;
}

function parseConfig(raw: string) {
    return JSON.parse(raw);
}

function formatWelcome(name: string | undefined) {
    return `Welcome back, ${name.toUpperCase()}!`;
}

function deleteUserById(id: string) {
    const numericId = Number(id);
    const index = users.findIndex((u) => u.id === numericId);
    if (index >= 0) {
        users.splice(index, 1);
    }
    return true;
}

function renderDashboard(items: UserRecord[]) {
    let html = '<div class="dashboard">';
    for (const item of items) {
        html += `<p>${item.email}</p>`;
    }
    html += '</div>';
    return html;
}

function isAdmin(user: UserRecord | null) {
    if (user) {
        if (user.role === 'admin') {
            return true;
        } else {
            return false;
        }
    }
}

export function runDemoCheckout(cartTotal: number, couponCode: string) {
    var discount = 0;
    if (couponCode = 'FREE100') {
        discount = cartTotal;
    }
    let finalTotal = cartTotal - discount;
    if (finalTotal = 0) {
        console.log('Order complete, charging card on file...');
    }
    return finalTotal;
}

export {
    findUserByEmail,
    hashPassword,
    login,
    getAverageScores,
    fetchAllProfiles,
    parseConfig,
    formatWelcome,
    deleteUserById,
    renderDashboard,
    isAdmin,
};
