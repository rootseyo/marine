require('dotenv').config();
const { chromium } = require('playwright');
const TurndownService = require('turndown');
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function crawlAndConvert(url) {
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
    });

    // 불필요한 태그 제거 규칙 추가
    turndownService.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer']);

    let browser;
    try {
        console.log(`Crawling: ${url}...`);
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        // 페이지 이동
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        // 1. Playwright에서 직접 불필요한 요소 제거 (선택 사항이지만 효과적임)
        await page.evaluate(() => {
            const selectors = ['header', 'footer', 'nav', 'script', 'style', 'aside', '.ads', '#ads'];
            selectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => el.remove());
            });
        });

        // 2. HTML 가져오기
        const contentHtml = await page.content();

        // 3. Markdown으로 변환
        console.log("Converting HTML to Markdown...");
        const markdown = turndownService.turndown(contentHtml);

        // 4. Gemini에 전송
        console.log("Sending to Gemini...");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const prompt = `
            다음은 웹사이트에서 추출한 마크다운 형식의 내용입니다.
            이 내용을 바탕으로 페이지의 주요 내용을 3문장으로 요약해주세요.

            ---
            ${markdown}
            ---
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        console.log("\n--- 요약 결과 ---");
        console.log(response.text());
        
        // 토큰 절약 확인을 위해 글자 수 출력
        console.log(`\nOriginal HTML length: ${contentHtml.length}`);
        console.log(`Markdown length: ${markdown.length}`);
        console.log(`Compression ratio: ${((1 - markdown.length / contentHtml.length) * 100).toFixed(2)}%`);

    } catch (error) {
        console.error("Error:", error);
    } finally {
        if (browser) await browser.close();
    }
}

// 테스트 실행 (예시: Google 검색 도움말 페이지 등)
const targetUrl = process.argv[2] || 'https://www.google.com/about';
crawlAndConvert(targetUrl);
