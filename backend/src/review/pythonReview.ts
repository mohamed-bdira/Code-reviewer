import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findBundledPythonExploit(): string | null {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
        const candidate = path.join(dir, 'scripts', 'pythonExploit.py');
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function resolvePythonScriptPath(): string {
    const cwd = process.cwd();
    const envRaw = process.env.PYTHON_SCRIPT_PATH?.trim() ?? '';
    const envResolved = envRaw ? path.resolve(cwd, envRaw) : '';
    if (envResolved && existsSync(envResolved)) {
        return envResolved;
    }
    const bundled = findBundledPythonExploit();
    if (bundled) {
        if (envResolved && !existsSync(envResolved)) {
            console.warn(
                `[pythonReview] PYTHON_SCRIPT_PATH (${envResolved}) does not exist; using ${bundled}`,
            );
        }
        return bundled;
    }
    return path.resolve(cwd, 'scripts', 'pythonExploit.py');
}

export function runPythonReview(prompt: string, diff: string): Promise<string> {
    const pythonBin = process.env.PYTHON_BIN || 'python';
    const scriptPath = resolvePythonScriptPath();

    return new Promise((resolve, reject) => {
        const child = spawn(pythonBin, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
            },
        });

        const timeoutMs = 90_000;
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`python review timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            const output = stdout.trim();

            if (code === 0 && output) {
                resolve(output);
                return;
            }

            if (output) {
                console.warn('Python review returned non-zero status, using fallback output:', stderr.trim());
                resolve(output);
                return;
            }

            reject(new Error(`python review failed with code ${code}. stderr: ${stderr.trim()}`));
        });

        child.stdin.write(JSON.stringify({ prompt, diff }));
        child.stdin.end();
    });
}
