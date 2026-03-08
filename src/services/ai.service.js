const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../config/db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/**
 * Runs AI-based marketing automation optimization for a specific site.
 * Summarizes new logs since the last analysis and calls Gemini API.
 * 
 * @param {number|string} siteId 
 */
async function runAutoPilotOptimization(siteId) {
    const client = await db.connect();
    try {
        const res = await client.query("SELECT * FROM sites WHERE id = $1", [siteId]);
        const site = res.rows[0];
        if (!site || !site.scraped_data || !site.scraped_data.automation?.ai_auto_optimize) return;
        
        const allLogs = site.scraped_data.behavior_logs || [];
        const lastAnalyzedTs = site.scraped_data.ai_last_analyzed_ts || "1970-01-01T00:00:00.000Z";
        
        // 1. [Efficiency] Filter only NEW logs since last checkpoint
        const newLogs = allLogs.filter(log => log.ts > lastAnalyzedTs);
        
        // Need at least 20 new logs to justify a new AI analysis (Token cost management)
        if (newLogs.length < 20) {
            console.log(`[Auto-Pilot] Not enough new data for ${site.url} (${newLogs.length}/20). Skipping...`);
            return;
        }

        console.log(`[Auto-Pilot] Analyzing ${newLogs.length} new signals for: ${site.url}`);

        // 2. [Compression] Summarize new logs to minimize tokens
        const summary = {
            total_new_events: newLogs.length,
            top_paths: {},
            top_clicks: {},
            intents: { exit_intent: 0, cart_abandoned: 0, coupon_copied: 0 },
            utm_sources: {}
        };

        newLogs.forEach(l => {
            summary.top_paths[l.path] = (summary.top_paths[l.path] || 0) + 1;
            if (l.type === 'click_interaction' && l.meta?.text) {
                summary.top_clicks[l.meta.text] = (summary.top_clicks[l.meta.text] || 0) + 1;
            }
            if (summary.intents[l.type] !== undefined) summary.intents[l.type]++;
            if (l.meta?.utm?.utm_source) {
                summary.utm_sources[l.meta.utm.utm_source] = (summary.utm_sources[l.meta.utm.utm_source] || 0) + 1;
            }
        });

        const currentLatestTs = newLogs[0].ts;

        const prompt = `
            당신은 시니어 퍼포먼스 마케터이자 데이터 분석가입니다. 아래의 최근 고객 행동 요약 데이터를 분석하여 전환율을 높일 수 있는 마케팅 자동화 전략을 제안하세요.
            
            사이트: ${site.url}
            분석 기간: ${lastAnalyzedTs} ~ ${currentLatestTs}
            최근 주요 경로: ${JSON.stringify(Object.entries(summary.top_paths).sort((a,b)=>b[1]-a[1]).slice(0,5))}
            클릭 상호작용: ${JSON.stringify(Object.entries(summary.top_clicks).sort((a,b)=>b[1]-a[1]).slice(0,5))}
            고의도 시그널: ${JSON.stringify(summary.intents)}
            유입 채널 분포: ${JSON.stringify(summary.utm_sources)}
            
            현재 설정: ${JSON.stringify(site.scraped_data.automation)}

            --- 분석 가이드 ---
            - 'exit_intent'가 높으면 '이탈 방지 위젯(exit_intent)'의 혜택 문구를 더 자극적으로 변경하세요.
            - 특정 상품 경로 방문이 많으면 해당 카테고리에 맞는 '개인화 넛지'를 제안하세요.
            - 분석 결과는 반드시 아래 JSON 구조를 지키고, 한국어로 마케팅 의견을 'ai_opinion'에 상세히 작성하세요.

            --- 응답 JSON ---
            {
                "automation": { (업데이트할 설정들) },
                "ai_opinion": "구체적인 데이터 수치를 언급하며 제안하는 시니어 마케터의 조언"
            }
        `;

        // --- AI Analysis with Intelligent Retry ---
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
                    const delaySeconds = Math.min(30 * attempts, 120); // Exponential backoff
                    console.warn(`[AI Auto-Pilot] ${err.status || 'Busy'} hit. Waiting ${delaySeconds}s before retry ${attempts}/${maxAttempts}...`);
                    await new Promise(r => setTimeout(r, delaySeconds * 1000));
                } else {
                    if (attempts >= maxAttempts) throw err;
                    await new Promise(r => setTimeout(r, 2000 * attempts));
                }
            }
        }
        
        if (!result) throw new Error("AI 분석 생성 실패");
        const textResponse = result.response.text();
        
        let aiResult = null;
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) aiResult = JSON.parse(jsonMatch[0]);

        if (aiResult && aiResult.automation) {
            const isAutoPilotOn = site.scraped_data.automation?.ai_auto_optimize === true;
            
            const newLog = {
                ts: new Date().toISOString(),
                action: isAutoPilotOn ? "자동 설정 최적화 완료" : "AI 분석 완료 및 제안",
                summary: `새로운 신호 ${newLogs.length}개 분석 완료`
            };

            await client.query(`
                UPDATE sites 
                SET scraped_data = scraped_data || jsonb_build_object(
                    'ai_opinion', $1::text,
                    'ai_last_analyzed_ts', $2::text,
                    'ai_logs', (COALESCE(scraped_data->'ai_logs', '[]'::jsonb) || $3::jsonb)
                ) || (CASE WHEN $4 = true THEN jsonb_build_object('automation', $5::jsonb) ELSE '{}'::jsonb END)
                WHERE id = $6
            `, [
                aiResult.ai_opinion, 
                currentLatestTs, 
                JSON.stringify(newLog),
                isAutoPilotOn,
                JSON.stringify(aiResult.automation),
                siteId
            ]);
            
            console.log(`[Auto-Pilot] Successfully updated analysis for: ${site.url}`);
        }
    } catch (err) {
        console.error(`[Auto-Pilot] Error on site ${siteId}:`, err.message);
    } finally {
        client.release();
    }
}

module.exports = {
    runAutoPilotOptimization
};
