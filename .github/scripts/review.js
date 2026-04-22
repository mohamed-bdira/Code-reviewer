const { spawn } = require('child_process');
const path = require('path');

function askWithPythonExploit(prompt, pythonBin) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(process.cwd(), 'pythonExploit.py');
        const child = spawn(pythonBin, [scriptPath], {
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`pythonExploit.py timed out (${pythonBin})`));
        }, 120000);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timeout);

            if (code !== 0) {
                reject(new Error(`pythonExploit.py exited ${code}: ${stderr || stdout}`));
                return;
            }

            const normalized = stdout.replace(/\r/g, '');
            const botIndex = normalized.lastIndexOf('Bot:');
            if (botIndex === -1) {
                reject(new Error(`No Bot output found. Raw output: ${normalized}`));
                return;
            }

            const afterBot = normalized.slice(botIndex + 4);
            const nextPromptIndex = afterBot.indexOf('\nYou:');
            const message = (nextPromptIndex >= 0 ? afterBot.slice(0, nextPromptIndex) : afterBot).trim();
            resolve(message || '[No response]');
        });

        child.stdin.write(`${prompt}\nexit\n`);
        child.stdin.end();
    });
}

async function askModel(prompt) {
    const bins = [process.env.PYTHON_BIN, 'python3', 'python'].filter(Boolean);
    let lastError = null;

    for (const bin of bins) {
        try {
            return await askWithPythonExploit(prompt, bin);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('No usable Python interpreter found.');
}

module.exports = async ({ github, context }) => {
    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    console.log(`Reviewing PR #${prNumber} for ${owner}/${repo}`);

    try {
        const { data: files } = await github.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: prNumber,
        });

        let finalReviewComment = '🤖 **AI Code Review (File by File):**\n\n';
        let filesReviewed = 0;

        for (const file of files) {
            if (
                file.status === 'removed' ||
                !file.patch ||
                file.filename.endsWith('.lock') ||
                file.filename.includes('package-lock.json')
            ) {
                console.log(`Skipping ${file.filename} (irrelevant or deleted)`);
                continue;
            }

            if (file.patch.length > 20000) {
                console.log(`Skipping ${file.filename} (diff too large)`);
                finalReviewComment += `### 📁 \`${file.filename}\`\n⚠️ *File diff too large to review automatically.*\n\n`;
                continue;
            }

            console.log(`Analyzing ${file.filename}...`);

            const prompt = `
You are a senior software engineer reviewing a pull request.
Review the following code changes for the file: ${file.filename}.

Focus only on:
- Critical bugs
- Security vulnerabilities
- Major performance issues

Rules:
- Do NOT comment on styling, formatting, or missing comments.
- If the code looks good and has no critical issues, strictly reply with: "✅ No critical issues found."
- Keep your review concise and format it in Markdown.

Here is the diff:
${file.patch}
            `.trim();

            const aiReview = await askModel(prompt);

            finalReviewComment += `### 📁 \`${file.filename}\`\n${aiReview}\n\n`;
            filesReviewed++;

            await new Promise((resolve) => setTimeout(resolve, 4000));
        }

        if (filesReviewed === 0) {
            console.log('No valid code files to review in this PR');
            return;
        }

        console.log('Posting combined review to GitHub...');
        await github.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: finalReviewComment,
        });
    } catch (error) {
        console.error('An error occurred during the review process', error);
    }
};