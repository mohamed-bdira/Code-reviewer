const {GoogleGenerativeAI} = require('@google/generative-ai');

module.exports = async ({github, context}) =>{

    //Init gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});

    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    console.log(`Reviewing PR #${prNumber} for ${owner}/${repo}`);

    //Fetch the list of individual files in the PR
    try{
        const {data: files} = await github.rest.pulls.listFiles({
            owner: owner,
            repo: repo,
            pull_number: prNumber,
        });

        let finalReviewComment = "🤖 **Gemini Code Review (File by File):**\n\n";
        let filesReviewed = 0;

        //Loop through each file
        for(const file of files){
            //Skip deleted files, lockfiles, or files without code changes
            if(file.status === 'removed' || !file.patch || file.filename.endsWith('.lock') || file.filename.includes('package-lock.json')){
                console.log(`Skipping ${file.filename} (irrelevant or deleted)`);
                continue;
            }

            if (file.patch.length > 20000){
                console.log(`Skipping ${file.filename} (too large brev)`);
                finalReviewComment += `### 📁 \`${file.filename}\`\n⚠️ *File diff too large to review automatically.*\n\n`;
                continue;
            }

            console.log(`Analyzing ${file.filename}...`);

            //Da Prompt
            const prompt = `
            you are a senior software engineer reviewing a pull request.
            Review the following code changes for the file: ${file.filename}.

            Focus Only on:
            - Critical bugs
            - Security vulnerabilities
            - Major performance issues

            Rules:
            -Do NOT comment on styling, formatting, or missing comments.
            -If the code looks good and has no critical issues, strictly reply with: "✅ No critical issues found."
            -Keep your review concise and format it in Markdown.

            Here is the diff:
            ${file.patch}
            `;

            //To Gemini it goes brev

            const result = await model.generateContent(prompt);
            const aiReview = result.response.text().trim();

            //Append the result to da master comment
            finalreviewComment += `### 📁 \`${file.filename}\`\n${aiReview}\n\n`;
            filesReviwed++;

            //Free tier gemini gives 1 request every 4 seconds so we pause the loop for 4 seconds so we don't spam
            await new Promise(resoleve => setTimeout(resoleve, 4000));
        }

        if(filesReviewed === 0){
            console.log("No valid code files to review in this PR");
            return;
        }

        //Post the complided review to github
        console.log("Posting combined review to github...");
        await github.rest.issues.createComment({
            owner: owner,
            repo: repo,
            issue_number: prNumber,
            body: finalReviewComment
        });
    } catch (error){
        console.error("An error occurred during the review process", error);
    }
};