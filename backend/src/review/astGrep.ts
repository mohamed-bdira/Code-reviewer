import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Octokit } from 'octokit';
import type { ReviewBugInput } from '../enforcer/parseEnforcerResponse.js';

const SCANNABLE_EXT = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.c',
    '.h',
    '.cpp',
    '.cc',
    '.css',
    '.html',
    '.vue',
    '.svelte',
]);

export type AstGrepRuleMatch = {
    ruleId: string;
    severity: string;
    message: string;
    file: string;
    lineStart: number;
    lineEnd?: number;
};

export type RunAstGrepOnPrFilesArgs = {
    octokit: Octokit;
    repoOwner: string;
    repoName: string;
    headSha: string;
    repoRelativePaths: string[];
};

export type RunAstGrepOnPrFilesResult = {
    ok: boolean;
    skipped: boolean;
    skipReason?: string;
    matchCount: number;
    matches: AstGrepRuleMatch[];
    bugs: ReviewBugInput[];
    promptBlock: string;
    scannedFileCount: number;
    error?: string;
};

function findBundledAstGrepProjectRoot(): string | null {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
        const candidate = path.join(dir, 'ast-grep', 'sgconfig.yml');
        if (existsSync(candidate)) {
            return path.join(dir, 'ast-grep');
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function findBundledAstGrepBin(): string | null {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
        const win = path.join(dir, 'node_modules', '@ast-grep', 'cli', 'ast-grep.exe');
        const unix = path.join(dir, 'node_modules', '@ast-grep', 'cli', 'ast-grep');
        if (existsSync(win)) return win;
        if (existsSync(unix)) return unix;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

export function getAstGrepStatus(env: NodeJS.ProcessEnv = process.env): {
    bin: string;
    configDir: string | null;
    binFound: boolean;
} {
    const bin = resolveAstGrepBinFromEnv(env);
    const configDir = resolveAstGrepConfigDirFromEnv(env);
    return {
        bin,
        configDir,
        binFound: existsSync(bin),
    };
}

function resolveAstGrepBinFromEnv(env: NodeJS.ProcessEnv): string {
    const custom = env.AST_GREP_BIN?.trim();
    if (custom) return custom;
    const bundled = findBundledAstGrepBinFromCwd();
    if (bundled) return bundled;
    return process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep';
}

function findBundledAstGrepBinFromCwd(): string | null {
    const cwd = process.cwd();
    const win = path.join(cwd, 'node_modules', '@ast-grep', 'cli', 'ast-grep.exe');
    const unix = path.join(cwd, 'node_modules', '@ast-grep', 'cli', 'ast-grep');
    if (existsSync(win)) return win;
    if (existsSync(unix)) return unix;
    return findBundledAstGrepBin();
}

function resolveAstGrepConfigDirFromEnv(env: NodeJS.ProcessEnv): string | null {
    const custom = env.AST_GREP_CONFIG_DIR?.trim();
    if (custom) {
        const resolved = path.resolve(process.cwd(), custom);
        if (existsSync(path.join(resolved, 'sgconfig.yml'))) {
            return resolved;
        }
    }
    return findBundledAstGrepProjectRoot();
}

export function resolveAstGrepBin(): string {
    return resolveAstGrepBinFromEnv(process.env);
}

export function resolveAstGrepConfigDir(): string | null {
    const dir = resolveAstGrepConfigDirFromEnv(process.env);
    if (!dir && process.env.AST_GREP_CONFIG_DIR?.trim()) {
        console.warn(
            `[ast-grep] AST_GREP_CONFIG_DIR (${process.env.AST_GREP_CONFIG_DIR}) has no sgconfig.yml; using bundled rules if present.`,
        );
    }
    return dir;
}

function maxFilesFromEnv(): number {
    const n = Number(process.env.AST_GREP_MAX_FILES ?? 40);
    return Number.isFinite(n) && n > 0 ? Math.min(200, Math.floor(n)) : 40;
}

function maxFileBytesFromEnv(): number {
    const n = Number(process.env.AST_GREP_MAX_FILE_BYTES ?? 512_000);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 512_000;
}

function timeoutMsFromEnv(): number {
    const n = Number(process.env.AST_GREP_TIMEOUT_MS ?? 90_000);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90_000;
}

export function filterScannablePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of paths) {
        const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!p || seen.has(p)) continue;
        const ext = path.posix.extname(p).toLowerCase();
        if (!SCANNABLE_EXT.has(ext)) continue;
        seen.add(p);
        out.push(p);
        if (out.length >= maxFilesFromEnv()) break;
    }
    return out;
}

function severityToCategory(severity: string, ruleId: string): string {
    const s = severity.toLowerCase();
    if (s === 'error') return 'security';
    if (ruleId.includes('security') || ruleId.includes('eval') || ruleId.includes('xss')) {
        return 'security';
    }
    return 'style';
}

export function astGrepMatchesToBugs(matches: AstGrepRuleMatch[]): ReviewBugInput[] {
    return matches.map((m) => ({
        category: severityToCategory(m.severity, m.ruleId),
        file: m.file.replace(/\\/g, '/'),
        lineStart: m.lineStart,
        ...(m.lineEnd !== undefined && m.lineEnd !== m.lineStart ? { lineEnd: m.lineEnd } : {}),
        description: `[ast-grep:${m.ruleId}] ${m.message}`,
    }));
}

export function formatAstGrepPromptBlock(matches: AstGrepRuleMatch[], scannedFileCount: number): string {
    if (matches.length === 0) {
        return `Deterministic ast-grep scan: ${scannedFileCount} file(s) at PR head — no rule matches.`;
    }
    const lines = matches.slice(0, 80).map((m) => {
        const loc = m.lineEnd && m.lineEnd !== m.lineStart ? `${m.lineStart}-${m.lineEnd}` : `${m.lineStart}`;
        return `- [${m.severity}] ${m.ruleId} — ${m.file}:${loc} — ${m.message}`;
    });
    const more = matches.length > 80 ? `\n- … and ${matches.length - 80} more match(es) omitted` : '';
    return [
        `Deterministic ast-grep scan (${scannedFileCount} file(s) at PR head, ${matches.length} match(es)):`,
        'Treat these as high-confidence signals; cite them in bugs[] when still valid against the diff.',
        ...lines,
        more,
    ]
        .filter(Boolean)
        .join('\n');
}

type RawRuleMatch = {
    ruleId?: string;
    severity?: string;
    message?: string;
    file?: string;
    range?: {
        start?: { line?: number; column?: number };
        end?: { line?: number; column?: number };
    };
};

export function parseAstGrepJsonOutput(stdout: string): AstGrepRuleMatch[] {
    const trimmed = stdout.trim();
    if (!trimmed) return [];

    const matches: AstGrepRuleMatch[] = [];

    const pushRaw = (raw: RawRuleMatch, filePrefix?: string) => {
        const file = (raw.file ?? filePrefix ?? '').replace(/\\/g, '/');
        if (!file) return;
        const ruleId = typeof raw.ruleId === 'string' ? raw.ruleId : 'unknown-rule';
        const severity = typeof raw.severity === 'string' ? raw.severity : 'warning';
        const message =
            typeof raw.message === 'string' && raw.message.trim().length > 0
                ? raw.message.trim()
                : `ast-grep rule ${ruleId}`;
        const line0 = raw.range?.start?.line ?? 0;
        const lineEnd0 = raw.range?.end?.line ?? line0;
        matches.push({
            ruleId,
            severity,
            message,
            file,
            lineStart: line0 + 1,
            lineEnd: lineEnd0 + 1,
        });
    };

    if (trimmed.startsWith('[')) {
        try {
            const arr = JSON.parse(trimmed) as RawRuleMatch[];
            if (Array.isArray(arr)) {
                for (const raw of arr) {
                    pushRaw(raw);
                }
            }
        } catch {
            /* fall through to line parse */
        }
    }

    if (matches.length === 0) {
        for (const line of trimmed.split(/\r?\n/)) {
            const t = line.trim();
            if (!t.startsWith('{')) continue;
            try {
                pushRaw(JSON.parse(t) as RawRuleMatch);
            } catch {
                /* skip */
            }
        }
    }

    return matches;
}

async function fetchFileAtRef(
    octokit: Octokit,
    owner: string,
    repo: string,
    filePath: string,
    ref: string,
    maxBytes: number,
): Promise<string | null> {
    try {
        const res = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePath,
            ref,
        });
        const data = res.data;
        if (!data || Array.isArray(data) || data.type !== 'file') {
            return null;
        }
        if (typeof data.content !== 'string' || !data.encoding) {
            return null;
        }
        if (data.size != null && data.size > maxBytes) {
            return null;
        }
        const buf = Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8');
        if (buf.length > maxBytes) {
            return null;
        }
        return buf.toString('utf8');
    } catch {
        return null;
    }
}

function runAstGrepScan(bin: string, configDir: string, workDir: string, relPaths: string[]): Promise<string> {
    const configPath = path.join(configDir, 'sgconfig.yml');
    const args = ['scan', '--config', configPath, '--json=stream', ...relPaths];

    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
            cwd: workDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`ast-grep timed out after ${timeoutMsFromEnv()}ms`));
        }, timeoutMsFromEnv());

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c: Buffer) => {
            stdout += c.toString();
        });
        child.stderr.on('data', (c: Buffer) => {
            stderr += c.toString();
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0 || stdout.trim().length > 0) {
                resolve(stdout);
                return;
            }
            reject(new Error(`ast-grep exited ${code ?? '?'}: ${stderr.trim().slice(0, 500)}`));
        });
    });
}

export async function runAstGrepOnPrFiles(args: RunAstGrepOnPrFilesArgs): Promise<RunAstGrepOnPrFilesResult> {
    const empty: RunAstGrepOnPrFilesResult = {
        ok: true,
        skipped: true,
        matchCount: 0,
        matches: [],
        bugs: [],
        promptBlock: '',
        scannedFileCount: 0,
    };

    const configDir = resolveAstGrepConfigDir();
    if (!configDir) {
        return {
            ...empty,
            skipReason: 'AST_GREP_CONFIG_DIR / bundled ast-grep project not found',
        };
    }

    const scannable = filterScannablePaths(args.repoRelativePaths);
    if (scannable.length === 0) {
        return {
            ...empty,
            skipReason: 'No scannable source files in PR path list',
        };
    }

    const bin = resolveAstGrepBin();
    const maxBytes = maxFileBytesFromEnv();
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'pfe-ast-grep-'));

    try {
        const written: string[] = [];
        for (const rel of scannable) {
            const content = await fetchFileAtRef(
                args.octokit,
                args.repoOwner,
                args.repoName,
                rel,
                args.headSha,
                maxBytes,
            );
            if (content === null) continue;
            const dest = path.join(workDir, rel);
            await mkdir(path.dirname(dest), { recursive: true });
            await writeFile(dest, content, 'utf8');
            written.push(rel);
        }

        if (written.length === 0) {
            return {
                ...empty,
                skipReason: 'Could not fetch PR head file contents from GitHub',
            };
        }

        let stdout: string;
        try {
            stdout = await runAstGrepScan(bin, configDir, workDir, written);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[ast-grep] scan failed for ${args.repoOwner}/${args.repoName}: ${msg}`);
            return {
                ok: false,
                skipped: false,
                matchCount: 0,
                matches: [],
                bugs: [],
                promptBlock: `Deterministic ast-grep scan failed: ${msg}`,
                scannedFileCount: written.length,
                error: msg,
            };
        }

        const matches = parseAstGrepJsonOutput(stdout);
        const bugs = astGrepMatchesToBugs(matches);
        const promptBlock = formatAstGrepPromptBlock(matches, written.length);

        console.log(
            `[ast-grep] ${args.repoOwner}/${args.repoName} scanned ${written.length} file(s), ${matches.length} match(es)`,
        );

        return {
            ok: true,
            skipped: false,
            matchCount: matches.length,
            matches,
            bugs,
            promptBlock,
            scannedFileCount: written.length,
        };
    } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}
