//This is the Backend Code from the previous assignment, the current backend is located in func.py
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // Correct import for v4

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// Set up OpenAI API
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // v4 style initialization
});

// Create a route to send messages to OpenAI
app.post('/api/openai', async (req, res) => {
    try {
        const { prompt } = req.body;

        const fullPrompt = `
        You are a data assistant. Respond to questions related to dataset visualization by generating a Vega-Lite chart specification and providing a chart description.
        If the user's query is unrelated to dataset visualization, politely ask them to focus on dataset-related questions.
        Here is the user's query:
        "${prompt}"
        `;
        

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // Chat model
            messages: [{ role: "user", content: fullPrompt }], // Proper structure for chat models
            max_tokens: 1000,
        });
        console.log("OpenAI Response:", response);
        //Original
        //const messageContent = response.choices[0].message.content;
        //res.json(messageContent); // Correctly access the chat response
        //New
        const completionText = response.choices[0].message.content;
        res.json(completionText);
    } catch (error) {
        console.error("OpenAI API Error:", error.response ? error.response.data : error.message);
        res.status(500).send("Something went wrong");
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});