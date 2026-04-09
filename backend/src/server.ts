import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

//Load the api key
dotenv.config();

const app = express();
app.use(express.json());

//Init gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

app.post('/api/webhooks/github', async (req, res) => {
    
    //Always acklowledge so github doesn't timeout
    res.status(200).send('Webhook received.');

    const event = req.headers['x-github-event'];
    const action = req.body.action;

    if (event === 'pull_request' &&(action ==='opened' || action ==='synchronize')){
        console.log("New PR Opened");
        //Extract the data from the github payload
        const pr = req.body.pull_request;
        const repo = req.body.repository;

        console.log(`Repository: ${repo.full_name}`);
        console.log(`PR title: ${pr.title}`);

        try{
            console.log("Sending PR details to gemini for review...");
            
            //set up gemini model
            const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});

            //The prompt
            const prompt = `
                You are an expert Senior Software Engineer reviewing code.
                A junior developer just opened a new Pull Request.

                Title: ${pr.title}
                Description: ${pr.body || "No description provided."}

                Provide a sort of short, encouraging and professional review of what you expect to see in a PR with this title and description. Keep it under 4 paragraphs.
            `;

            //To gemini it goes
            const result = await model.generateContent(prompt);
            const response = result.response.text();

            console.log("-Gemini Review-");
            console.log(response);

        } catch (error){
            console.error("Error talking to Gemini.", error);
        }
    } else {

        //If it's a test ping or a Pr being closed, ignore
        console.log(`Ignored event: ${event} / Action: ${action}`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend successfully running on http://localhost:${PORT}`);
});