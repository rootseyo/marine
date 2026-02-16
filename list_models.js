require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    // Note: The Node.js SDK doesn't expose listModels directly on the main class easily in all versions,
    // but we can try to use the model manager if available or just test a few common ones.
    // Actually, checking the docs, generic listing might be via specific API calls.
    // Instead, let's just try to generate content with a few likely candidates to see which one works.
    
    const candidates = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash-001",
        "gemini-pro",
        "gemini-1.0-pro"
    ];

    console.log("Testing model availability...");

    for (const modelName of candidates) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Test");
            console.log(`✅ ${modelName} is WORKING.`);
            return; // Found a working one
        } catch (error) {
            console.log(`❌ ${modelName} failed:`);
            console.log(error.message); 
        }
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

listModels();