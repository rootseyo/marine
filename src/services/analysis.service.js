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
            당신은 세계 최고의 시니어 퍼포먼스 마케터이자 SEO 및 AIO(AI 엔진 최적화) 전문가입니다.
            제공된 웹사이트 데이터와 마크다운 콘텐츠를 정밀 분석하여 비즈니스 성장을 위한 전략적 리포트를 작성하세요.
            반드시 모든 내용을 한국어로 작성해야 합니다.

            웹사이트 URL: ${siteUrl}
            SEO 수집 데이터: ${JSON.stringify(seoData)}
            콘텐츠 내용 (마크다운 일부):
            ${markdown.substring(0, 12000)}

            --- 분석 지침 ---
            1. 'summary': 이 사이트의 마케팅 가치 제안과 현재 SEO 상태를 마케터 관점에서 3~4문장으로 요약하세요.
            2. 'seo_score': 0~100점 사이의 종합 점수를 매기세요.
            3. 'detected_products': 사이트에서 판매 중이거나 강조하고 있는 주요 제품, 서비스 또는 핵심 키워드 3~5개를 추출하세요.
            4. 'advice': 아래 5개 분야에 대해 구체적인 최적화 방법을 1~2문장으로 제안하세요.
               - meta: 타이틀 및 설명문 최적화
               - semantics: H태그 및 문서 구조
               - images: 용량 및 Alt 태그
               - links: 내부/외부 링크 전략
               - schemas: JSON-LD 등 구조화 데이터
            5. 'ai_visibility': 최신 AI 검색 엔진(ChatGPT, Perplexity 등)에서의 가시성 분석을 포함하세요.
               - score: 0~100점
               - chatgpt_readiness: ChatGPT 노출 준비도 평가
               - perplexity_readiness: Perplexity 답변 소스 채택 가능성
               - gemini_readiness: 구글 Gemini 검색 결과 반영 가능성
               - improvement_tip: AI에게 더 잘 읽히기 위한 핵심 팁 한 줄
            6. 'sample_codes': 실제 적용 가능한 최적화 코드 예시를 제안하세요.
               - seo: 최적화된 메타 태그 (HTML)
               - geo: 비즈니스 성격에 맞는 JSON-LD 스키마 (JSON)
            7. 'ceo_message': 경영진을 위한 전략적 마케팅 조언 한 마디를 250자 이내의 핵심 문장들로 작성하세요.

            --- 응답 JSON 구조 (반드시 이 형식을 엄수하세요) ---
            {
                "summary": "...",
                "seo_score": 85,
                "detected_products": ["제품1", "키워드2"],
                "advice": {
                    "meta": "...",
                    "semantics": "...",
                    "images": "...",
                    "links": "...",
                    "schemas": "..."
                },
                "ai_visibility": {
                    "score": 80,
                    "chatgpt_readiness": "...",
                    "perplexity_readiness": "...",
                    "gemini_readiness": "...",
                    "improvement_tip": "..."
                },
                "sample_codes": {
                    "seo": "...",
                    "geo": "..."
                },
                "ceo_message": "..."
            }
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
        const parsed = robustJSONParse(response.text());
        
        if (!parsed) throw new Error("AI 결과 파싱 실패");
        return parsed;
    }
}

module.exports = AnalysisService;
