const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { isAuthenticated } = require('../../middlewares/auth');
const { decodeOrgId } = require('../../utils/helpers');

// Routes prefixed with /api/... in server.js

// 1. Dashboard Stats
router.get('/dashboard/stats', isAuthenticated, async (req, res) => {
    let { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID is required" });

    if (typeof organization_id === 'string' && organization_id.includes('-')) {
        const decoded = decodeOrgId(organization_id);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        organization_id = decoded;
    }

    const client = await db.connect();
    try {
        const orgCheck = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [organization_id, req.user.id]);
        if (orgCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access" });

        const sitesRes = await client.query("SELECT id, url, seo_score, scraped_data FROM sites WHERE organization_id = $1 AND NOT (COALESCE(scraped_data, '{}'::jsonb) ? 'deleted_at')", [organization_id]);
        const sites = sitesRes.rows;

        let totalRecovered = 0;
        let totalVisitors24h = 0;
        let avgSeo = 0;
        const now = new Date();
        const oneDayMs = 24 * 60 * 60 * 1000;

        if (sites.length > 0) {
            let seoSum = 0;
            sites.forEach(site => {
                seoSum += (site.seo_score || 0);
                const logs = site.scraped_data?.behavior_logs || [];
                logs.forEach(log => {
                    const logDate = new Date(log.ts);
                    const diffDays = Math.floor((now - logDate) / oneDayMs);
                    if (diffDays < 7 && ['exit_intent', 'coupon_copied'].includes(log.type)) {
                        totalRecovered += 5000; // Mock value for impact
                    }
                    if (diffDays < 1) totalVisitors24h++;
                });
            });
            avgSeo = Math.round(seoSum / sites.length);
        }

        res.json({
            recovered: totalRecovered,
            visitors: totalVisitors24h,
            seo: avgSeo,
            attribution: {
                widget: { cvr: 4.2 },
                nonWidget: { cvr: 2.1 }
            },
            utm: [],
            revenueTrend: [0,0,0,0,0,0,totalRecovered]
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch dashboard stats" });
    } finally {
        client.release();
    }
});

module.exports = router;
