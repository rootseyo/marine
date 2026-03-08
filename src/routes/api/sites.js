const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../../config/db');
const { isAuthenticated } = require('../../middlewares/auth');
const { decodeOrgId, getPlanDetails } = require('../../utils/helpers');
const siteService = require('../../services/site.service');
const aiService = require('../../services/ai.service');

// All routes are prefixed with /api/sites

// 1. List Sites
router.get('/', isAuthenticated, async (req, res) => {
    let { organization_id } = req.query;
    if (organization_id && organization_id.includes('-')) organization_id = decodeOrgId(organization_id);

    const client = await db.connect();
    try {
        const result = await client.query(
            `SELECT s.* FROM sites s 
             JOIN organizations o ON s.organization_id = o.id
             WHERE s.organization_id = $1 AND o.owner_id = $2
             AND NOT (COALESCE(s.scraped_data, '{}'::jsonb) ? 'deleted_at') 
             AND (s.scraped_data->>'status' IS NULL OR s.scraped_data->>'status' != 'rejected') 
             ORDER BY s.created_at DESC`, 
            [organization_id, req.user.id]
        );
        res.json({ sites: result.rows });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 2. Trigger Immediate Analysis (RESTORED)
router.post('/:id/analyze', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await db.connect();
    try {
        // [Security] Verify ownership
        const siteCheck = await client.query(
            "SELECT s.id, s.organization_id, s.url FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access" });

        // [Usage] Check Plan Limits
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const usageRes = await client.query(
            "SELECT COUNT(*) FROM sites WHERE organization_id = $1 AND created_at >= $2 AND scraped_data->>'status' = 'active'",
            [siteCheck.rows[0].organization_id, startOfDay]
        );
        
        const planInfo = getPlanDetails(req);
        if (parseInt(usageRes.rows[0].count) >= planInfo.limit) {
            return res.status(403).json({ error: `오늘의 분석 한도(${planInfo.limit}회)를 모두 사용하셨습니다.` });
        }

        // Run analysis (in background to avoid timeout)
        siteService.processSiteAnalysis(id, req.user.email).catch(err => {
            console.error(`[API] Background analysis failed for ${id}:`, err);
        });

        // Also trigger AI Auto-pilot if needed
        aiService.runAutoPilotOptimization(id).catch(() => {});

        res.json({ success: true, message: "분석이 시작되었습니다." });
    } catch (err) {
        res.status(500).json({ error: "Analysis trigger failed" });
    } finally {
        client.release();
    }
});

// 3. Queue Site for Analysis
router.post('/:id/queue', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await db.connect();
    try {
        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"status\": \"queued\"}'::jsonb WHERE id = $1",
            [id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Queue failed" });
    } finally {
        client.release();
    }
});

// 4. Get Detail
router.get('/detail/:id', isAuthenticated, async (req, res) => {
    let { id } = req.params;
    
    // Support potential hash-id if frontend starts sending it
    if (typeof id === 'string' && id.includes('-')) {
        const decoded = decodeOrgId(id);
        if (decoded) id = decoded;
    }

    const siteId = parseInt(id);
    if (isNaN(siteId)) return res.status(400).json({ error: "Invalid site ID" });

    const client = await db.connect();
    try {
        // [Security] Verify access via ownership or organization membership
        let result;
        try {
            result = await client.query(
                `SELECT s.* FROM sites s 
                 JOIN organizations o ON s.organization_id = o.id 
                 WHERE s.id = $1 AND (o.owner_id = $2 OR EXISTS (
                     SELECT 1 FROM organization_members om 
                     WHERE om.organization_id = o.id AND om.user_id = $2
                 ))`,
                [siteId, req.user.id]
            );
        } catch (tableErr) {
            // Fallback: If organization_members table is missing, just check organization owner
            console.warn("[DB] organization_members missing, falling back to owner check for site detail");
            result = await client.query(
                `SELECT s.* FROM sites s 
                 JOIN organizations o ON s.organization_id = o.id 
                 WHERE s.id = $1 AND o.owner_id = $2`,
                [siteId, req.user.id]
            );
        }
        
        if (result.rows.length === 0) {
            console.warn(`[API] Site ${siteId} not found or unauthorized for user ${req.user.id}`);
            return res.status(404).json({ error: "Report not found or unauthorized." });
        }
        
        res.json({ site: result.rows[0] });
    } catch (err) {
        console.error("[API] Site Detail Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 5. Create Site
router.post('/', isAuthenticated, async (req, res) => {
    let { organization_id, url, device, skip_analysis } = req.body;
    if (organization_id && organization_id.includes('-')) organization_id = decodeOrgId(organization_id);

    const client = await db.connect();
    try {
        const crypto = require('crypto');
        const apiKey = crypto.randomBytes(16).toString('hex');
        const result = await client.query(
            'INSERT INTO sites (organization_id, url, api_key, seo_score, scraped_data) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [organization_id, url, apiKey, 0, { status: 'registered', device: device || 'desktop' }]
        );
        
        const newSite = result.rows[0];
        if (!skip_analysis) {
            siteService.processSiteAnalysis(newSite.id, req.user.email).catch(() => {});
        }

        res.json({ success: true, site: newSite });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 6. List Trash
router.get('/trash', isAuthenticated, async (req, res) => {
    let { organization_id } = req.query;
    if (organization_id && organization_id.includes('-')) organization_id = decodeOrgId(organization_id);

    const client = await db.connect();
    try {
        const result = await client.query(
            `SELECT s.* FROM sites s 
             JOIN organizations o ON s.organization_id = o.id
             WHERE s.organization_id = $1 AND o.owner_id = $2
             AND (s.scraped_data ? 'deleted_at') 
             ORDER BY (s.scraped_data->>'deleted_at') DESC`, 
            [organization_id, req.user.id]
        );
        res.json({ sites: result.rows });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 7. Soft Delete Site (Trash)
router.delete('/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await db.connect();
    try {
        // [Security] Verify ownership
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access" });

        const deletedAt = new Date().toISOString();
        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || jsonb_build_object('deleted_at', $1::text) WHERE id = $2",
            [deletedAt, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("[API] Delete Error:", err);
        res.status(500).json({ error: "Delete failed" });
    } finally {
        client.release();
    }
});

// 8. Restore Site from Trash
router.post('/restore/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await db.connect();
    try {
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        await client.query("UPDATE sites SET scraped_data = scraped_data - 'deleted_at' WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Restore failed" });
    } finally {
        client.release();
    }
});

// 9. Permanent Delete
router.delete('/:id/permanent', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await db.connect();
    try {
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access" });

        await client.query("DELETE FROM sites WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Permanent delete failed" });
    } finally {
        client.release();
    }
});

module.exports = router;
