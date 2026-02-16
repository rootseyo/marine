require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const TurndownService = require('turndown');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const crypto = require('crypto');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 8080;

// --- Proxy Setup (Crucial for production/Nginx) ---
app.set('trust proxy', 1);

// --- Resend Setup ---
const resend = new Resend(process.env.RESEND_API_KEY);

// --- Database Setup ---
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// --- AI & Tools Setup ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer']);

// --- Middleware ---
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    name: 'bright.sid', // 쿠키 이름 명시
    proxy: true, // 프록시 신뢰 활성화
    cookie: { 
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' // SameSite: Lax가 보안과 호환성 면에서 가장 무난함
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// --- Passport Config ---
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
    const client = await pool.connect();
    try {
        let res = await client.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
        let user = res.rows[0];

        if (!user) {
            const insertRes = await client.query(
                'INSERT INTO users (google_id, email, name) VALUES ($1, $2, $3) RETURNING *',
                [profile.id, profile.emails[0].value, profile.displayName]
            );
            user = insertRes.rows[0];
        }

        // Handle pending invitation if exists in session
        if (req.session && req.session.inviteToken) {
            const token = req.session.inviteToken;
            const invRes = await client.query(
                'SELECT * FROM invitations WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP',
                [token]
            );
            const invitation = invRes.rows[0];
            if (invitation) {
                await client.query(
                    'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id) DO NOTHING',
                    [invitation.organization_id, user.id, invitation.role]
                );
                await client.query('DELETE FROM invitations WHERE id = $1', [invitation.id]);
            }
            delete req.session.inviteToken;
        }

        return done(null, user);
    } catch (err) {
        return done(err, null);
    } finally {
        client.release();
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        done(null, res.rows[0]);
    } catch (err) {
        done(err, null);
    } finally {
        client.release();
    }
});

// --- Helper Middleware ---
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Unauthorized. Please login.' });
}

// --- In-memory Discovery Store ---
const pendingDiscoveries = new Map(); // Map<orgId, Set<url>>

// --- Helper functions for Org ID Obfuscation ---
const ORG_SECRET = process.env.SESSION_SECRET || 'bright_org_salt';
function encodeOrgId(id) {
    const hash = crypto.createHmac('sha256', ORG_SECRET).update(id.toString()).digest('hex').substring(0, 10);
    return `${id}-${hash}`;
}

function decodeOrgId(publicId) {
    if (!publicId || !publicId.includes('-')) return null;
    const [id, hash] = publicId.split('-');
    const expectedHash = crypto.createHmac('sha256', ORG_SECRET).update(id).digest('hex').substring(0, 10);
    return hash === expectedHash ? parseInt(id) : null;
}

// --- Routes ---

// Page Routes (Serving dashboard.html for SPA)
app.get('/dashboard', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/organizations', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/reports', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/reports/:id', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/automation', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/subscription', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// 1. Auth Routes
app.get('/api/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account' 
}));

app.get('/api/auth/oauth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

app.get('/api/auth/me', isAuthenticated, (req, res) => {
    res.json({ user: req.user });
});

app.get('/api/auth/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

// --- SDK & Automation Routes ---

app.get('/sdk.js', async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).send('// API Key required');

    const client = await pool.connect();
    try {
        let site;
        let resolvedOrgId = null;

        // Check if it's an Organization Public ID (contains a hyphen) or a Site API Key
        if (key.includes('-')) {
            resolvedOrgId = decodeOrgId(key);
            if (!resolvedOrgId) {
                console.warn(`[SDK] Invalid Org ID format: ${key}`);
                return res.status(403).send('// Invalid Key format');
            }

            const referer = req.get('referer');
            if (referer) {
                try {
                    const urlObj = new URL(referer);
                    const hostname = urlObj.hostname;
                    
                    const result = await client.query(
                        "SELECT * FROM sites WHERE organization_id = $1 AND (url ILIKE $2 OR url ILIKE $3) LIMIT 1",
                        [resolvedOrgId, `%${hostname}%`, `%${urlObj.host}%`]
                    );
                    site = result.rows[0];
                } catch (e) {
                    console.error("[SDK] Referer URL parse error", e);
                }
            }
        } else {
            // Treat as individual Site API Key
            const result = await client.query('SELECT * FROM sites WHERE api_key = $1', [key]);
            site = result.rows[0];
            if (site) resolvedOrgId = site.organization_id;
        }

        if (site) {
            // Mark as SDK verified if not already marked
            if (!site.scraped_data.sdk_verified) {
                await client.query(
                    "UPDATE sites SET scraped_data = scraped_data || '{\"sdk_verified\": true}'::jsonb WHERE id = $1",
                    [site.id]
                );
                console.log(`[SDK] Site ${site.url} verified (SDK signal received)`);
            }
        } else {
            const ref = req.get('referer');
            if (ref && resolvedOrgId) {
                try {
                    const domain = new URL(ref).origin;
                    if (!pendingDiscoveries.has(resolvedOrgId)) pendingDiscoveries.set(resolvedOrgId, new Set());
                    pendingDiscoveries.get(resolvedOrgId).add(domain);
                } catch (e) {}
            }
            const refLog = ref || 'unknown';
            return res.send(`// BrightNetworks SDK: Site not registered. Please go to 'My Organization' and click 'Register' for ${refLog}`);
        }
        
        const config = site.scraped_data.automation || {
            social_proof: { enabled: true, template: "{location} {customer}님이 {product}를 방금 구매했습니다!" },
            exit_intent: { enabled: true, text: "잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요..." },
            tab_recovery: { enabled: true, text: "🎁 놓치지 마세요!", original: "" },
            price_match: { enabled: true, text: "🔎 최저가를 찾고 계신가요? 여기서 5% 할인받으세요: SAVE5" }
        };

        // Generate dynamic JS
        const sdkCode = `
(function() {
    const config = ${JSON.stringify(config)};
    console.log('Brightnetworks SDK Loaded for ${site.url}');

    // 1. Social Proof Logic
    if (config.social_proof && config.social_proof.enabled) {
        const locations = ['서울시', '부산시', '인천시', '대구시', '광주시', '수원시', '하남시'];
        const customers = ['김*연', '이*준', '박*민', '최*서', '정*우'];
        const products = ${JSON.stringify(site.scraped_data.detected_products || ['인기 상품'])};

        function showToast(msg) {
            const toast = document.createElement('div');
            toast.style = "position: fixed; bottom: 20px; left: 20px; background: white; border-radius: 50px; padding: 12px 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); display: flex; align-items: center; font-family: sans-serif; font-size: 14px; border: 1px solid #eee; z-index: 999999; animation: slideUp 0.5s ease-out;";
            toast.innerHTML = '<div style="width: 10px; height: 10px; background: #2ecc71; border-radius: 50%; margin-right: 12px;"></div>' + msg;
            
            const style = document.createElement('style');
            style.innerHTML = "@keyframes slideUp { from { transform: translateY(100px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }";
            document.head.appendChild(style);
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.transition = "all 0.5s";
                toast.style.opacity = "0";
                toast.style.transform = "translateY(20px)";
                setTimeout(() => toast.remove(), 500);
            }, 5000);
        }

        function showSocialProof() {
            const loc = locations[Math.floor(Math.random() * locations.length)];
            const cust = customers[Math.floor(Math.random() * customers.length)];
            const prod = products[Math.floor(Math.random() * products.length)];
            
            let msg = config.social_proof.template
                .replace('{location}', '<strong>' + loc + '</strong>')
                .replace('{customer}', '<strong>' + cust + '</strong>')
                .replace('{product}', '<strong>' + prod + '</strong>')
                .replace('{time}', '방금');
            
            showToast(msg);
        }

        setTimeout(showSocialProof, 3000);
        setInterval(showSocialProof, 15000);
    }

    // 2. Exit Intent Logic
    if (config.exit_intent && config.exit_intent.enabled) {
        let showed = false;
        document.addEventListener('mouseleave', (e) => {
            if (e.clientY < 0 && !showed) {
                showed = true;
                const modal = document.createElement('div');
                modal.style = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000000; font-family: sans-serif;";
                modal.innerHTML = \`
                    <div style="background: white; padding: 40px; border-radius: 20px; max-width: 450px; width: 90%; text-align: center; position: relative;">
                        <button id="bn-close" style="position: absolute; top: 15px; right: 15px; border: none; background: none; font-size: 20px; cursor: pointer;">&times;</button>
                        <div style="font-size: 40px; margin-bottom: 20px;">🎁</div>
                        <h3 style="margin-bottom: 15px; font-weight: bold;">잠깐만요!</h3>
                        <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">\${config.exit_intent.text}</p>
                        <button id="bn-stay" style="background: #3498db; color: white; border: none; padding: 12px 30px; border-radius: 50px; font-weight: bold; cursor: pointer; width: 100%;">할인 혜택 받고 쇼핑 계속하기</button>
                    </div>
                \`;
                document.body.appendChild(modal);
                document.getElementById('bn-close').onclick = () => modal.remove();
                document.getElementById('bn-stay').onclick = () => modal.remove();
            }
        });
    }

    // 3. Tab Recovery Logic (New!)
    if (config.tab_recovery && config.tab_recovery.enabled) {
        let originalTitle = document.title;
        let titleInterval;
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                originalTitle = document.title;
                let toggle = false;
                titleInterval = setInterval(() => {
                    document.title = toggle ? config.tab_recovery.text : originalTitle;
                    toggle = !toggle;
                }, 2000);
            } else {
                clearInterval(titleInterval);
                document.title = originalTitle;
            }
        });
    }

    // 4. Price Match/Copy Trigger Logic (New!)
    if (config.price_match && config.price_match.enabled) {
        document.addEventListener('copy', () => {
             const toast = document.createElement('div');
            toast.style = "position: fixed; top: 20px; right: 20px; background: #2c3e50; color: white; border-radius: 8px; padding: 15px 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); display: flex; align-items: center; font-family: sans-serif; font-size: 14px; z-index: 999999; animation: slideDown 0.5s ease-out; cursor: pointer;";
            toast.innerHTML = '<span style="font-size: 20px; margin-right: 10px;">💸</span>' + config.price_match.text;
            
            const style = document.createElement('style');
            style.innerHTML = "@keyframes slideDown { from { transform: translateY(-50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }";
            document.head.appendChild(style);
            document.body.appendChild(toast);

            toast.onclick = () => toast.remove();

            setTimeout(() => {
                toast.style.transition = "all 0.5s";
                toast.style.opacity = "0";
                toast.style.transform = "translateY(-20px)";
                setTimeout(() => toast.remove(), 500);
            }, 8000);
        });
    }
})();
        `;
        res.set('Content-Type', 'application/javascript');
        res.send(sdkCode);
    } catch (err) {
        console.error(err);
        res.status(500).send('// Internal Server Error');
    } finally {
        client.release();
    }
});

app.post('/api/sites/:id/automation', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { config } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query(
            "UPDATE sites SET scraped_data = scraped_data || jsonb_build_object('automation', $1::jsonb) WHERE id = $2",
            [config, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 2. Organization Routes
app.post('/api/organizations', isAuthenticated, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Organization name is required" });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orgRes = await client.query(
            'INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING *',
            [name, req.user.id]
        );
        const org = orgRes.rows[0];
        org.public_id = encodeOrgId(org.id);
        
        // Check if organization_members table exists before trying to insert
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'organization_members'
            );
        `);

        if (tableCheck.rows[0].exists) {
            // Also add owner as a member
            await client.query(
                'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)',
                [org.id, req.user.id, 'owner']
            );
        } else {
            console.warn("[DB] organization_members table missing. Skipping membership insertion.");
        }
        
        await client.query('COMMIT');
        res.json({ success: true, organization: org });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Organization creation error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

app.get('/api/organizations', isAuthenticated, async (req, res) => {
    const client = await pool.connect();
    try {
        // Fallback to simple query as organization_members table creation failed due to permissions
        const result = await client.query(`
            SELECT *, 'owner' as role 
            FROM organizations 
            WHERE owner_id = $1
        `, [req.user.id]);
        
        const orgs = result.rows.map(org => ({
            ...org,
            public_id: encodeOrgId(org.id)
        }));
        
        res.json({ organizations: orgs });
    } catch (err) {
        console.error("Fetch organizations error:", err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// --- Team & Invitation Routes ---

app.get('/api/organizations/:orgId/members', isAuthenticated, async (req, res) => {
    const { orgId } = req.params;
    const client = await pool.connect();
    try {
        // Fallback: If organization_members table doesn't exist, show the owner
        const result = await client.query(`
            SELECT u.id, u.name, u.email, 'owner' as role, o.created_at as joined_at
            FROM users u
            JOIN organizations o ON u.id = o.owner_id
            WHERE o.id = $1
        `, [orgId]);
        res.json({ members: result.rows });
    } catch (err) {
        res.json({ members: [], error: "Team features are currently unavailable due to database restrictions." });
    } finally {
        client.release();
    }
});

app.post('/api/organizations/:orgId/invite', isAuthenticated, async (req, res) => {
    res.status(503).json({ error: "초대 기능은 현재 데이터베이스 권한 문제로 이용할 수 없습니다. 관리자에게 문의하세요." });
});

app.get('/api/invitations/accept', async (req, res) => {
    res.status(503).send("Invitation system is currently disabled due to database permission issues.");
});

app.get('/api/organizations/:id/discoveries', isAuthenticated, (req, res) => {
    const orgId = parseInt(req.params.id);
    const discoveries = pendingDiscoveries.has(orgId) ? Array.from(pendingDiscoveries.get(orgId)) : [];
    res.json({ discoveries });
});

app.post('/api/organizations/:id/discoveries/clear', isAuthenticated, (req, res) => {
    const orgId = parseInt(req.params.id);
    const { url } = req.body;
    if (pendingDiscoveries.has(orgId)) {
        if (url) pendingDiscoveries.get(orgId).delete(url);
        else pendingDiscoveries.delete(orgId);
    }
    res.json({ success: true });
});

// 3. Site Routes (Analysis)
async function getUsage(organization_id) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const client = await pool.connect();
    try {
        const result = await client.query(
            "SELECT COUNT(*) FROM sites WHERE organization_id = $1 AND created_at >= $2",
            [organization_id, startOfMonth]
        );
        return parseInt(result.rows[0].count);
    } finally {
        client.release();
    }
}

app.get('/api/usage', isAuthenticated, async (req, res) => {
    const { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID is required" });
    
    try {
        const count = await getUsage(organization_id);
        res.json({ used: count, limit: 10 });
    } catch (err) {
        res.status(500).json({ error: "Usage check failed" });
    }
});

async function fetchAndParseSitemap(url, allUrls = [], visited = new Set()) {
    if (visited.has(url) || allUrls.length >= 500) return allUrls;
    visited.add(url);

    try {
        const response = await fetch(url);
        if (!response.ok) return allUrls;
        const xmlText = await response.text();
        
        // Extract <loc> tags
        const regex = /<loc>(.*?)<\/loc>/gi;
        let match;
        const currentBatch = [];
        while ((match = regex.exec(xmlText)) !== null) {
            currentBatch.push(match[1]);
        }

        for (const loc of currentBatch) {
            if (loc.endsWith('.xml') || loc.includes('sitemap')) {
                // Potential sub-sitemap or index
                await fetchAndParseSitemap(loc, allUrls, visited);
            } else {
                if (!allUrls.includes(loc)) {
                    allUrls.push(loc);
                }
            }
            if (allUrls.length >= 500) break;
        }
    } catch (err) {
        console.error(`Failed to parse sitemap at ${url}:`, err);
    }
    return allUrls;
}

app.post('/api/sitemaps/parse', isAuthenticated, async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: "Sitemap URL is required" });
    if (!url.startsWith('http')) url = 'https://' + url;

    try {
        const urls = await fetchAndParseSitemap(url);
        res.json({ success: true, urls: urls });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/sites', isAuthenticated, async (req, res) => {
    const { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID is required" });

    const client = await pool.connect();
    try {
        // Filter out deleted sites using JSONB flag
        const result = await client.query(
            "SELECT * FROM sites WHERE organization_id = $1 AND NOT (scraped_data ? 'deleted_at') ORDER BY created_at DESC", 
            [organization_id]
        );
        res.json({ sites: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

app.get('/api/sites/trash', isAuthenticated, async (req, res) => {
    const { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID is required" });

    const client = await pool.connect();
    try {
        // Fetch deleted sites using JSONB flag
        const result = await client.query(
            "SELECT * FROM sites WHERE organization_id = $1 AND (scraped_data ? 'deleted_at') ORDER BY (scraped_data->>'deleted_at') DESC", 
            [organization_id]
        );
        res.json({ sites: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

app.delete('/api/sites/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        // Soft delete using JSONB flag
        const deletedAt = new Date().toISOString();
        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || jsonb_build_object('deleted_at', $1::text) WHERE id = $2", 
            [deletedAt, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

app.post('/api/sites/restore/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        // Restore by removing JSONB flag
        await client.query(
            "UPDATE sites SET scraped_data = scraped_data - 'deleted_at' WHERE id = $1", 
            [id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

app.get('/api/sites/detail/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM sites WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Report not found" });
        res.json({ site: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

async function scrapeUrl(url) {
    let browser;
    try {
        console.log(`[Playwright] Launching browser for: ${url}`);
        browser = await chromium.launch({ 
            headless: false,
            slowMo: 50
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 }
        });
        const page = await context.newPage();
        
        console.log(`[Playwright] Navigation started...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`[Playwright] Page loaded. Waiting for stability...`);
        await page.waitForTimeout(5000);

        // Take Screenshot
        const screenshotName = `screenshot_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
        const screenshotPath = path.join(__dirname, 'public', 'screenshots', screenshotName);
        console.log(`[Playwright] Taking screenshot: ${screenshotName}`);
        await page.screenshot({ path: screenshotPath, fullPage: false }); // Partial page is faster and often enough for preview

        console.log(`[Playwright] Extracting SEO data...`);
        const seoData = await page.evaluate(() => {
            const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.innerText.trim()).filter(t => t.length > 0);
            const title = document.title;
            const description = document.querySelector('meta[name="description"]')?.content || '';
            const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
            const images = Array.from(document.querySelectorAll('img'));
            const imagesMissingAlt = images.filter(img => !img.alt || img.alt.trim() === '').length;
            const imagesWithLazy = images.filter(img => img.getAttribute('loading') === 'lazy').length;
            const schemas = [];
            document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
                try { schemas.push(JSON.parse(script.innerText)); } catch (e) {}
            });
            const links = Array.from(document.querySelectorAll('a'));
            const internalLinks = links.filter(a => a.host === window.location.host).length;

            return {
                semantics: { h1: { count: h1s.length, texts: h1s }, h2: { count: document.querySelectorAll('h2').length }, h3: { count: document.querySelectorAll('h3').length } },
                meta: { title, description, canonical },
                images: { total: images.length, missingAlt: imagesMissingAlt, lazy: imagesWithLazy },
                schemas,
                links: { total: links.length, internal: internalLinks }
            };
        });

        const contentHtml = await page.content();
        const markdown = turndownService.turndown(contentHtml).trim().substring(0, 20000);
        return { seoData, markdown, screenshotName };
    } finally {
        if (browser) await browser.close();
    }
}

app.post('/api/sites', isAuthenticated, async (req, res) => {
    const { organization_id, url } = req.body;
    if (!organization_id || !url) return res.status(400).json({ error: "Org ID and URL are required" });

    try {
        const currentUsage = await getUsage(organization_id);
        console.log(`[Usage] Org: ${organization_id}, Current month usage: ${currentUsage}/1000`);
        if (currentUsage >= 1000) { // Increased to 1000 for debugging
            console.warn(`[Usage] Limit reached for Org: ${organization_id}`);
            return res.status(403).json({ error: "분석 횟수 제한에 도달했습니다. (디버깅 모드: 1000회)" });
        }
    } catch (err) {
        console.error(`[Usage] Error checking usage: ${err.message}`);
        return res.status(500).json({ error: "사용량 확인 실패" });
    }

    const apiKey = crypto.randomBytes(16).toString('hex');
    const client = await pool.connect();

    try {
        const { seoData, markdown, screenshotName } = await scrapeUrl(url);

        const prompt = `
            당신은 세계 최고의 쇼핑몰 기술 SEO 컨설턴트이자 비즈니스 전략가입니다. 
            제공된 데이터를 바탕으로 고객사 쇼핑몰에 신뢰와 실질적인 도움을 줄 수 있는 '커스텀 SEO 및 AIO(AI Optimization) 진단 보고서'를 한국어로 작성하세요.
            문체는 전문적이고 객관적이며 신뢰감 있는 비즈니스 톤으로 작성하고, '사장님'과 같은 표현은 절대 사용하지 마세요. 대신 '고객사' 또는 '운영진'이라는 표현을 사용하거나 주어를 생략하세요.

            --- 수집된 기술적 SEO 데이터 ---
            ${JSON.stringify(seoData)}
            
            --- 페이지 콘텐츠 요약 (Markdown) ---
            ${markdown}
            
            --- 추가 분석 작업: AI 검색 최적화 (AIO) ---
            ChatGPT, Perplexity, Gemini와 같은 AI 엔진이 이 사이트를 어떻게 인식하고 추천할지 분석하세요.

            --- 응답 JSON 구조 ---
            {
                "seo_score": (0~100 숫자),
                "summary": "비즈니스 핵심 요약",
                "advice": {
                    "semantics": "사이트 구조 조언",
                    "meta": "메타 정보 조언",
                    "images": "이미지 최적화 조언",
                    "schemas": "구조화 데이터 조언",
                    "links": "연결성 조언"
                },
                "ai_visibility": {
                    "score": (0~100 숫자),
                    "chatgpt_readiness": "ChatGPT 인용 가능성 (한줄)",
                    "perplexity_readiness": "Perplexity 답변 포함 가능성 (한줄)",
                    "gemini_readiness": "Gemini 검색 결과 노출 가능성 (한줄)",
                    "improvement_tip": "AI 유입을 늘리기 위한 핵심 전략"
                },
                "detected_products": ["상품1", "상품2"],
                "ceo_message": "전문가 분석 의견 및 핵심 전략 제언",
                "sample_codes": {
                    "seo": "해당 페이지에 바로 적용 가능한 JSON-LD 또는 Meta 태그 샘플 코드",
                    "geo": "AI 검색 엔진(GEO) 최적화를 위한 구조화된 정보나 시맨틱 태그 예시"
                }
            }
        `;

        console.log(`[AI] Requesting analysis from Gemini for ${url}...`);
        const result = await model.generateContent(prompt);
        const textResponse = result.response.text();
        console.log(`[AI] Received response (first 200 chars): ${textResponse.substring(0, 200)}...`);
        
        let aiResult = {};
        try {
            const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                aiResult = JSON.parse(jsonMatch[0]);
                console.log(`[AI] Successfully parsed JSON.`);
            } else {
                throw new Error("JSON not found in response");
            }
        } catch (e) {
            console.error(`[AI] JSON Parsing Error: ${e.message}`);
            aiResult = { seo_score: 50, summary: "분석 실패 (형식 오류)", advice: {}, ai_visibility: { score: 0 } };
        }

        console.log(`[DB] Saving results for ${url}...`);
        const insertRes = await client.query(
            'INSERT INTO sites (organization_id, url, api_key, seo_score, scraped_data) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [organization_id, url, apiKey, aiResult.seo_score || 0, { ...aiResult, raw_seo: seoData, screenshot: screenshotName }]
        );
        console.log(`[DB] Site saved with ID: ${insertRes.rows[0].id}`);

        res.json({ success: true, site: insertRes.rows[0], script_tag: `<script src="https://api.brightnetworks.kr/sdk.js?key=${apiKey}" async></script>` });

    } catch (err) {
        console.error("Site processing failed:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 404 Fallback -> Redirect to Root
app.use((req, res, next) => {
    // API request 404s should still return JSON error
    if (req.path.startsWith('/api/') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.png')) {
        return res.status(404).json({ error: 'Not Found' });
    }
    // All other 404s redirect to home
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Bright Networks Platform running on http://localhost:${PORT}`);
});