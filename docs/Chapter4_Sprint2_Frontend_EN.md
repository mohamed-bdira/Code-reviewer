# Chapter 4 — Sprint 2: Frontend Development and Cloud Deployment

## 4.3.1 Dashboard composition and routing

Sprint 2 delivered the operator-facing **React single-page application** (SPA) under `frontend/src`. The shell is **`DashboardApp`**, which combines a persistent **sidebar**, a **section header**, and **panel** content switched by URL. Public authentication pages (`LoginPage`, `RegisterPage`, `AuthFinishPage`) sit outside the dashboard.

**Figure 4.3 — Frontend view hierarchy (as implemented).**

```
AuthProvider
└── BrowserRouter
    ├── /login, /register, /auth/finish  →  auth pages
    └── RequireAuth
        └── DashboardUnlockGate
            └── DashboardApp  (sidebar + header + active panel)
                ├── OverviewPanel          (path: /)
                ├── GithubPanel            (path: /github)
                ├── ConfigurationsPanel    (path: /configurations)
                ├── SchedulePanel          (path: /schedule)
                ├── FindingsPanel          (path: /findings)
                └── KeysPanel              (path: /keys)
```

**Table 4.3 — Dashboard sections and source files.**

| Section (UI label) | Route | Panel component | Primary responsibility |
|--------------------|-------|-----------------|------------------------|
| Overview | `/` | `OverviewPanel` | Aggregated dashboard summary (`GET /api/dashboard/summary`) |
| GitHub & CI | `/github` | `GithubPanel` | Installations, webhook metadata, connection state |
| Configurations | `/configurations` | `ConfigurationsPanel` | Create/edit/delete `RepoConfig` documents per repository |
| Scheduled scan | `/schedule` | `SchedulePanel` | Scheduled bug-scan settings (env-driven backend scheduler) |
| Bug findings | `/findings` | `FindingsPanel` | Filterable, paginated findings table |
| API keys | `/keys` | `KeysPanel` | Create and revoke API keys; unlock dashboard access |

Routing is declared in `frontend/src/App.tsx`. Each dashboard path renders the same nested tree: `RequireAuth` → `DashboardUnlockGate` → `DashboardApp`.

### Authentication gates

**`RequireAuth`** intercepts navigation when no authenticated **user** is available. While `AuthContext` is still validating a stored JWT (`initializing`), the component shows a loading state. If validation fails or no session exists, React Router redirects to `/login` with a preserved `next` query parameter (`sanitizePostLoginPath`).

**`DashboardUnlockGate`** adds a second gate for dashboard API calls: after sign-in, most sections require a **service API key** stored in `localStorage` (`pfe.serviceKey`). The `/keys` route is always reachable so the operator can create a key and paste it to unlock the rest of the dashboard. This matches backend expectations where many endpoints accept either the session JWT or a user API key (see `pickBearerToken` in `apiFetch.ts`).

On **401** responses, `apiFetch` invokes `setOnUnauthorized`, which triggers `logout()` in `AuthContext` (clears token, service key, and user). Subsequent renders of `RequireAuth` then redirect unauthenticated users to `/login`.

## 4.3.2 Presentation layer and shared patterns

Visual styling uses **Tailwind CSS v4** utility classes and design tokens defined in `frontend/src/index.css` (for example `bg-bg`, `bg-surface`, `bg-elevated`, `text-muted`, `border-line`, `text-accent`). The approach keeps spacing and hierarchy consistent without maintaining separate global stylesheets.

The codebase does **not** extract a standalone component library (`PrimaryButton`, `StatusBadge`, `DataTable`, `ModalOverlay`). Instead, panels reuse the same Tailwind patterns inline:

- **Buttons:** accent-filled primary actions and bordered secondary actions, with `disabled:` opacity and `transition-colors` on hover.
- **Tables:** `FindingsPanel` renders a semantic `<table>` with `border-line`, header row on `bg-elevated`, and `hover:bg-elevated` on body rows (theme tokens, not fixed alternating hex colors).
- **Modals:** `ConfigurationsPanel` defines a local `AddRepoModal` component; destructive actions often use `window.confirm` rather than a global overlay primitive.
- **Live updates:** `useEventStream` opens an authenticated **Server-Sent Events** connection to `GET /api/events`. Event types include `finding-created`, `finding-updated`, `repo-config-updated`, and `installation-linked`; `DashboardApp` refreshes the summary when relevant events arrive.

### Date and text formatting

`frontend/src/dashboard/formatters.ts` exposes `formatIso`, which converts ISO timestamps from the API (`firstSeenAt`, `lastSeenAt`, and similar fields) to locale-aware strings via `Date#toLocaleString()`. The SPA does not use `Intl.RelativeTimeFormat` for relative phrases such as “5 minutes ago”.

Finding **descriptions** are shown as plain text in the dashboard. **Markdown** generation and truncation for GitHub review bodies are handled on the **backend** (`reviewPullRequest.ts`, `githubPostingStrategy.ts`), not by a frontend markdown renderer.

## 4.3.3 Centralized API access

All SPA-to-backend communication goes through a single module, **`frontend/src/auth/apiFetch.ts`**, built on the browser **`fetch` API** (not Axios). Domain-specific wrappers in `frontend/src/api/` (`auth.ts`, `dashboard.ts`, `findings.ts`, `keys.ts`, `installations.ts`, `repoConfigs.ts`) call `apiFetch` so view components stay free of low-level HTTP details.

**Table 4.4 — Responsibilities of the centralized `apiFetch` layer.**

| Capability | Implementation |
|------------|----------------|
| Base URL | `VITE_API_BASE_URL` at build time; empty base in local dev relies on the Vite proxy to the backend. `getApiBaseUrl()` and `isApiConfiguredForDeploy()` support deployment checks. |
| Authentication | `Authorization: Bearer …` attached automatically. Login/register omit the header. `/api/keys` uses the session JWT only; other routes prefer the stored **service API key** when present, otherwise the session JWT. |
| Errors | Non-OK responses parse JSON `{ error: string }` when available; network failures return actionable messages (missing `VITE_API_BASE_URL`, CORS hints). |
| Session expiry | HTTP **401** calls the registered `onUnauthorized` handler (wired to `logout` in `AuthContext`). |
| Content type | JSON bodies set `Content-Type: application/json`; responses expect `Accept: application/json`. |

**Example — bearer selection (simplified):**

```typescript
// apiFetch.ts — service key preferred for most API paths after unlock
function pickBearerToken(path: string): string | null {
    if (path.startsWith('/api/auth/register') || path.startsWith('/api/auth/login')) return null;
    if (path.startsWith('/api/keys')) return getStoredToken();
    return getStoredServiceKey() ?? getStoredToken();
}
```

This design gives one configuration point for production (Vercel frontend → Railway API) and development (proxy), while keeping panels focused on operator workflows rather than HTTP plumbing.

## 4.3.4 Relation to the backend stack

The SPA targets the **Express 5** API (`backend/package.json`). Sprint 2 deployment assumes the frontend build exposes `VITE_API_BASE_URL` to the hosted API origin; the backend enforces JWT and API-key auth via `requireAuth` / `requireSession` middleware. Together, the gates in §4.3.1 and the client in §4.3.3 implement defense in depth: route-level protection in React and credential validation on every API request.
