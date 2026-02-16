require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function verifyGemini() {
    console.log("🔹 Testing Gemini API Connection...");
    
    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ GEMINI_API_KEY is missing in .env file.");
        return;
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Using the model confirmed to work in 2026 context
        const modelName = "gemini-3-flash-preview"; 
        const model = genAI.getGenerativeModel({ model: modelName });

        console.log(`🔹 Model: ${modelName}`);
        console.log("🔹 Sending prompt: 'Explain the importance of clean code in one sentence.'");

        const result = await model.generateContent("Explain the importance of clean code in one sentence.");
        const response = await result.response;
        const text = response.text();

        console.log("\n✅ Success! Response from Gemini:");
        console.log("---------------------------------------------------");
        console.log(text);
        console.log("---------------------------------------------------");

    } catch (error) {
        console.error("\n❌ Gemini API Test Failed:");
        console.error(error.message);
        if (error.response) {
             console.error("Details:", error.response);
        }
    }
}

verifyGemini();
