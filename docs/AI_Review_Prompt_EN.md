# AI review prompt (as implemented)

Source: `backend/src/review/reviewPullRequest.ts` (assembled at runtime per pull request).

The backend builds one of **four prompt variants** from PR metadata, repository configuration (`RepoConfig`), optional ast-grep output, and the filtered unified diff. Placeholders below use `{curly braces}`; at runtime these are replaced with real values.

**Dynamic inputs**

| Placeholder | Source |
|-------------|--------|
| `{repoFullName}` | GitHub repository (`owner/name`) |
| `{prTitle}` | Pull request title |
| `{prDescription}` | Pull request body |
| `{enforcementLevel}` | `RepoConfig.enforcementLevel` (e.g. `warning`, `error`) |
| `{focusAreas}` | `RepoConfig.focusAreas` (comma-separated) |
| `{dimensionsList}` | Score section keys: defaults `security`, `style`, `usability` plus focus areas |
| `{mergeMinScore}` | `RepoConfig.mergeMinScore` |
| `{astGrepPromptLine}` | ast-grep scan summary, or a skip/disabled message |
| `{customRules}` | `RepoConfig.customRules` |
| `{diff}` | Filtered unified diff segment (or placeholder when missing) |

---

## 1. Shared header (all variants)

```text
You are a senior software engineer reviewing a pull request.
Repository: {repoFullName}
PR title: {prTitle}
PR description: {prDescription}
Enforcement level: {enforcementLevel}
Focus areas: {focusAreas}
Score sections (for final segment only; keys must be lowercase): {dimensionsList}
Merge minimum (minimum of section scores must be >= this for a green merge signal): {mergeMinScore}
{astGrepPromptLine}
Additional repository rules: {customRules}
```

---

## 2. Variant A — No diff available

Used when the diff is missing or empty after filtering.

```text
{shared header}

Diff status: missing

Provide a detailed, actionable review (architecture, edge cases, security, tone professional). {noDiffReason}. Review from title/description and general best practices only.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): {scoreKeysQuoted}. Each value is an integer from 0 to 100.
- "notes": object with the same keys as "scores"; each value is one short line explaining that score.
- "blockers": array of strings listing critical issues that must be fixed before merge; use [] if none.
- "bugs": array of objects for concrete issues to store (use [] if none). Each object: "category" (e.g. security, bug, style, usability), "file" (repo-relative path), "lineStart" and "lineEnd" (1-based line numbers if applicable), "description" (short text).

Do not put any text after the closing ``` of that JSON block.

BEGIN_DIFF
[No diff content returned by GitHub API]
END_DIFF
```

`{noDiffReason}` is either *“The code diff was not available”* or *“The unified diff was empty after PR path allowlist and DIFF_REVIEW_* filters — review from metadata only”*.

---

## 3. Variant B — Single diff segment (typical case)

Used when the full filtered diff fits in one model call.

```text
{shared header}

Diff status: single segment ({lineCount} lines)

Provide a detailed, actionable review (architecture, edge cases, security, tone professional). Prioritize findings from the code diff. Do NOT quote the diff back at me — your output is rendered next to the diff in GitHub's PR view.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): {scoreKeysQuoted}. Each value is an integer from 0 to 100.
- "notes": object with the same keys as "scores"; each value is one short line explaining that score.
- "blockers": array of strings listing critical issues that must be fixed before merge; use [] if none.
- "bugs": array of objects for concrete issues to store (use [] if none). Each object: "category" (e.g. security, bug, style, usability), "file" (repo-relative path matching the diff's b/<path>), "lineStart" and "lineEnd" (1-based line numbers, REQUIRED for inline rendering on the PR diff — pick lines that actually appear in the supplied diff hunks on the new revision side; multi-line spans use lineEnd > lineStart, single-line uses lineStart === lineEnd or omit lineEnd), "description" (short text). Bugs without anchorable lines will be downgraded to a footnote.

Do not put any text after the closing ``` of that JSON block.

BEGIN_DIFF
{diff}
END_DIFF
```

---

## 4. Variant C — Multi-segment diff (intermediate segment)

Used for segments 1 … N−1 when the diff is split into multiple passes.

```text
{shared header}

Diff status: **Segment {k}/{total}** ({lineCount} lines); this is a **partial** unified diff, not the full PR.

Analyze **only** issues evidenced in the fragment below. Do NOT invent findings for files/lines not shown here.

Provide a concise narrative, then **exactly one** fenced ```json code block containing **only** this object shape (no scores, notes, or blockers):
{"bugs":[...]}
Each bug: "category", "file", "lineStart", "lineEnd" (optional), "description". Use line numbers as they appear in this fragment's @@ hunks (new-file side).

BEGIN_DIFF
{diff}
END_DIFF
```

---

## 5. Variant D — Multi-segment diff (final segment)

Used for the last segment; includes scores for the **whole** PR.

```text
{shared header}

Diff status: **Final segment {k}/{total}** ({lineCount} lines). Earlier segments were reviewed separately; scores must reflect the **whole PR** using evidence from this segment and the context above (title, description, rules).

Provide a detailed, actionable review focused on **this** diff fragment. Prioritize findings visible here. Do NOT quote the diff back verbatim.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): {scoreKeysQuoted}. Each value is an integer from 0 to 100.
- "notes": object with the same keys as "scores"; each value is one short line explaining that score.
- "blockers": array of strings listing critical issues that must be fixed before merge; use [] if none.
- "bugs": array of objects for concrete issues **in this segment only**: "category", "file" (repo-relative, matching b/<path> in this diff), "lineStart", "lineEnd", "description".

Do not put any text after the closing ``` of that JSON block.

BEGIN_DIFF
{diff}
END_DIFF
```

---

## 6. Expected model output shape

The narrative review is followed by a single fenced JSON block. Parsed fields:

| Field | Type | Purpose |
|-------|------|---------|
| `scores` | `Record<string, number>` | Section scores 0–100 |
| `notes` | `Record<string, string>` | One-line rationale per score |
| `blockers` | `string[]` | Must-fix issues before merge |
| `bugs` | `object[]` | Persisted findings (`category`, `file`, `lineStart`, `lineEnd`, `description`) |

Parser: `backend/src/enforcer/parseEnforcerResponse.ts`.

---

## 7. Example (single segment, illustrative)

```text
You are a senior software engineer reviewing a pull request.
Repository: acme/web-app
PR title: Fix login redirect loop
PR description: Closes #42. Guard against missing session cookie.
Enforcement level: warning
Focus areas: security, style
Score sections (for final segment only; keys must be lowercase): security, style, usability
Merge minimum (minimum of section scores must be >= this for a green merge signal): 70
Deterministic ast-grep scan: disabled for this repository.
Additional repository rules: Prefer early returns; no secrets in logs.

Diff status: single segment (87 lines)

Provide a detailed, actionable review (architecture, edge cases, security, tone professional). Prioritize findings from the code diff. Do NOT quote the diff back at me — your output is rendered next to the diff in GitHub's PR view.

After your narrative review, output exactly one JSON object in a fenced code block with language tag json. Use these keys:
- "scores": object whose keys are exactly these section names (lowercase): "security", "style", "usability". Each value is an integer from 0 to 100.
…

BEGIN_DIFF
diff --git a/src/auth.ts b/src/auth.ts
…
END_DIFF
```
