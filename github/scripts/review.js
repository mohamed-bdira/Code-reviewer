module.exports = async ({github, context}) =>{
    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    console.log(`Reviewing PR #${prNumber} for ${owner}/${repo}`);

    //Fetch the diff
    try{
        const {data: diff} = await github.rest.pulls.get({
            owner: owner,
            repo: repo,
            pull_number: prNumber,
            mediaType: {format: 'diff'}
        });

        //Prepare request for model
        const modelEndpoint = process.env.MODEL_ENDPOINT_URL;
        console.log(`Sending diff to custom model at ${modelEndpoint}...`);

        const requestBody = {
            model: "model_name",
            messages: [
                {
                    role: "system",
                    content: "you are a senior software engineer reviewing a pull request. Review the provided git file changes. Focus ONLY on the potential bugs, security vulnerabilities, and major performance issues. Be concise and format your response in Markdown."
                },
                {
                    role: "users",
                    content: `Here is the diff to review:\n\n${diff}`
                }
            ],
            temparature: 0.2
        };
    

        //HTTP call
        const response =await fetch(modelEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application.json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok){
            throw new Error(`Model API responded with satutus: ${response.status};`)
        }

        const data = await response.json();

        //Parse the responnse
        const aiReview = data.choices[0].message.content;

        //Post to github
        console.log("Posting review to github...");
        await github.rest.issues.createComment({
            owner: owner,
            repo: repo,
            issue_number: prNumber,
            body: `**Custom Ai Review:**\n\n${aiReview}`
        });

        console.log("Review completed!");
    } catch (error){
        console.error("An error occured during the review process:", error);
    }
}