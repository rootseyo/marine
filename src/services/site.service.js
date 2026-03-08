const db = require('../config/db');
const AnalysisService = require('./analysis.service');
const EmailService = require('../infrastructure/email');

class SiteService {
    /**
     * Processes a site analysis: Scrape -> AI -> DB -> Email
     */
    static async processSiteAnalysis(siteId, userEmail = null) {
        const client = await db.connect();
        try {
            const res = await client.query("SELECT * FROM sites WHERE id = $1", [siteId]);
            const site = res.rows[0];
            if (!site) return;

            // 1. Scrape
            const { seoData, markdown, screenshotName } = await AnalysisService.scrapeUrl(site.url, site.scraped_data?.device);

            // 2. AI Analyze
            const aiResult = await AnalysisService.analyzeWithAI(site.url, seoData, markdown);

            // 3. Update DB
            const updatedData = {
                ...site.scraped_data,
                status: 'active',
                last_analyzed: new Date().toISOString(),
                seo_details: seoData,
                ai_analysis: aiResult,
                screenshot: screenshotName
            };

            await client.query(
                "UPDATE sites SET seo_score = $1, scraped_data = $2 WHERE id = $3",
                [aiResult.seo_score || 0, JSON.stringify(updatedData), siteId]
            );

            // 4. Notify
            if (userEmail) {
                await EmailService.sendEmail({
                    to: userEmail,
                    subject: `[Marine AI] ${site.url} 분석 완료`,
                    html: `<p>${site.url}의 AI 분석이 완료되었습니다. 대시보드에서 확인하세요.</p>`
                });
            }

            return { success: true };
        } catch (error) {
            console.error(`[SiteService] Analysis failed for ${siteId}:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    static calculateNextRun(schedule, lastTime) {
        const now = new Date();
        const next = new Date(lastTime || now);
        if (schedule === 'daily') next.setDate(next.getDate() + 1);
        else if (schedule === 'weekly') next.setDate(next.getDate() + 7);
        else if (schedule === 'monthly') next.setMonth(next.getMonth() + 1);
        return next.toISOString();
    }
}

module.exports = SiteService;
