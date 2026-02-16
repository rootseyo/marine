require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function test() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-3-flash-preview",
        });

        const result = await model.generateContent("Hello, are you Gemini 2.0?");
        const response = await result.response;
        console.log("Response:", response.text());
        console.log("Success!");
    } catch (error) {
        console.error("Error:", error.message);
        // console.error("Full error:", error);
    }
}

test();
