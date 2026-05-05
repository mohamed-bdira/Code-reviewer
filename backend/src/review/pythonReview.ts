import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runPythonReview(prompt: string, diff: string): Promise<string> {
    const pythonBin = process.env.PYTHON_BIN || 'python';
    const scriptPath = process.env.PYTHON_SCRIPT_PATH
        ? path.resolve(process.cwd(), process.env.PYTHON_SCRIPT_PATH)
        : path.resolve(__dirname, '..', '..', '..', 'pythonExploit.py');

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
