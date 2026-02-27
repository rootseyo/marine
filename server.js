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
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer']);

// --- Middleware ---
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ type: ['application/json', 'text/plain'] }));

app.use((req, res, next) => {
    const origin = req.get('Origin') || 'Local/Same-Origin';
    if (req.url.includes('signal') || req.url.includes('ping')) {
        const bodyStr = req.body ? JSON.stringify(req.body) : '';
        console.log(`[Request DEBUG] ${req.method} ${req.url} - Origin: ${origin}, Body: ${bodyStr.substring(0, 100)}...`);
    } else {
        console.log(`[Request] ${req.method} ${req.url} - Origin: ${origin}`);
    }
    next();
});

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
    
    // 페이지 요청(GET)인 경우 로그인 페이지로 리다이렉트, 그 외(API 등)는 JSON 반환
    if (req.accepts('html') && req.method === 'GET') {
        return res.redirect('/');
    }
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
app.get('/api/ping', (req, res) => res.json({ status: 'ok', version: '25.2.26.2', timestamp: new Date().toISOString() }));

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

// --- AI Auto-Pilot Background Engine ---

async function runAutoPilotOptimization(siteId) {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT * FROM sites WHERE id = $1", [siteId]);
        const site = res.rows[0];
        if (!site || !site.scraped_data || !site.scraped_data.automation?.ai_auto_optimize) return;
        
        const logs = site.scraped_data.behavior_logs || [];
        if (logs.length < 10) return; // Need some data to make decisions

        console.log(`[Auto-Pilot] Analyzing behavior data for: ${site.url}`);

        // [Senior Strategy] Summarize logs to save tokens and focus on patterns
        const summary = {
            total_events: logs.length,
            paths: {},
            clicks: [],
            types: {}
        };
        logs.forEach(l => {
            summary.types[l.type] = (summary.types[l.type] || 0) + 1;
            summary.paths[l.path] = (summary.paths[l.path] || 0) + 1;
            if (l.type === 'click_interaction' && l.meta?.text) summary.clicks.push(l.meta.text);
        });

        const prompt = `
            당신은 시니어 퍼포먼스 마케터입니다. 아래의 고객 행동 패턴 데이터를 분석하여 전환율을 높일 수 있도록 현재의 '마케팅 자동화 설정'을 최적화하세요.
            
            분석 대상 사이트: ${site.url}
            최근 방문 패턴(Top 3 Paths): ${JSON.stringify(Object.entries(summary.paths).sort((a,b)=>b[1]-a[1]).slice(0,3))}
            주요 클릭 요소: ${summary.clicks.slice(0,10).join(', ')}
            이벤트 분포: ${JSON.stringify(summary.types)}
            
            기존 설정: ${JSON.stringify(site.scraped_data.automation)}

            --- 분석 및 최적화 지침 ---
            1. '스크롤(scroll_depth)' 이탈이 잦은 경우 보상 위젯의 노출 조건(depth)을 조정하세요.
            2. 클릭 요소나 페이지 경로를 참고하여, 이탈 방지나 넛지 문구를 해당 관심사에 맞게 개인화하세요.
            3. 분석 결과는 반드시 아래 JSON 구조를 지켜야 하며, 한국어로 친절하고 전문적인 마케터의 어조로 'ai_opinion'을 작성하세요.
            4. 'ai_opinion'에는 어떤 경로에서 이탈이 많은지, 어떤 마케팅 설정을 강화하면 좋을지 구체적인 수치나 경로명을 언급하며 조언을 포함하세요.

            --- 응답 JSON 구조 (반드시 이 구조로만 응답하세요) ---
            {
                "automation": {
                    "social_proof": { "enabled": true, "template": "...", "conversion": "..." },
                    "exit_intent": { "enabled": true, "text": "...", "conversion": "..." },
                    "shipping_timer": { "enabled": true, "closing_hour": 16, "text": "...", "conversion": "..." },
                    "scroll_reward": { "enabled": true, "depth": 50, "text": "...", "coupon": "...", "conversion": "..." },
                    "rental_calc": { "enabled": true, "period": 24, "text": "...", "conversion": "..." },
                    "inactivity_nudge": { "enabled": true, "idle_seconds": 20, "text": "...", "conversion": "..." },
                    "tab_recovery": { "enabled": true, "text": "...", "conversion": "..." },
                    "price_match": { "enabled": true, "text": "...", "conversion": "..." }
                },
                "ai_opinion": "여기에 시니어 마케터의 분석 의견을 작성하세요."
            }
        `;

        // --- AI Analysis with Intelligent Retry (Handling 429 & 503) ---
        let result = null;
        let attempts = 0;
        const maxAttempts = 5; // 재시도 횟수 상향
        
        while (attempts < maxAttempts) {
            try {
                result = await model.generateContent(prompt);
                if (result) break; // Success!
            } catch (err) {
                attempts++;
                const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
                
                if (isRateLimit) {
                    const delaySeconds = 60; // 대기 시간 60초로 연장
                    console.warn(`[AI] Rate limit hit (429). Waiting ${delaySeconds}s before attempt ${attempts + 1}...`);
                    await new Promise(r => setTimeout(r, delaySeconds * 1000));
                } else {
                    console.error(`[AI Analysis] Attempt ${attempts} failed:`, err.message);
                    if (attempts >= maxAttempts) throw err;
                    await new Promise(r => setTimeout(r, 2000 * attempts));
                }
            }
        }
        
        if (!result) throw new Error("AI 분석 결과 생성에 실패했습니다 (최대 재시도 초과)");
        const textResponse = result.response.text();
        
        let aiResult = null;
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) aiResult = JSON.parse(jsonMatch[0]);

        if (aiResult && aiResult.automation) {
            // Always update opinion, but only update automation config if auto-pilot is ON
            const isAutoPilotOn = site.scraped_data.automation?.ai_auto_optimize === true;
            
            if (isAutoPilotOn) {
                await client.query(
                    "UPDATE sites SET scraped_data = jsonb_set(jsonb_set(COALESCE(scraped_data, '{}'::jsonb), '{automation}', $1::jsonb), '{ai_opinion}', $2::jsonb) WHERE id = $3",
                    [JSON.stringify(aiResult.automation), JSON.stringify(aiResult.ai_opinion), siteId]
                );
            } else {
                await client.query(
                    "UPDATE sites SET scraped_data = jsonb_set(COALESCE(scraped_data, '{}'::jsonb), '{ai_opinion}', $1::jsonb) WHERE id = $2",
                    [JSON.stringify(aiResult.ai_opinion), siteId]
                );
            }
            console.log(`[Auto-Pilot] Successfully updated AI opinion (and automation: ${isAutoPilotOn}) for ${site.url}`);
        }
    } catch (err) {
        console.error(`[Auto-Pilot] Failed for Site ${siteId}:`, err);
    } finally {
        client.release();
    }
}

app.post('/api/v1/learning/signal', async (req, res) => {
    const { api_key, event_type, path, referrer, metadata } = req.body;
    if (!api_key) return res.status(400).json({ error: "Missing API Key" });

    const client = await pool.connect();
    try {
        // [Modern Strategy] Use a more robust way to append to jsonb array and maintain limit
        // 1. First, get current data to ensure we have an array
        const siteRes = await client.query("SELECT id, scraped_data FROM sites WHERE api_key = $1", [api_key]);
        if (siteRes.rowCount === 0) {
            console.warn(`[Intelligence] Site not found for API Key: ${api_key}`);
            return res.status(404).json({ error: "Site not found", received_key: api_key });
        }

        const siteId = siteRes.rows[0].id;
        const currentData = siteRes.rows[0].scraped_data || {};
        let logs = currentData.behavior_logs || [];
        if (!Array.isArray(logs)) logs = [];

        // 2. Add new log at the beginning
        const newLog = {
            type: event_type,
            path: path,
            ref: referrer,
            meta: metadata,
            ts: new Date().toISOString()
        };
        logs.unshift(newLog);
        
        // 3. Keep only last 50
        const limitedLogs = logs.slice(0, 50);

        // 4. Dynamic Learning Progress Calculation
        let tps = 0;
        if (limitedLogs.length > 5) {
            const newest = new Date(limitedLogs[0].ts).getTime();
            const oldest = new Date(limitedLogs[limitedLogs.length - 1].ts).getTime();
            const durationSec = (newest - oldest) / 1000;
            if (durationSec > 1) {
                tps = limitedLogs.length / durationSec;
            }
        }
        
        // Threshold: 10x of TPS or at least 1000
        const targetCount = Math.max(1000, Math.ceil(tps * 10));
        const currentCount = parseInt(currentData.event_count || 0) + 1;
        
        let progress = 25;
        if (currentCount > 0) {
            progress = Math.min(100, 25 + Math.floor((currentCount / targetCount) * 75));
        }

        // 5. Atomic Update
        const updateRes = await client.query(`
            UPDATE sites 
            SET scraped_data = jsonb_set(
                jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            jsonb_set(
                                jsonb_set(
                                    COALESCE(scraped_data, '{}'::jsonb), 
                                    '{behavior_logs}', $1::jsonb
                                ),
                                '{event_count}', $2::jsonb
                            ),
                            '{learning_progress}', $3::jsonb
                        ),
                        '{stats_tps}', $4::jsonb
                    ),
                    '{stats_target_count}', $5::jsonb
                ),
                '{script_detected}', 'true'::jsonb
            )
            WHERE id = $6
            RETURNING scraped_data->'automation'->'ai_auto_optimize' as auto_pilot
        `, [
            JSON.stringify(limitedLogs), 
            JSON.stringify(currentCount), 
            JSON.stringify(progress.toString()),
            JSON.stringify(tps.toFixed(2)),
            JSON.stringify(targetCount),
            siteId
        ]);

        // --- Continuous AI Auto-Pilot Trigger ---
        if (progress === 100) {
            console.log(`[Auto-Pilot] Threshold reached for Site ${siteId}.`);
            runAutoPilotOptimization(siteId).then(async () => {
                const resetClient = await pool.connect();
                try {
                    await resetClient.query(
                        "UPDATE sites SET scraped_data = jsonb_set(jsonb_set(COALESCE(scraped_data, '{}'::jsonb), '{learning_progress}', '25'::jsonb), '{event_count}', '0'::jsonb) WHERE id = $1",
                        [siteId]
                    );
                } finally { resetClient.release(); }
            });
        }

        res.status(204).send();
    } catch (err) {
        console.error("[Intelligence Error]", err);
        res.status(500).end();
    } finally {
        client.release();
    }
});

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
            console.log(`[SDK DEBUG] Key: ${key}, Referer: ${referer}, Org: ${resolvedOrgId}`);
            if (referer) {
                try {
                    const urlObj = new URL(referer);
                    const origin = urlObj.origin.toLowerCase();
                    const host = urlObj.hostname.toLowerCase();
                    const hostWithoutWww = host.replace(/^www\./, '');
                    
                    console.log(`[SDK DEBUG] Parsed - Origin: ${origin}, Host: ${host}, Base: ${hostWithoutWww}`);

                    // [Senior Strategy] Multi-pattern matching for maximum compatibility (www, protocol-less, etc.)
                    const result = await client.query(
                        `SELECT s.id, s.url, s.api_key, s.scraped_data, o.id as org_id, o.name as org_name
                         FROM sites s
                         JOIN organizations o ON s.organization_id = o.id
                         WHERE s.organization_id = $1 
                         AND (
                            s.url ILIKE $2 OR s.url ILIKE $3 OR 
                            s.url ILIKE $4 OR s.url ILIKE $5 OR 
                            s.url ILIKE $6 OR s.url ILIKE $7
                         ) 
                         AND NOT (COALESCE(s.scraped_data, '{}'::jsonb) ? 'deleted_at') 
                         ORDER BY (s.scraped_data->>'sdk_verified' = 'true') DESC LIMIT 1`,
                        [
                            resolvedOrgId, 
                            origin, `${origin}/`,
                            `%://${host}`, `%://${host}/`,
                            `%://${hostWithoutWww}`, `%://${hostWithoutWww}/`
                        ]
                    );
                    site = result.rows[0];
                    console.log(`[SDK DEBUG] Match result: ${site ? 'FOUND (' + site.url + ')' : 'NOT FOUND'}`);
                } catch (e) {
                    console.error("[SDK] Referer URL parse error", e);
                }
            }
        } else {
            // Treat as individual Site API Key
            const result = await client.query(
                `SELECT s.*, o.id as org_id, o.name as org_name
                 FROM sites s 
                 JOIN organizations o ON s.organization_id = o.id
                 WHERE s.api_key = $1 AND NOT (COALESCE(s.scraped_data, '{}'::jsonb) ? 'deleted_at')`, 
                [key]
            );
            site = result.rows[0];
            if (site) resolvedOrgId = site.organization_id;
        }

        let isVerified = false;
        if (site) {
            isVerified = (site.scraped_data || {}).sdk_verified === true;
            console.log(`[SDK] Serving SDK for: ${site.url} (Verified: ${isVerified})`);
            
            const siteData = site.scraped_data || {};
            // Record script detection if not already noted
            if (!siteData.script_detected) {
                await client.query(
                    "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"script_detected\": true}'::jsonb WHERE id = $1",
                    [site.id]
                );
                site.scraped_data.script_detected = true;
            }
        } else {
            // --- Discovery Logic (Only if NO site was matched above) ---
            const ref = req.get('referer');
            console.log(`[SDK DEBUG] Entering Discovery: Ref=${ref}, Org=${resolvedOrgId}`);
            if (ref && resolvedOrgId) {
                try {
                    const urlObj = new URL(ref);
                    const domain = urlObj.origin.toLowerCase();
                    const host = urlObj.hostname.toLowerCase();
                    const hostWithoutWww = host.replace(/^www\./, '');
                    
                    console.log(`[SDK DEBUG] Discovery - Domain: ${domain}, Host: ${host}`);

                    // Re-check for discovery to avoid duplicates, including deleted ones
                    const checkRes = await client.query(
                        "SELECT id, scraped_data FROM sites WHERE organization_id = $1 AND (url ILIKE $2 OR url ILIKE $3) LIMIT 1",
                        [resolvedOrgId, `%://${host}`, `%://${hostWithoutWww}`]
                    );

                    console.log(`[SDK DEBUG] Discovery check res count: ${checkRes.rows.length}`);
                    if (checkRes.rows.length === 0) {
                        const apiKey = crypto.randomBytes(16).toString('hex');
                        await client.query(
                            "INSERT INTO sites (organization_id, url, api_key, seo_score, scraped_data) VALUES ($1, $2, $3, $4, $5)",
                            [resolvedOrgId, domain, apiKey, 0, { 
                                status: 'discovered', 
                                discovered_at: new Date().toISOString(),
                                sdk_verified: false,
                                script_detected: true
                            }]
                        );
                        console.log(`[Discovery] New site automatically discovered: ${domain} for Org ${resolvedOrgId}`);
                    } else {
                        // [Fix] If site was deleted, RESTORE it
                        const existingSiteId = checkRes.rows[0].id;
                        const existingData = checkRes.rows[0].scraped_data || {};
                        
                        console.log(`[SDK DEBUG] Existing site found: ID=${existingSiteId}, DeletedAt=${existingData.deleted_at}`);
                        if (existingData.deleted_at) {
                            await client.query(
                                "UPDATE sites SET scraped_data = (scraped_data - 'deleted_at') || '{\"status\": \"discovered\", \"script_detected\": true}'::jsonb WHERE id = $1",
                                [existingSiteId]
                            );
                            console.log(`[Discovery] Restored previously deleted site: ${domain}`);
                        }
                    }
                } catch (e) {
                    console.error("[Discovery] Error saving to DB:", e);
                }
            }
            res.set('Content-Type', 'application/javascript');
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            return res.send(`// v=${new Date().getTime()}\nconsole.log('BrightNetworks SDK (Discovery Mode): Site recorded. Waiting for admin approval.');`);
        }

        const defaults = {
            social_proof: { enabled: true, template: "{location} {customer}님이 {product}를 방금 구매했습니다!" },
            exit_intent: { enabled: true, text: "잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요..." },
            shipping_timer: { enabled: true, closing_hour: 16, text: "오늘 배송 마감까지 {timer} 남았습니다! 지금 주문하면 {delivery_date} 도착 예정." },
            scroll_reward: { enabled: true, depth: 80, text: "꼼꼼히 읽어주셔서 감사합니다! {product} 전용 시크릿 할인권을 드려요.", coupon: "SECRET10" },
            rental_calc: { enabled: true, period: 24, text: "이 제품, 하루 {daily_price}원이면 충분합니다. (월 {monthly_price}원 / {period}개월 기준)" },
            inactivity_nudge: { enabled: true, idle_seconds: 30, text: "혹시 더 궁금한 점이 있으신가요? {customer}님만을 위한 가이드를 확인해보세요!" }
        };

        const config = isVerified ? {
            ...defaults,
            ...((site.scraped_data || {}).automation || {})
        } : {
            social_proof: { enabled: false },
            exit_intent: { enabled: false },
            shipping_timer: { enabled: false },
            scroll_reward: { enabled: false },
            rental_calc: { enabled: false },
            inactivity_nudge: { enabled: false },
            tab_recovery: { enabled: false },
            price_match: { enabled: false }
        };

        const sdkHost = req.get('host');
        const apiBase = `//${sdkHost}`; 
        
        // [Debug] Log final site data before serving SDK
        console.log(`[SDK] Generating code for SiteID: ${site.id}, API_KEY: ${site.api_key || 'MISSING'}, Org: ${site.org_name} (#${site.org_id})`);
        
        // [Critical Fix] Ensure API_KEY is never 'undefined' string
        const finalApiKey = site.api_key || (key.includes('-') ? 'pending' : key);

        const sdkCode = `
            // Version: ${new Date().toISOString()}
            (function() {
                const config = ${JSON.stringify(config)};
                const siteData = ${JSON.stringify(site.scraped_data || {})};
                const API_KEY = '${finalApiKey}';
                const ORG_ID = ${site.org_id};
                const ORG_NAME = '${site.org_name}';
                const isVerified = ${isVerified};
                const API_BASE = '${apiBase}';
                const SITE_URL = '${site.url}';
                
                console.log('[BrightNetworks] SDK Loaded for ' + SITE_URL + ' (Org: ' + ORG_NAME + ' #' + ORG_ID + ')');
                if (!isVerified) {
                    console.log('[BrightNetworks] SDK: Connection established for ' + SITE_URL + '. Waiting for admin approval.');
                }
            
                const LearningEngine = {
                    scrollMarkers: new Set(),
                    
                    pulse: function(eventType, metadata = {}) {
                        console.log('[BrightSDK] Attempting to pulse event:', eventType, metadata);
                        
                        // Extract UTM parameters
                        const urlParams = new URLSearchParams(window.location.search);
                        const utm = {};
                        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(key => {
                            if (urlParams.has(key)) utm[key] = urlParams.get(key);
                        });

                        const data = JSON.stringify({
                            api_key: API_KEY,
                            event_type: eventType,
                            path: window.location.pathname + window.location.search,
                            referrer: document.referrer,
                            metadata: {
                                title: document.title,
                                viewport: { w: window.innerWidth, h: window.innerHeight },
                                utm: Object.keys(utm).length > 0 ? utm : null,
                                ...metadata
                            },
                            timestamp: new Date().toISOString()
                        });
            
                        const signalUrl = API_BASE + '/api/v1/learning/signal';
                        
                        // [Modern Standard] fetch with keepalive is more reliable for JSON and CORS than sendBeacon
                        if (window.fetch) {
                            fetch(signalUrl, { 
                                method: 'POST', 
                                headers: { 'Content-Type': 'application/json' },
                                body: data, 
                                keepalive: true 
                            })
                            .then(r => console.log('[BrightSDK] Pulse success:', eventType))
                            .catch(err => {
                                console.warn('[BrightSDK] Fetch pulse failed, falling back to sendBeacon:', err);
                                if (navigator.sendBeacon) {
                                    const blob = new Blob([data], { type: 'text/plain' });
                                    navigator.sendBeacon(signalUrl, blob);
                                }
                            });
                        } else if (navigator.sendBeacon) {
                            const blob = new Blob([data], { type: 'text/plain' });
                            navigator.sendBeacon(signalUrl, blob);
                        }
                    },
            
                    trackScroll: function() {
                        const scrollPercent = Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100);
                        [25, 50, 75, 100].forEach(marker => {
                            if (scrollPercent >= marker && !this.scrollMarkers.has(marker)) {
                                this.scrollMarkers.add(marker);
                                console.log('[BrightSDK] Scroll marker reached:', marker + '%');
                                this.pulse('scroll_depth', { depth: marker });
                            }
                        });
                    },
            
                    trackClicks: function(e) {
                        const target = e.target.closest('a, button, input[type="button"], input[type="submit"]');
                        if (target) {
                            console.log('[BrightSDK] Click detected on:', target.tagName);
                            this.pulse('click_interaction', {
                                tag: target.tagName,
                                text: (target.innerText || target.value || '').substring(0, 50).trim(),
                                id: target.id,
                                className: target.className,
                                href: target.href || null
                            });
                        }
                    },
            
                    trackForms: function(e) {
                        const form = e.target;
                        console.log('[BrightSDK] Form submission detected:', form.id || form.action);
                        const inputs = Array.from(form.querySelectorAll('input, select, textarea')).map(i => i.name || i.id).filter(Boolean);
                        this.pulse('form_submit', {
                            id: form.id,
                            action: form.action,
                            fields: inputs.slice(0, 5)
                        });
                    },
            
                    init: function() {
                        console.log('[BrightSDK] Initializing Learning Engine...');
                        this.pulse('page_view', { referrer: document.referrer });
                        
                        // 1. Scroll Tracking (Throttled)
                        let scrollTimeout;
                        window.addEventListener('scroll', () => {
                            if (!scrollTimeout) {
                                scrollTimeout = setTimeout(() => {
                                    this.trackScroll();
                                    scrollTimeout = null;
                                }, 500);
                            }
                        }, { passive: true });
            
                        // 2. Click Tracking
                        document.addEventListener('click', (e) => this.trackClicks(e), true);

                        // 3. Form Submission Tracking
                        document.addEventListener('submit', (e) => this.trackForms(e), true);
            
                        // 4. Performance/Load metrics
                        window.addEventListener('load', () => {
                            const nav = performance.getEntriesByType('navigation')[0];
                            if (nav) {
                                console.log('[BrightSDK] Performance metrics captured');
                                this.pulse('perf_metrics', { load_time: nav.duration });
                            }
                        });
                    }
                };
            
                LearningEngine.init();
            
                const styles = \`        .bn-widget { font-family: 'Pretendard', sans-serif; position: fixed; z-index: 999999; transition: all 0.3s ease; }
        .bn-toast { bottom: 20px; left: 20px; background: white; border-radius: 50px; padding: 12px 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); display: flex; align-items: center; font-size: 14px; border: 1px solid #eee; animation: bnSlideUp 0.5s ease-out; }
        .bn-popup { top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border-radius: 20px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.2); }
        .bn-nudge { top: 20px; left: 50%; transform: translateX(-50%); background: #34495e; color: white; padding: 10px 20px; border-radius: 30px; font-size: 13px; }
        @keyframes bnSlideUp { from { transform: translateY(100px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    \`;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    function showToast(msg, duration = 5000) {
        const toast = document.createElement('div');
        toast.className = "bn-widget bn-toast";
        toast.innerHTML = '<div style="width: 10px; height: 10px; background: #2ecc71; border-radius: 50%; margin-right: 12px;"></div>' + msg;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = "0"; toast.style.transform = "translateY(20px)"; setTimeout(() => toast.remove(), 500); }, duration);
    }

    // --- 마케팅 자동화 기능 실행 (승인된 사이트만) ---
    if (isVerified) {
        // 1. Social Proof
        if (config.social_proof?.enabled) {
            const locations = ['서울시', '부산시', '인천시', '하남시'];
            const customers = ['김*연', '이*준', '박*민'];
            const products = siteData.detected_products || ['인기 상품'];
            setInterval(() => {
                const loc = locations[Math.floor(Math.random() * locations.length)];
                const cust = customers[Math.floor(Math.random() * customers.length)];
                const prod = products[Math.floor(Math.random() * products.length)];
                showToast(config.social_proof.template.replace('{location}', '<b>'+loc+'</b>').replace('{customer}', '<b>'+cust+'</b>').replace('{product}', '<b>'+prod+'</b>'));
            }, 20000);
        }

        // 2. Shipping Countdown
        if (config.shipping_timer?.enabled) {
            function updateTimer() {
                const now = new Date();
                const deadline = new Date();
                deadline.setHours(config.shipping_timer.closing_hour, 0, 0, 0);
                
                if (now > deadline) return; // Passed deadline

                const diff = deadline - now;
                const h = Math.floor(diff / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                const s = Math.floor((diff % 60000) / 1000);
                const timerStr = \`\${h}시간 \${m}분 \${s}초\`;
                
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const dateStr = \`\${tomorrow.getMonth()+1}/\${tomorrow.getDate()}(\${['일','월','화','수','목','금','토'][tomorrow.getDay()]})\`;

                let timerEl = document.getElementById('bn-shipping-timer');
                if (!timerEl) {
                    timerEl = document.createElement('div');
                    timerEl.id = 'bn-shipping-timer';
                    timerEl.style = "position: sticky; top: 0; width: 100%; background: #ebf5ff; color: #2980b9; padding: 10px; text-align: center; font-size: 13px; font-weight: bold; z-index: 1000001; border-bottom: 1px solid #d6eaf8;";
                    document.body.prepend(timerEl);
                }
                timerEl.innerHTML = config.shipping_timer.text.replace('{timer}', '<span style="color: #e74c3c;">' + timerStr + '</span>').replace('{delivery_date}', '<b>' + dateStr + '</b>');
            }
            setInterval(updateTimer, 1000);
            updateTimer();
        }

        // 3. Scroll Reward
        if (config.scroll_reward?.enabled) {
            let triggered = false;
            window.addEventListener('scroll', () => {
                const scrollPercent = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
                if (scrollPercent > config.scroll_reward.depth && !triggered) {
                    triggered = true;
                    const prod = (siteData.detected_products && siteData.detected_products[0]) || '본 상품';
                    const popup = document.createElement('div');
                    popup.className = "bn-widget bn-popup";
                    popup.innerHTML = \`
                        <h3 style="margin-top:0">🎉 시크릿 혜택 발견!</h3>
                        <p style="font-size:14px; color:#666;">\${config.scroll_reward.text.replace('{product}', '<b>'+prod+'</b>')}</p>
                        <div style="background:#f9f9f9; padding:15px; border:2px dashed #ddd; font-size:20px; font-weight:bold; margin:20px 0; color:#e67e22;">\${config.scroll_reward.coupon}</div>
                        <button onclick="navigator.clipboard.writeText('\${config.scroll_reward.coupon}'); alert('쿠폰이 복사되었습니다!'); this.parentElement.remove();" style="background:#e67e22; color:white; border:none; padding:12px 30px; border-radius:10px; cursor:pointer; width:100%; font-weight:bold;">쿠폰 복사하고 혜택받기</button>
                        <div onclick="this.parentElement.remove()" style="margin-top:15px; font-size:12px; color:#999; cursor:pointer; text-decoration:underline;">다음에 받을게요</div>
                    \`;
                    document.body.appendChild(popup);
                }
            });
        }

        // 4. Rental Calculator (Signature)
        if (config.rental_calc?.enabled) {
            // Simple logic: find elements that look like prices
            setTimeout(() => {
                const priceRegex = /([0-9,]{4,10})원/;
                const elements = Array.from(document.querySelectorAll('span, div, p, strong')).filter(el => el.innerText.match(priceRegex));
                if (elements.length > 0) {
                    const target = elements[0];
                    const rawPrice = target.innerText.match(priceRegex)[1].replace(/,/g, '');
                    const price = parseInt(rawPrice);
                    if (price > 50000) { // Only for items > 50k
                        const monthly = Math.floor(price / config.rental_calc.period);
                        const daily = Math.floor(monthly / 30);
                        
                        const calcBtn = document.createElement('div');
                        calcBtn.style = "display: inline-block; margin-left: 10px; background: #f1f2f6; color: #57606f; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid #dfe4ea;";
                        calcBtn.innerHTML = "💡 렌탈료 계산";
                        target.appendChild(calcBtn);

                        calcBtn.onclick = (e) => {
                            e.stopPropagation();
                            alert(config.rental_calc.text
                                .replace('{daily_price}', daily.toLocaleString())
                                .replace('{monthly_price}', monthly.toLocaleString())
                                .replace('{period}', config.rental_calc.period)
                            );
                        };
                    }
                }
            }, 2000);
        }

        // 5. Inactivity Nudge
        if (config.inactivity_nudge?.enabled) {
            let idleTimer;
            const resetTimer = () => {
                clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    const nudge = document.createElement('div');
                    nudge.className = "bn-widget bn-nudge";
                    nudge.innerHTML = "💬 " + config.inactivity_nudge.text.replace('{customer}', '고객');
                    document.body.appendChild(nudge);
                    setTimeout(() => nudge.remove(), 8000);
                }, config.inactivity_nudge.idle_seconds * 1000);
            };
            ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => document.addEventListener(evt, resetTimer));
            resetTimer();
        }

        // 6. Exit Intent
        if (config.exit_intent?.enabled) {
            let showed = false;
            document.addEventListener('mouseleave', (e) => {
                if (e.clientY < 0 && !showed) {
                    showed = true;
                    showToast("🎁 " + config.exit_intent.text, 8000);
                }
            });
        }
    }
})();
        `;
        res.set('Content-Type', 'application/javascript');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
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
        // [Security] Verify ownership
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this site." });

        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || jsonb_build_object('automation', $1::jsonb) WHERE id = $2",
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
app.post('/api/debug/set-plan', isAuthenticated, async (req, res) => {
    const { organization_id, plan } = req.body;
    if (!['free', 'starter', 'pro'].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
    
    // Store plan in session for debugging/dev
    req.session.debug_plan = plan;
    req.session.save((err) => {
        if (err) return res.status(500).json({ error: "Session save failed" });
        res.json({ success: true, plan });
    });
});

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

app.get('/api/organizations/:id/discoveries', isAuthenticated, async (req, res) => {
    let orgId = req.params.id;
    
    // Try to decode if it looks like a public_id
    if (typeof orgId === 'string' && orgId.includes('-')) {
        const decoded = decodeOrgId(orgId);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        orgId = decoded;
    } else {
        orgId = parseInt(orgId);
    }

    const client = await pool.connect();
    try {
        // [Security] Verify ownership
        const orgRes = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [orgId, req.user.id]);
        if (orgRes.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this organization." });

        const result = await client.query(
            "SELECT url, scraped_data->>'discovered_at' as discovered_at FROM sites WHERE organization_id = $1 AND (scraped_data->>'status' = 'discovered')",
            [orgId]
        );
        res.json({ discoveries: result.rows.map(r => r.url) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

app.post('/api/organizations/:id/discoveries/clear', isAuthenticated, async (req, res) => {
    let orgId = req.params.id;
    
    // Try to decode if it looks like a public_id
    if (typeof orgId === 'string' && orgId.includes('-')) {
        const decoded = decodeOrgId(orgId);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        orgId = decoded;
    } else {
        orgId = parseInt(orgId);
    }

    const { url } = req.body;
    const client = await pool.connect();
    try {
        // [Security] Verify ownership
        const orgRes = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [orgId, req.user.id]);
        if (orgRes.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this organization." });

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
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 3. Site Routes (Analysis)
async function getUsage(organization_id) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const client = await pool.connect();
    try {
        // Count sites that have been actually analyzed (status = 'active') today
        const result = await client.query(
            "SELECT COUNT(*) FROM sites WHERE organization_id = $1 AND created_at >= $2 AND scraped_data->>'status' = 'active'",
            [organization_id, startOfDay]
        );
        return parseInt(result.rows[0].count);
    } finally {
        client.release();
    }
}

app.get('/api/usage', isAuthenticated, async (req, res) => {
    let { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID is required" });
    
    // Try to decode if it looks like a public_id
    if (typeof organization_id === 'string' && organization_id.includes('-')) {
        const decoded = decodeOrgId(organization_id);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        organization_id = decoded;
    }

    const client = await pool.connect();
    try {
        // [Security] Verify ownership before checking usage
        const orgRes = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [organization_id, req.user.id]);
        if (orgRes.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this organization." });

        const count = await getUsage(organization_id);
        const plan = req.session.debug_plan || 'free';
        let limit = 1;
        if (plan === 'starter') limit = 10;
        if (plan === 'pro') limit = 30;

        res.json({ used: count, limit: limit, plan: plan });
    } catch (err) {
        res.status(500).json({ error: "Usage check failed" });
    } finally {
        client.release();
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
    let { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID is required" });

    // Try to decode if it looks like a public_id
    if (typeof organization_id === 'string' && organization_id.includes('-')) {
        const decoded = decodeOrgId(organization_id);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        organization_id = decoded;
    }

    const client = await pool.connect();
    try {
        // [Security] Ensure the organization belongs to the authenticated user
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
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

app.get('/api/sites/trash', isAuthenticated, async (req, res) => {
    let { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID is required" });

    // Try to decode if it looks like a public_id
    if (typeof organization_id === 'string' && organization_id.includes('-')) {
        const decoded = decodeOrgId(organization_id);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        organization_id = decoded;
    }

    const client = await pool.connect();
    try {
        // [Security] Verify ownership before fetching trash
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
        // [Security] Verify ownership
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this site." });

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
        // [Security] Verify ownership
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this site." });

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

app.delete('/api/sites/:id/permanent', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        // [Security] Verify ownership
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this site." });

        // Hard delete from database
        await client.query("DELETE FROM sites WHERE id = $1", [id]);
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
        // [Security] Verify ownership
        const result = await client.query(
            "SELECT s.* FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Report not found or unauthorized." });
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
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true
        });
        const page = await context.newPage();
        
        console.log(`[Playwright] Navigation started...`);
        // Use 'networkidle' for more complete content capture, but with a reasonable timeout
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        console.log(`[Playwright] Page loaded. Waiting for stability...`);
        await page.waitForTimeout(3000);

        // Take Screenshot
        const screenshotName = `screenshot_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
        const screenshotPath = path.join(__dirname, 'public', 'screenshots', screenshotName);
        console.log(`[Playwright] Taking screenshot: ${screenshotName}`);
        await page.screenshot({ path: screenshotPath, fullPage: false }); 

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
    } catch (err) {
        console.error(`[Playwright] Scrape failed for ${url}:`, err);
        throw err; // Re-throw to be handled by caller
    } finally {
        if (browser) {
            console.log(`[Playwright] Closing browser for: ${url}`);
            await browser.close();
        }
    }
}

// --- Analysis Engine ---

async function processSiteAnalysis(siteId) {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT * FROM sites WHERE id = $1", [siteId]);
        const site = res.rows[0];
        if (!site) return;

        console.log(`[Auto-Analysis] Starting analysis for: ${site.url}`);
        const { seoData, markdown, screenshotName } = await scrapeUrl(site.url);

        const prompt = `
            당신은 세계 최고의 쇼핑몰 CRO(전환율 최적화) 전문가이자 'GEO(Generative Engine Optimization)' 전략가입니다. 
            제공된 데이터를 바탕으로 고객사 쇼핑몰의 전환율을 극대화하고, ChatGPT/Perplexity와 같은 AI 검색 엔진에 최적으로 노출되기 위한 전략을 생성하세요.

            --- 수집된 기술적 SEO 데이터 ---
            ${JSON.stringify(seoData)}
            
            --- 페이지 콘텐츠 요약 (Markdown) ---
            ${markdown}
            
            --- 작업 지침 ---
            1. 사이트의 분위기(톤앤매너)에 어울리는 마케팅 문구를 작성하세요.
            2. 상품 가격대를 분석하여 '렌탈 계산기' 활성 여부와 할부 기간(12, 24, 36, 48)을 결정하세요. (5만원 이상 상품 존재 시 활성화 권장)
            3. 배송 관련 언급이 있다면 '배송 타이머' 문구에 반영하세요.
            4. '스크롤 보상' 쿠폰명은 브랜드명과 어울리게 지어주세요.
            5. **시멘틱 최적화 섹션:** 메타 title, keywords, description, canonical 태그를 반드시 포함하여 추천 코드를 생성하세요. SEO 점수를 위해 <h1> 태그는 반드시 사용하되, display:none이나 0px 등 숨김 처리 기법은 절대 사용하지 마세요.
            6. **GEO 섹션:** 단순 메타태그가 아니라, AI가 브랜드의 신뢰도와 전문성을 이해할 수 있도록 '지식 그래프' 관점의 JSON-LD 스키마와 'Semantic Context' 데이터를 구성하세요. (FAQ, Product, Review 스키마 등 활용)

            --- 응답 JSON 구조 (필수 포함) ---
            {
                "seo_score": (0~100 숫자),
                "summary": "비즈니스 핵심 요약",
                "advice": { "semantics": "...", "meta": "...", "images": "...", "schemas": "...", "links": "..." },
                "automation_recommendations": {
                    "social_proof": { "enabled": true, "template": "..." },
                    "exit_intent": { "enabled": true, "text": "..." },
                    "shipping_timer": { "enabled": true, "closing_hour": 16, "text": "..." },
                    "scroll_reward": { "enabled": true, "depth": 80, "text": "...", "coupon": "..." },
                    "rental_calc": { "enabled": (true/false), "period": (12/24/36/48), "text": "..." },
                    "inactivity_nudge": { "enabled": true, "idle_seconds": 30, "text": "..." },
                    "tab_recovery": { "enabled": true, "text": "..." },
                    "price_match": { "enabled": true, "text": "..." }
                },
                "detected_products": ["상품1", "상품2"],
                "ceo_message": "...",
                "sample_codes": { 
                    "seo": "시멘틱 최적화를 위한 필수 메타 태그(title, keywords, description, canonical) 및 HTML 구조 가이드. (주의: <h1> 태그에 display:none을 사용하지 마세요)", 
                    "geo": "AI 검색 엔진을 위한 고급 JSON-LD 및 컨텍스트 데이터" 
                }
            }
        `;

        // --- AI Analysis with Intelligent Retry (Handling 429 & 503) ---
        let result = null;
        let attempts = 0;
        const maxAttempts = 5; // 재시도 횟수 상향
        
        while (attempts < maxAttempts) {
            try {
                result = await model.generateContent(prompt);
                if (result) break; // Success!
            } catch (err) {
                attempts++;
                const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
                
                if (isRateLimit) {
                    const delaySeconds = 60; // 대기 시간 60초로 연장
                    console.warn(`[AI] Rate limit hit (429). Waiting ${delaySeconds}s before attempt ${attempts + 1}...`);
                    await new Promise(r => setTimeout(r, delaySeconds * 1000));
                } else {
                    console.error(`[AI Analysis] Attempt ${attempts} failed:`, err.message);
                    if (attempts >= maxAttempts) throw err;
                    await new Promise(r => setTimeout(r, 2000 * attempts));
                }
            }
        }
        
        if (!result) throw new Error("AI 분석 결과 생성에 실패했습니다 (최대 재시도 초과)");
        const textResponse = result.response.text();
        
        let aiResult = {};
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) aiResult = JSON.parse(jsonMatch[0]);

        // Archive current data to history before updating
        const currentData = site.scraped_data || {};
        const history = currentData.history || [];
        
        // Create a snapshot of current data (excluding history itself to avoid recursion)
        if (currentData.status === 'active') {
            const { history: _, ...snapshot } = currentData;
            snapshot.archived_at = new Date().toISOString();
            history.unshift(snapshot); // Newest first
        }

        // Limit history to last 10 runs to save space
        const limitedHistory = history.slice(0, 10);

        // Update site with results, applying AI automation recommendations
        await client.query(
            "UPDATE sites SET seo_score = $1, scraped_data = COALESCE(scraped_data, '{}'::jsonb) || $2::jsonb WHERE id = $3",
            [
                aiResult.seo_score || 0, 
                JSON.stringify({ 
                    ...aiResult, 
                    automation: aiResult.automation_recommendations,
                    learning_progress: 25,
                    event_count: 0,
                    raw_seo: seoData, 
                    screenshot: screenshotName, 
                    status: 'active', 
                    analyzed_at: new Date().toISOString(),
                    history: limitedHistory
                }), 
                siteId
            ]
        );
        console.log(`[Auto-Analysis] Completed for ${site.url}`);
    } catch (err) {
        console.error(`[Auto-Analysis] Failed for Site ${siteId}:`, err);
        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"status\": \"error\", \"analysis_error\": \"Failed to process\"}'::jsonb WHERE id = $1",
            [siteId]
        );
    } finally {
        client.release();
    }
}

// Background Worker: Every 1 minute, check for 'discovered' sites
setInterval(async () => {
    const client = await pool.connect();
    try {
        const res = await client.query(
            "SELECT id FROM sites WHERE (scraped_data->>'status' = 'discovered') LIMIT 3"
        );
        for (const row of res.rows) {
            await processSiteAnalysis(row.id);
        }
    } catch (e) {
        console.error("[Worker] Error fetching discovered sites:", e);
    } finally {
        client.release();
    }
}, 60000);

app.post('/api/sites/:id/analyze', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    
    // Check limit first
    const client = await pool.connect();
    try {
        // [Security] Verify ownership and get orgId in one query
        const siteRes = await client.query(
            "SELECT s.organization_id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2", 
            [id, req.user.id]
        );
        if (siteRes.rows.length === 0) return res.status(404).json({ error: "Site not found or unauthorized." });
        
        const orgId = siteRes.rows[0].organization_id;
        const used = await getUsage(orgId);
        
        const plan = req.session.debug_plan || 'free';
        let limit = 1;
        if (plan === 'starter') limit = 10;
        if (plan === 'pro') limit = 30;
        
        if (used >= limit) {
            return res.status(403).json({ error: `오늘의 분석 한도(${limit}회)를 모두 사용하셨습니다. 내일 다시 시도하거나 플랜을 업그레이드해주세요.` });
        }

        // Run analysis
        await processSiteAnalysis(id);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Analysis failed" });
    } finally {
        client.release();
    }
});

app.post('/api/sites', isAuthenticated, async (req, res) => {
    let { organization_id, url, skip_analysis } = req.body;
    if (!organization_id || !url) return res.status(400).json({ error: "Org ID and URL are required" });

    // Try to decode if it looks like a public_id
    if (typeof organization_id === 'string' && organization_id.includes('-')) {
        const decoded = decodeOrgId(organization_id);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        organization_id = decoded;
    }

    // URL 정규화 (Origin만 추출하여 중복 방지)
    let normalizedUrl = url;
    try {
        const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
        normalizedUrl = urlObj.origin;
    } catch (e) {
        console.error("[API] Invalid URL provided:", url);
    }

    const client = await pool.connect();
    try {
        // [Security] Verify ownership
        const orgRes = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [organization_id, req.user.id]);
        if (orgRes.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this organization." });

        // 기존에 등록된 사이트가 있는지 확인 (삭제되지 않은 것 중)
        const existingRes = await client.query(
            "SELECT id FROM sites WHERE organization_id = $1 AND url = $2 AND NOT (scraped_data ? 'deleted_at')",
            [organization_id, normalizedUrl]
        );

        if (existingRes.rows.length > 0) {
            return res.json({ success: false, error: "이미 등록된 사이트입니다." });
        }

        const currentUsage = await getUsage(organization_id);
        if (currentUsage >= 1000) return res.status(403).json({ error: "분석 횟수 제한 도달" });

        const apiKey = crypto.randomBytes(16).toString('hex');
        const insertRes = await client.query(
            'INSERT INTO sites (organization_id, url, api_key, seo_score, scraped_data) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [organization_id, normalizedUrl, apiKey, 0, { status: 'registered', manual_added: true }]
        );

        // 비동기로 분석 시작 (skip_analysis가 아닐 때만)
        if (!skip_analysis) {
            processSiteAnalysis(insertRes.rows[0].id);
        }

        const publicId = encodeOrgId(organization_id);
        res.json({ 
            success: true, 
            site: insertRes.rows[0], 
            script_tag: `<script src="https://api.brightnetworks.kr/sdk.js?key=${publicId}" async></script>` 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 5. Approve Site (SDK Verification)
app.post('/api/sites/:id/approve', isAuthenticated, async (req, res) => {
    const siteId = parseInt(req.params.id);
    const client = await pool.connect();
    try {
        // [Security] Verify ownership
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [siteId, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this site." });

        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"sdk_verified\": true, \"status\": \"active\"}'::jsonb WHERE id = $1",
            [siteId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
});

// 6. Reject Site
app.post('/api/sites/:id/reject', isAuthenticated, async (req, res) => {
    const siteId = parseInt(req.params.id);
    const client = await pool.connect();
    try {
        // [Security] Verify ownership
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [siteId, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this site." });

        // [Reject Logic] 승인 거부 시 상태를 'rejected'로 변경하고 대시보드에서 숨깁니다.
        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"status\": \"rejected\", \"rejected_at\": \"' || CURRENT_TIMESTAMP || '\"}'::jsonb WHERE id = $1",
            [siteId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
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