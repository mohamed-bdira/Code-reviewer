import { createHash } from 'node:crypto';

/** Minimum security score when a `security` dimension is present; below this, merge is not recommended. */
export const SECURITY_VETO_THRESHOLD = 50;

const DEFAULT_DIMENSIONS = ['security', 'style', 'usability'] as const;

export type ReviewBugInput = {
    category: string;
    file: string;
    lineStart?: number;
    lineEnd?: number;
    description: string;
};

export type EnforcerPayload = {
    scores: Record<string, number>;
    notes: Record<string, string>;
    blockers: string[];
    bugs: ReviewBugInput[];
};

export function buildScoreDimensions(focusAreas: string[]): string[] {
    const set = new Set<string>();
    for (const d of DEFAULT_DIMENSIONS) {
        set.add(d);
    }
    for (const raw of focusAreas) {
        const k = String(raw).trim().toLowerCase();
        if (k) {
            set.add(k);
        }
    }
    return [...set].sort();
}

function clampScore(n: unknown): number {
    if (typeof n !== 'number' || Number.isNaN(n)) {
        return 0;
    }
    return Math.min(100, Math.max(0, Math.round(n)));
}

/** Extract JSON object from last ```json ... ``` fence, else balanced `{`…`}` from the end. */
export function extractJsonObjectString(raw: string): { jsonStr: string; fullMatchEnd: number; fullMatchStart: number } | null {
    const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    let lastFence: { jsonStr: string; fullMatchStart: number; fullMatchEnd: number } | null = null;
    let m: RegExpExecArray | null;
    while ((m = fencePattern.exec(raw)) !== null) {
        const inner = m[1] ?? '';
        lastFence = {
            jsonStr: inner.trim(),
            fullMatchStart: m.index,
            fullMatchEnd: m.index + m[0].length,
        };
    }
    if (lastFence) {
        return lastFence;
    }

    const start = raw.lastIndexOf('{');
    if (start === -1) {
        return null;
    }
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < raw.length; i++) {
        const c = raw[i];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (c === '\\') {
                escape = true;
            } else if (c === '"') {
                inString = false;
            }
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) {
                return {
                    jsonStr: raw.slice(start, i + 1),
                    fullMatchStart: start,
                    fullMatchEnd: i + 1,
                };
            }
        }
    }
    return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clampNonNegInt(n: unknown): number | undefined {
    if (typeof n !== 'number' || Number.isNaN(n) || !Number.isFinite(n)) {
        return undefined;
    }
    const r = Math.round(n);
    return r < 0 ? 0 : r;
}

function parseBugsArray(raw: unknown): ReviewBugInput[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: ReviewBugInput[] = [];
    for (const item of raw) {
        if (!isPlainObject(item)) {
            continue;
        }
        const file = typeof item.file === 'string' ? item.file.trim() : '';
        const description = typeof item.description === 'string' ? item.description.trim() : '';
        if (!file || !description) {
            continue;
        }
        let category = typeof item.category === 'string' ? item.category.trim().toLowerCase() : '';
        if (!category) {
            category = 'general';
        }
        const lineStart = clampNonNegInt(item.lineStart);
        const lineEnd = clampNonNegInt(item.lineEnd);
        if (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart) {
            continue;
        }
        const row: ReviewBugInput = {
            category,
            file,
            description,
        };
        if (lineStart !== undefined) {
            row.lineStart = lineStart;
        }
        if (lineEnd !== undefined) {
            row.lineEnd = lineEnd;
        }
        out.push(row);
    }
    return out;
}

export function parseEnforcerPayload(obj: unknown): EnforcerPayload | null {
    if (!isPlainObject(obj)) {
        return null;
    }
    const scoresRaw = obj.scores;
    if (!isPlainObject(scoresRaw)) {
        return null;
    }
    const scores: Record<string, number> = {};
    for (const [k, v] of Object.entries(scoresRaw)) {
        const key = k.trim().toLowerCase();
        scores[key] = clampScore(v);
    }
    if (Object.keys(scores).length === 0) {
        return null;
    }

    const notes: Record<string, string> = {};
    if (isPlainObject(obj.notes)) {
        for (const [k, v] of Object.entries(obj.notes)) {
            notes[k.trim().toLowerCase()] = typeof v === 'string' ? v : String(v);
        }
    }

    let blockers: string[] = [];
    if (Array.isArray(obj.blockers)) {
        blockers = obj.blockers.filter((b) => typeof b === 'string' && b.trim().length > 0).map((b) => b.trim());
    }

    const bugs = parseBugsArray(obj.bugs);

    return { scores, notes, blockers, bugs };
}

export type MergeEvaluation = {
    mergeRecommended: boolean;
    overall: number;
    reasons: string[];
};

export function evaluateMergeReadiness(
    data: EnforcerPayload,
    mergeMinScore: number,
    securityVetoThreshold: number = SECURITY_VETO_THRESHOLD,
): MergeEvaluation {
    const values = Object.values(data.scores);
    const overall = values.length ? Math.min(...values) : 0;
    const reasons: string[] = [];

    if (data.blockers.length > 0) {
        reasons.push(`Blockers present (${data.blockers.length}): policy requires resolution before merge.`);
    }
    if (overall < mergeMinScore) {
        reasons.push(`Overall score ${overall} is below minimum ${mergeMinScore} (minimum of section scores).`);
    }
    if (Object.prototype.hasOwnProperty.call(data.scores, 'security')) {
        const sec = data.scores['security'];
        if (typeof sec === 'number' && sec < securityVetoThreshold) {
            reasons.push(`Security score ${sec} is below veto threshold ${securityVetoThreshold}.`);
        }
    }

    const mergeRecommended = reasons.length === 0;
    return { mergeRecommended, overall, reasons };
}

/** Stable id for deduplicating the same logical finding across webhook/scheduled runs. */
export function findingDedupeKey(args: {
    repoFullName: string;
    prNumber: number;
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    description: string;
}): string {
    const normPath = args.filePath.replace(/\\/g, '/').trim().toLowerCase();
    const normDesc = args.description.replace(/\s+/g, ' ').trim().toLowerCase();
    const lineA = args.lineStart !== undefined ? String(args.lineStart) : '';
    const lineB = args.lineEnd !== undefined ? String(args.lineEnd) : '';
    const payload = `${args.repoFullName}|${args.prNumber}|${normPath}|${lineA}|${lineB}|${normDesc}`;
    return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function bugRowsForDb(
    bugs: ReviewBugInput[],
    repoFullName: string,
    prNumber: number,
): Array<{
    repoFullName: string;
    prNumber: number;
    category: string;
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    linesAffected?: number;
    description: string;
}> {
    return bugs.map((b) => {
        const row: {
            repoFullName: string;
            prNumber: number;
            category: string;
            filePath: string;
            lineStart?: number;
            lineEnd?: number;
            linesAffected?: number;
            description: string;
        } = {
            repoFullName,
            prNumber,
            category: b.category,
            filePath: b.file,
            description: b.description,
        };
        if (b.lineStart !== undefined) {
            row.lineStart = b.lineStart;
        }
        if (b.lineEnd !== undefined) {
            row.lineEnd = b.lineEnd;
        }
        if (b.lineStart !== undefined && b.lineEnd !== undefined) {
            row.linesAffected = b.lineEnd - b.lineStart + 1;
        }
        return row;
    });
}

export type ParsedEnforcerResult = {
    data: EnforcerPayload | null;
    prose: string;
    parseError: string | null;
};

export function parseEnforcerResponse(raw: string): ParsedEnforcerResult {
    const extracted = extractJsonObjectString(raw);
    if (!extracted) {
        return {
            data: null,
            prose: raw.trim(),
            parseError: 'No JSON block found in model output.',
        };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(extracted.jsonStr);
    } catch {
        return {
            data: null,
            prose: raw.trim(),
            parseError: 'JSON in fence could not be parsed.',
        };
    }

    const data = parseEnforcerPayload(parsed);
    if (!data) {
        return {
            data: null,
            prose: raw.trim(),
            parseError: 'JSON did not match enforcer shape (scores required).',
        };
    }

    const head = raw.slice(0, extracted.fullMatchStart).trim();
    const tail = raw.slice(extracted.fullMatchEnd).trim();
    const prose = [head, tail].filter(Boolean).join('\n\n').trim();

    return {
        data,
        prose,
        parseError: null,
    };
}

function escapeCell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatEnforcerReviewSummary(options: {
    enforcementLevel: 'warning' | 'error';
    mergeRecommended: boolean;
    overall: number;
    mergeMinScore: number;
    data: EnforcerPayload | null;
    prose: string;
    reasons: string[];
    parseError: string | null;
    orphanBugs?: ReviewBugInput[];
    findingsRecorded?: number | null;
    inlineCommentsPosted?: number;
}): string {
    const lines: string[] = [];
    lines.push('## Automated review (enforcer)');
    lines.push('');

    if (!options.mergeRecommended) {
        if (options.enforcementLevel === 'error') {
            lines.push('**Not ready to merge per policy** (thresholds or blockers not satisfied).');
        } else {
            lines.push('**Merge not recommended** (see scores and notes below).');
        }
        lines.push('');
    } else {
        lines.push('**Ready to merge** from an automated scoring perspective (still use human judgment).');
        lines.push('');
    }

    if (options.parseError) {
        lines.push(`> ⚠️ Structured scores unavailable: ${options.parseError}`);
        lines.push('');
    }

    if (options.data) {
        lines.push(`**Overall (min of sections):** ${options.overall} — **Minimum bar:** ${options.mergeMinScore}`);
        lines.push('');
        lines.push('| Section | Score | Note |');
        lines.push('| --- | ---: | --- |');
        const keys = Object.keys(options.data.scores).sort();
        for (const k of keys) {
            const note = options.data.notes[k] ?? '—';
            lines.push(`| ${escapeCell(k)} | ${options.data.scores[k]} | ${escapeCell(note)} |`);
        }
        lines.push('');
        if (options.data.blockers.length > 0) {
            lines.push('**Blockers:**');
            for (const b of options.data.blockers) {
                lines.push(`- ${b}`);
            }
            lines.push('');
        }
    }

    if (options.reasons.length > 0) {
        lines.push('**Why merge may be blocked:**');
        for (const r of options.reasons) {
            lines.push(`- ${r}`);
        }
        lines.push('');
    }

    if (options.inlineCommentsPosted != null && options.inlineCommentsPosted > 0) {
        lines.push(`_${options.inlineCommentsPosted} inline finding(s) posted on the diff below._`);
        lines.push('');
    }

    if (options.orphanBugs && options.orphanBugs.length > 0) {
        lines.push('### Findings without a diff anchor');
        lines.push('');
        lines.push('_These bugs lack a line that exists in the current diff hunks; review the file directly._');
        lines.push('');
        lines.push('| Category | File | Lines | Description |');
        lines.push('| --- | --- | --- | --- |');
        for (const b of options.orphanBugs) {
            const linesCol =
                b.lineStart !== undefined || b.lineEnd !== undefined
                    ? `${b.lineStart ?? '—'}–${b.lineEnd ?? '—'}`
                    : '—';
            lines.push(`| ${escapeCell(b.category)} | ${escapeCell(b.file)} | ${escapeCell(linesCol)} | ${escapeCell(b.description)} |`);
        }
        lines.push('');
    }

    if (options.prose) {
        lines.push('### Review');
        lines.push('');
        lines.push(options.prose);
    }

    if (options.findingsRecorded != null) {
        lines.push('');
        lines.push(`_${options.findingsRecorded} finding(s) recorded for this PR._`);
    }

    return lines.join('\n');
}
