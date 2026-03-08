const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { isAuthenticated } = require('../../middlewares/auth');
const { decodeOrgId, getPlanDetails, encodeOrgId } = require('../../utils/helpers');

/**
 * PATH: /api/organizations
 */

// 1. Create Organization
router.post('/organizations', isAuthenticated, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Organization name is required" });

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const orgRes = await client.query(
            'INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING *',
            [name, req.user.id]
        );
        const org = orgRes.rows[0];
        org.public_id = encodeOrgId(org.id);

        try {
            await client.query(
                'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                [org.id, req.user.id, 'owner']
            );
        } catch (e) {
            console.warn("[DB] organization_members table missing");
        }

        await client.query('COMMIT');
        res.json({ success: true, organization: org });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[API] Organization Create Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 2. List Organizations
router.get('/organizations', isAuthenticated, async (req, res) => {
    const client = await db.connect();
    try {
        let orgs = [];
        try {
            const result = await client.query(`
                SELECT o.*, om.role 
                FROM organizations o
                JOIN organization_members om ON o.id = om.organization_id
                WHERE om.user_id = $1`,
                [req.user.id]
            );
            orgs = result.rows;
        } catch (joinErr) {
            const result = await client.query(`
                SELECT *, 'owner' as role 
                FROM organizations 
                WHERE owner_id = $1`,
                [req.user.id]
            );
            orgs = result.rows;
        }

        const formattedOrgs = orgs.map(org => ({
            ...org,
            public_id: encodeOrgId(org.id)
        }));

        res.json({ organizations: formattedOrgs });
    } catch (err) {
        console.error("[API] GET /organizations Error:", err);
        res.status(500).json({ error: "Failed to fetch organizations" });
    } finally {
        client.release();
    }
});

// 3. Get Members
router.get('/organizations/:orgId/members', isAuthenticated, async (req, res) => {
    let { orgId } = req.params;
    if (orgId.includes('-')) orgId = decodeOrgId(orgId);

    const client = await db.connect();
    try {
        let members = [];
        try {
            const result = await client.query(`
                SELECT u.id, u.name, u.email, om.role, om.joined_at
                FROM users u
                JOIN organization_members om ON u.id = om.user_id
                WHERE om.organization_id = $1`,
                [orgId]
            );
            members = result.rows;
        } catch (e) {
            const result = await client.query(`
                SELECT u.id, u.name, u.email, 'owner' as role
                FROM users u
                JOIN organizations o ON u.id = o.owner_id
                WHERE o.id = $1`,
                [orgId]
            );
            members = result.rows;
        }
        res.json({ members });
    } catch (err) {
        console.error("[API] Members Fetch Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 4. Get Discoveries (RESTORED)
router.get('/organizations/:id/discoveries', isAuthenticated, async (req, res) => {
    let orgId = req.params.id;
    if (orgId.includes('-')) orgId = decodeOrgId(orgId);

    const client = await db.connect();
    try {
        const result = await client.query(
            "SELECT url FROM sites WHERE organization_id = $1 AND (scraped_data->>'status' = 'discovered')",
            [orgId]
        );
        res.json({ discoveries: result.rows.map(r => r.url) });
    } catch (err) {
        console.error("[API] Discoveries Fetch Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 5. Clear Discoveries (RESTORED)
router.post('/organizations/:id/discoveries/clear', isAuthenticated, async (req, res) => {
    let orgId = req.params.id;
    if (orgId.includes('-')) orgId = decodeOrgId(orgId);
    const { url } = req.body;

    const client = await db.connect();
    try {
        if (url) {
            await client.query(
                "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"status\": \"cleared\"}'::jsonb WHERE organization_id = $1 AND url = $2",
                [orgId, url]
            );
        } else {
            await client.query(
                "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"status\": \"cleared\"}'::jsonb WHERE organization_id = $1 AND (scraped_data->>'status' = 'discovered')",
                [orgId]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error("[API] Discoveries Clear Error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

/**
 * PATH: /api/usage
 */
router.get('/usage', isAuthenticated, async (req, res) => {
    let { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID is required" });

    if (organization_id.includes('-')) organization_id = decodeOrgId(organization_id);

    const client = await db.connect();
    try {
        const countRes = await client.query(
            "SELECT COUNT(*) FROM sites WHERE organization_id = $1 AND scraped_data->>'status' = 'active'",
            [organization_id]
        );
        const planInfo = getPlanDetails(req);
        res.json({
            used: parseInt(countRes.rows[0].count),
            limit: planInfo.limit,
            plan: planInfo.plan,
            isBeta: planInfo.isBeta
        });
    } catch (err) {
        console.error("[API] Usage Fetch Error:", err);
        res.status(500).json({ error: "Usage failed" });
    } finally {
        client.release();
    }
});

// 6. Debug: Set Plan (For testing)
router.post('/debug/set-plan', isAuthenticated, async (req, res) => {
    const { plan } = req.body;
    if (!['free', 'starter', 'pro'].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
    
    // In this simplified version, we use session to mock the plan
    req.session.debug_plan = plan;
    req.session.save((err) => {
        if (err) return res.status(500).json({ error: "Session save failed" });
        res.json({ success: true, plan });
    });
});

module.exports = router;
