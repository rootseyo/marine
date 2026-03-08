const path = require('path');
const TurndownService = require('turndown');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const BrowserManager = require('../infrastructure/browser');
const { robustJSONParse } = require('../utils/helpers');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer']);

/**
 * Core Analysis Engine
 */
class AnalysisService {
    /**
     * Scrapes a URL and extracts SEO/Behavioral signals
     */
    static async scrapeUrl(url, device = 'desktop', projectRoot = process.cwd()) {
        let browser;
        try {
            console.log(`[Scraper] Starting: ${url} (${device})`);
            browser = await BrowserManager.getBrowser();
            const config = BrowserManager.getDeviceConfig(device);

            const context = await browser.newContext({
                ...config,
                ignoreHTTPSErrors: true
            });
            const page = await context.newPage();
            
            await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
            await page.waitForTimeout(3000);

            const screenshotName = `screenshot_${Date.now()}.png`;
            const screenshotPath = path.join(projectRoot, 'public', 'screenshots', screenshotName);
            await page.screenshot({ path: screenshotPath, fullPage: false }); 

            const seoData = await page.evaluate(() => {
                const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.innerText.trim()).filter(t => t.length > 0);
                return {
                    semantics: { 
                        h1: { count: h1s.length, texts: h1s },
                        h2: { count: document.querySelectorAll('h2').length },
                        h3: { count: document.querySelectorAll('h3').length }
                    },
                    meta: {
                        title: document.title,
                        description: document.querySelector('meta[name="description"]')?.content || ''
                    }
                };
            });

            const content = await page.content();
            const markdown = turndownService.turndown(content);

            return { seoData, markdown, screenshotName };
        } finally {
            if (browser) await browser.close();
        }
    }

    /**
     * Analyzes website data using Gemini AI with intelligent retry
     */
    static async analyzeWithAI(siteUrl, seoData, markdown) {
        const prompt = `
            Analyze this website for SEO and UX optimization:
            URL: ${siteUrl}
            SEO Data: ${JSON.stringify(seoData)}
            Content Snippet: ${markdown.substring(0, 10000)}
            
            Return a JSON object with: 
            { "seo_score": 0-100, "summary": "...", "improvements": [], "automation_suggestion": "..." }
        `;

        let result = null;
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            try {
                result = await model.generateContent(prompt);
                if (result) break;
            } catch (err) {
                attempts++;
                const isRetryable = err.status === 429 || err.status === 503 || 
                                   (err.message && (err.message.includes('429') || err.message.includes('503') || err.message.includes('high demand')));
                
                if (isRetryable) {
                    const delaySeconds = err.status === 503 ? 30 : 60;
                    console.warn(`[AI Engine] ${err.status || 'Busy'} detected. Waiting ${delaySeconds}s before retry ${attempts}/${maxAttempts}...`);
                    await new Promise(r => setTimeout(r, delaySeconds * 1000));
                } else {
                    if (attempts >= maxAttempts) throw err;
                    await new Promise(r => setTimeout(r, 2000 * attempts));
                }
            }
        }

        if (!result) throw new Error("AI 분석 결과 생성 실패");
        const response = await result.response;
        return robustJSONParse(response.text());
    }
}

module.exports = AnalysisService;
