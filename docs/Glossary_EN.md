# Glossary

Technical terms and acronyms used in the PFE report and the AI-assisted GitHub pull request review platform (*PFE — Review findings*). Source notes refer to repository paths or report chapters.

---

## Acronyms and abbreviations

| Acronym | Definition | Source |
|---------|------------|--------|
| API | Application Programming Interface; HTTP JSON endpoints under `/api/*` on the Express backend. | `backend/src/server.ts` |
| AST | Abstract Syntax Tree; optional static analysis hook when `useAstGrep` is enabled on a repository configuration. | `backend/models/RepoConfig.ts` |
| CI/CD | Continuous Integration / Continuous Delivery; referenced in dashboard context for linking repositories to engineering workflows. | Report Ch. 1–2 |
| CORS | Cross-Origin Resource Sharing; allows the Vite SPA to call the API from a separate origin in development and production. | `backend/src/server.ts` |
| CRUD | Create, Read, Update, Delete; applied to repository configurations, API keys, and related dashboard operations. | `backend/src/routes/repoConfigs.ts` |
| FR | Functional Requirement; numbered requirement IDs (e.g. FR-07) in Chapter 2. | `docs/Chapter2_Requirements_EN.tex` |
| GUI | Graphical User Interface; the React dashboard panels. | `frontend/src/dashboard/` |
| HMAC | Hash-based Message Authentication Code; used to verify GitHub webhook payloads via `X-Hub-Signature-256`. | `backend/src/githubWebhook.ts` |
| HTTP | Hypertext Transfer Protocol; transport for REST API, webhooks, and the Python bridge outbound calls. | Deployment docs |
| HTTPS | HTTP over TLS; used for production API, frontend, and Gemini bridge requests. | `backend/.env.example` |
| IT | Information Technology. | General |
| JSON | JavaScript Object Notation; request/response bodies and structured AI output parsed by the enforcer. | `backend/src/enforcer/parseEnforcerResponse.ts` |
| JWT | JSON Web Token; session credential issued after email/password or GitHub OAuth login for protected APIs. | `backend/src/auth/tokens.ts` |
| LLM | Large Language Model; probabilistic model invoked through the Python bridge for patch analysis. | Ch. 2 §2.2 |
| NFR | Non-Functional Requirement; quality-attribute IDs (e.g. NFR-03) in Chapter 2. | `docs/Chapter2_Requirements_EN.tex` |
| NPM | Node Package Manager ecosystem; dependency and script management for backend and frontend. | `package.json` files |
| OAuth | Open Authorization; GitHub OAuth flow for sign-in (`GITHUB_OAUTH_*`). | `backend/src/routes/auth.ts` |
| ODM | Object-Document Mapper; Mongoose maps TypeScript document shapes to MongoDB collections. | `backend/models/` |
| ORM | Object-Relational Mapping; in this project the data layer is document-oriented (see ODM). | Report |
| PEM | Privacy-Enhanced Mail encoding format for the GitHub App RSA private key (`GITHUB_APP_PRIVATE_KEY`). | `backend/src/config/githubAppKey.ts` |
| PR | Pull Request; GitHub change proposal that triggers webhook-driven review. | `backend/src/githubWebhook.ts` |
| REST | Representational State Transfer; style of the HTTP API exposed by Express routes. | Report Ch. 4 |
| RSA | Public-key algorithm used for GitHub App authentication with the installation token flow. | `backend/src/github/octokit.ts` |
| SHA | Secure Hash Algorithm; commit SHAs in webhook payloads and SHA-256 dedupe keys for findings. | `backend/src/findings/` |
| SPA | Single-Page Application; React client with client-side routing. | `frontend/src/App.tsx` |
| SSE | Server-Sent Events; one-way stream from `GET /api/events` to refresh the dashboard. | `backend/src/routes/events.ts` |
| UI | User Interface. | `frontend/` |
| URI | Uniform Resource Identifier; MongoDB connection string, OAuth redirect URIs, API base URLs. | `backend/.env.example` |

---

## Technical terms

| Term | Definition | Source |
|------|------------|--------|
| AI-assisted review | Automated pull request analysis orchestrated by the backend: diff fetch, filtering, segmentation, Python bridge invocation, parsing, persistence, and optional GitHub posting. AI advises; humans retain merge authority. | `backend/src/review/reviewPullRequest.ts`; Ch. 2 §2.2 |
| AI foundation | The set of AI capabilities, constraints, and guardrails (probabilistic output, hallucination risk, payload limits) that shape requirements and architecture. | Ch. 2 §2.2 |
| API key | Operator-issued credential with `pfe_` prefix; only a bcrypt hash is stored. Optional gate `REQUIRE_API_KEY_FOR_REVIEWS` for automated review execution. | `backend/src/auth/apiKeys.ts` |
| Assistive reviewer | Role assigned to the AI in the platform: embedded in the GitHub App workflow, not a standalone merge authority. | Ch. 2 §2.2.1 |
| Bug scan | Scheduled workflow that re-scans open pull requests for configured repositories (`scheduler/bugScan.ts`). | `backend/src/scheduler/bugScan.ts` |
| Code review | Human or automated examination of a change set; this platform automates review assistance and posts structured feedback to GitHub when configured. | Report; `githubPostingStrategy.ts` |
| Conservative publication logic | Posting strategy that caps review body size, inline comment count, and payload estimates to avoid GitHub secondary rate limits. | `backend/src/review/githubPostingStrategy.ts`; Ch. 2 §2.2.3 |
| Context window | Practical limit on how much diff text a language model can analyze per invocation; motivates segmentation and filtering. | Ch. 2 §2.2.2; `DIFF_MAX_FOR_AI` |
| Dedupe key | SHA-256 hash identifying a finding across review runs; used for upsert and `lastSeenAt` updates. | `backend/src/findings/upsertPrReviewFindings.ts` |
| Diff hunk | Contiguous region of a unified diff (file and line range) used to map findings to inline GitHub review comments. | `backend/src/github/diffHunks.ts` |
| Diff preprocessing and filtering | Removal of noise from PR patches (lockfiles, excluded paths, path prefixes) before AI analysis. | `backend/src/review/filterUnifiedDiffForReview.ts` |
| End-to-end review pipeline | Flow from PR event on GitHub through webhook, review service, persistence, publication, and dashboard notification. | Ch. 2 §2.9 |
| Enforcement level | Repository policy severity: `warning` or `error`, stored on `RepoConfig`. | `backend/models/RepoConfig.ts` |
| Enforcer | Parser that converts the AI bridge JSON-shaped response into scores, blockers, bugs, and merge-readiness fields. | `backend/src/enforcer/parseEnforcerResponse.ts` |
| Express | Node.js HTTP framework hosting REST routes, webhook raw body handling, and middleware. | `backend/src/server.ts` |
| External dependency risk | Operational risk from model provider availability, latency, and rate limits affecting review quality. | Ch. 2 §2.2.2 |
| Finding | Structured review issue (category, file path, description) persisted as `PrReviewFinding` and shown in the dashboard. | `backend/models/PrReviewFinding.ts` |
| Focus areas | Tags on `RepoConfig` directing review emphasis (e.g. security, style, usability, custom). | `backend/models/RepoConfig.ts` |
| Functional requirement | Statement of what the system must do (FR-01–FR-16 in Chapter 2). | Ch. 2 §2.4 |
| GitHub App | GitHub integration registered as an App: installation tokens, webhooks, and repository access via Octokit. | `GITHUB_APP_*`; `backend/src/github/octokit.ts` |
| GitHub App installation | Link between a user account and an installed App instance on a GitHub account or organization. | `backend/models/Installation.ts` |
| Google Gemini | Large language model accessed through the project Python script stream endpoint (not framed as official Google Cloud SDK integration). | `backend/scripts/pythonExploit.py` |
| Guardrails | Safeguards around AI: diff filtering, segmentation, retry/backoff, structured parsing, findings persistence, conservative GitHub posting. | Ch. 2 §2.2.3 |
| Hallucination | Model output that plausibly claims a defect that is incorrect or not supported by the diff. | Ch. 2 §2.2.2 |
| HMAC signature validation | Comparison of computed HMAC-SHA256 digest with `X-Hub-Signature-256` using a timing-safe equal check. | `backend/src/githubWebhook.ts` |
| Inline review comment | GitHub review comment anchored to a file and line, derived from finding locations and diff hunks. | `backend/src/github/diffHunks.ts` |
| Iterative methodology | Incremental delivery through planning, implementation, integration, validation, and feedback cycles. | Ch. 2 §2.3 |
| Lockfile filtering | Exclusion of dependency lockfiles from the diff sent to the AI to reduce noise and segment count. | `filterUnifiedDiffForReview.ts`; `DIFF_REVIEW_SKIP_LOCKFILES` |
| Merge minimum score | Integer 0–100 on `RepoConfig`; threshold used with enforcer scores for merge readiness. | `backend/models/RepoConfig.ts` |
| Merge readiness | Evaluation of whether a PR meets configured score and blocker rules, including security veto logic. | `backend/src/enforcer/parseEnforcerResponse.ts` |
| MongoDB | Document database storing users, installations, configurations, API keys, and findings. | `backend/models/`; `MONGO_URI` |
| Mongoose | ODM library defining schemas, indexes, and models for MongoDB collections. | `backend/models/*.ts` |
| Multi-tenant | Logical isolation of each operator's installations, configurations, keys, and findings via `userId`. | Ch. 2 class diagram |
| Non-functional requirement | Quality-attribute requirement (security, reliability, performance, etc.; NFR-01–NFR-14). | Ch. 2 §2.5 |
| Octokit | Official GitHub REST client used for diffs, reviews, and installation-authenticated API calls. | `backend/src/github/octokit.ts` |
| Payload limitations | Constraint that large PR diffs exceed model context; addressed by filtering and segmentation. | Ch. 2 §2.2.2 |
| PFE review platform | The full-stack system documented in this report (repository *Code-reviewer*, title *PFE — Review findings*). | Report introduction |
| Posting strategy | Component that decides how review summaries and inline comments are packaged and sent to GitHub within size limits. | `backend/src/review/githubPostingStrategy.ts` |
| Probabilistic output | Non-deterministic model responses that may differ for similar inputs across runs. | Ch. 2 §2.2.2 |
| Pull request | GitHub mechanism to propose and review code changes; webhook actions `opened` and `synchronize` trigger review. | `backend/src/githubWebhook.ts` |
| Python bridge | Node.js subprocess (`pythonExploit.py`) that sends prompts and diff segments to the Gemini stream endpoint. | `backend/src/review/pythonReview.ts` |
| Rate limiting | Throttling and retries on AI HTTP errors (429/502/503/504) and GitHub secondary rate limits on review creation. | `.env.example`; `pythonReview.ts` |
| React | JavaScript UI library for the operator dashboard and authentication pages. | `frontend/src/` |
| Repo configuration (RepoConfig) | Per-repository policy document: focus areas, enforcement level, custom rules, merge minimum score, optional AST-grep flag. | `backend/models/RepoConfig.ts` |
| Retry with backoff | Exponential or stepped delay between retries on transient AI or GitHub API failures. | `backend/src/review/pythonReview.ts` |
| Scheduled scan | Same as bug scan; periodic re-review of open PRs per configured repository. | `SchedulePanel.tsx` |
| Segmentation | Splitting a filtered unified diff into bounded chunks for sequential AI calls, with caps on segment size and count. | `filterUnifiedDiffForReview.ts`; Ch. 2 §2.2.3 |
| Server-Sent Events | Browser `EventSource` subscription to `/api/events` for live dashboard updates after backend events. | `frontend/src/dashboard/useEventStream.ts` |
| Structured parsing | Extracting JSON from model output and normalizing it before upserting findings or posting reviews. | `parseEnforcerResponse.ts`; Ch. 2 §2.2.3 |
| Unified diff | Textual patch format returned by GitHub for a PR; filtered and segmented before AI analysis. | `backend/src/github/fetchPrDiff.ts` |
| Vite | Frontend build tool and dev server for the React SPA. | `frontend/vite.config.ts` |
| Webhook | HTTP callback from GitHub to `POST /api/webhooks/github` carrying `pull_request` events. | `backend/src/githubWebhook.ts` |
