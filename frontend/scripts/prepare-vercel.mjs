/**
 * On Vercel, writes vercel.json so /api/* proxies to the Railway backend.
 * Set VITE_API_BASE_URL on Vercel to your Railway URL (build-time only for the proxy target).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const backend = (process.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');
const onVercel = process.env.VERCEL === '1';

const rewrites = [];

if (onVercel && backend) {
    rewrites.push({
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
    });
    console.log(`[prepare-vercel] Proxy /api/* → ${backend}/api/*`);
} else if (onVercel && !backend) {
    console.warn(
        '[prepare-vercel] WARNING: VITE_API_BASE_URL is not set on Vercel. ' +
            'Login and GitHub sign-in will 404 until you add it and redeploy.',
    );
}

rewrites.push({ source: '/(.*)', destination: '/index.html' });

writeFileSync(join(root, 'vercel.json'), `${JSON.stringify({ rewrites }, null, 2)}\n`, 'utf8');
