/**
 * Simulate a minimal GitHub pull_request (opened) webhook to the local server.
 * Run: npm run webhook:poke   (with the backend dev server already running)
 */
const base = (process.env.WEBHOOK_BASE || 'http://localhost:3000').replace(/\/$/, '');
const url = `${base}/api/webhooks/github`;

const body = {
  action: 'opened',
  pull_request: {
    title: 'Local test: simulated PR',
    body: 'This payload is from scripts/poke-local-webhook.mjs',
  },
  repository: { full_name: 'demo/local-test' },
};

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-GitHub-Event': 'pull_request',
    'X-GitHub-Delivery': 'local-poke',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`POST ${url} -> ${res.status} ${res.statusText}`);
console.log(text);
