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
const BETA_MODE = process.env.BETA_MODE === 'true';

// --- Global Logger Prefix ---
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const getTimestamp = () => {
    const now = new Date();
    return `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
};

console.log = (...args) => originalLog(getTimestamp(), ...args);
console.error = (...args) => originalError(getTimestamp(), ...args);
console.warn = (...args) => originalWarn(getTimestamp(), ...args);

// --- Plan & Limit Helpers ---
function getPlanDetails(req) {
    // If BETA_MODE is enabled, everyone gets 'pro' features for free
    if (BETA_MODE) {
        return {
            plan: 'pro',
            limit: 10,
            isBeta: true
        };
    }

    const plan = req.session.debug_plan || 'free';
    let limit = 1;
    if (plan === 'starter') limit = 5;
    if (plan === 'pro') limit = 10;

    return {
        plan: plan,
        limit: limit,
        isBeta: false
    };
}

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
        maxAge: 30 * 60 * 1000, // 30 minutes
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
    const planInfo = getPlanDetails(req);
    res.json({ 
        user: req.user,
        plan: planInfo.plan,
        isBeta: planInfo.isBeta
    });
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

        // Current Latest Timestamp to save as next checkpoint
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
            
            // New: Record AI Log for Dashboard & Update Checkpoint
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
            social_proof: { enabled: false, template: "{location} {customer}님이 {product}를 방금 구매했습니다!" },
            exit_intent: { enabled: false, text: "잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요..." },
            shipping_timer: { enabled: false, closing_hour: 16, text: "오늘 배송 마감까지 {timer} 남았습니다! 지금 주문하면 {delivery_date} 도착 예정." },
            scroll_reward: { enabled: false, depth: 80, text: "꼼꼼히 읽어주셔서 감사합니다! {product} 전용 시크릿 할인권을 드려요.", coupon: "SECRET10" },
            rental_calc: { enabled: false, period: 24, text: "이 제품, 하루 {daily_price}원이면 충분합니다. (월 {monthly_price}원 / {period}개월 기준)" },
            inactivity_nudge: { enabled: false, idle_seconds: 30, text: "혹시 더 궁금한 점이 있으신가요? {customer}님만을 위한 가이드를 확인해보세요!" }
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
                const msg = config.social_proof.template.replace('{location}', '<b>'+loc+'</b>').replace('{customer}', '<b>'+cust+'</b>').replace('{product}', '<b>'+prod+'</b>');
                showToast(msg);
                LearningEngine.pulse('social_proof', { message: msg });
            }, 20000);
        }

        // 2. Shipping Countdown
        if (config.shipping_timer?.enabled) {
            let timerShowed = false;
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
                    if (!timerShowed) {
                        LearningEngine.pulse('shipping_timer', { text: config.shipping_timer.text });
                        timerShowed = true;
                    }
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
                        <button id="bn-coupon-copy" style="background:#e67e22; color:white; border:none; padding:12px 30px; border-radius:10px; cursor:pointer; width:100%; font-weight:bold;">쿠폰 복사하고 혜택받기</button>
                        <div id="bn-coupon-close" style="margin-top:15px; font-size:12px; color:#999; cursor:pointer; text-decoration:underline;">다음에 받을게요</div>
                    \`;
                    document.body.appendChild(popup);
                    LearningEngine.pulse('scroll_reward_show', { depth: config.scroll_reward.depth });

                    document.getElementById('bn-coupon-copy').onclick = function() {
                        navigator.clipboard.writeText(config.scroll_reward.coupon);
                        alert('쿠폰이 복사되었습니다!');
                        LearningEngine.pulse('scroll_reward_claim', { coupon: config.scroll_reward.coupon });
                        popup.remove();
                    };
                    document.getElementById('bn-coupon-close').onclick = function() {
                        popup.remove();
                    };
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
                            LearningEngine.pulse('rental_calc_click', { price: price });
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
                    LearningEngine.pulse('inactivity_nudge', { text: config.inactivity_nudge.text });
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
                    LearningEngine.pulse('exit_intent', { text: config.exit_intent.text });
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
    if (BETA_MODE) return res.status(403).json({ error: "BETA MODE가 활성화되어 있어 플랜을 수동으로 변경할 수 없습니다. 현재 전원 Pro 혜택이 적용 중입니다." });

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
        const planInfo = getPlanDetails(req);

        res.json({
            used: count,
            limit: planInfo.limit,
            plan: planInfo.plan,
            isBeta: planInfo.isBeta
        });
        } catch (err) {
        res.status(500).json({ error: "Usage check failed" });
        } finally {
        client.release();
        }
        });

        app.get('/api/dashboard/stats', isAuthenticated, async (req, res) => {
        let { organization_id } = req.query;
        if (!organization_id) return res.status(400).json({ error: "Org ID is required" });

        // Decode public ID if needed
        if (typeof organization_id === 'string' && organization_id.includes('-')) {
        const decoded = decodeOrgId(organization_id);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        organization_id = decoded;
        }

        const client = await pool.connect();
        try {
        // [Security] Verify ownership
        const orgCheck = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [organization_id, req.user.id]);
        if (orgCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access" });

        // Get all sites for this org to process their logs
        const sitesRes = await client.query("SELECT id, url, seo_score, scraped_data FROM sites WHERE organization_id = $1 AND NOT (COALESCE(scraped_data, '{}'::jsonb) ? 'deleted_at')", [organization_id]);
        const sites = sitesRes.rows;

        let totalRecovered = 0;
        let totalPrevention = 0;
        let totalVisitors24h = 0;
        let avgSeo = 0;
        let allLogs = [];
        const revenueTrend = [0, 0, 0, 0, 0, 0, 0]; // Last 7 days
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

                    // Prevention events
                    const isPrevention = ['exit_intent', 'cart_abandoned', 'scroll_reward_claim', 'coupon_copied'].includes(log.type);

                    if (diffDays < 7) {
                        if (isPrevention) {
                            totalPrevention++;
                            totalRecovered += 50000; // Mock value: ₩50,000 per recovery
                            revenueTrend[6 - diffDays] += 50000;
                        }
                    }

                    if (diffDays === 0) {
                        totalVisitors24h++;
                    }

                    // Filter for marketing automation events for the real-time log
                    const isAutomationEvent = [
                        'scroll_reward_claim',
                        'rental_calc_click',
                        'coupon_copied',
                        'cart_abandoned'
                    ].includes(log.type);
                    if (isAutomationEvent) {
                        allLogs.push({
                            ...log,
                            site_url: site.url
                        });
                    }
                });
            });
            avgSeo = Math.round(seoSum / sites.length);
        }

        // 4. Marketing Insights Logic (Integrated)
        const utmPerformance = {};
        const funnelData = {};
        let widgetConv = 0, nonWidgetConv = 0, widgetViews = 0, nonWidgetViews = 0;
        const aiOptimizationLogs = [];

        sites.forEach(site => {
            const sLogs = site.scraped_data?.behavior_logs || [];
            const sAiLogs = site.scraped_data?.ai_logs || [];
            if (sAiLogs.length > 0) aiOptimizationLogs.push(...sAiLogs.map(l => ({ ...l, site_url: site.url })));

            sLogs.forEach(log => {
                const source = log.meta?.utm?.utm_source || 'organic';
                if (!utmPerformance[source]) utmPerformance[source] = { views: 0, reactions: 0 };
                
                if (log.type === 'page_view') {
                    utmPerformance[source].views++;
                    if (!funnelData[log.path]) funnelData[log.path] = { views: 0, exits: 0 };
                    funnelData[log.path].views++;
                    if (Math.random() > 0.5) nonWidgetViews++; else widgetViews++;
                }

                const isReaction = ['scroll_reward_claim', 'rental_calc_click', 'coupon_copied', 'cart_abandoned', 'exit_intent'].includes(log.type);
                if (isReaction) {
                    utmPerformance[source].reactions++;
                    widgetConv++;
                }
                if (log.type === 'form_submit' || log.type === 'purchase') nonWidgetConv++;
            });
        });

        const sortedFunnel = Object.entries(funnelData)
            .map(([path, data]) => ({ path, ...data, rate: Math.round((data.exits / data.views) * 100) || 0 }))
            .sort((a, b) => b.views - a.views).slice(0, 5);

        const formattedUtm = Object.entries(utmPerformance).map(([source, data]) => ({
            source, ...data, cvr: data.views > 0 ? ((data.reactions / data.views) * 100).toFixed(1) : 0
        })).sort((a, b) => b.views - a.views);

        // Sort logs by timestamp desc
        allLogs.sort((a, b) => new Date(b.ts) - new Date(a.ts));
        const recentLogs = allLogs.slice(0, 10);

        res.json({
            recovered: totalRecovered,
            prevention: totalPrevention,
            visitors: totalVisitors24h,
            seo: avgSeo,
            revenueData: revenueTrend,
            eventLog: recentLogs,
            // Integrated Insights
            attribution: {
                widget: { views: widgetViews, conv: widgetConv, cvr: widgetViews > 0 ? ((widgetConv/widgetViews)*100).toFixed(1) : 0 },
                nonWidget: { views: nonWidgetViews, conv: nonWidgetConv, cvr: nonWidgetViews > 0 ? ((nonWidgetConv/nonWidgetViews)*100).toFixed(1) : 0 }
            },
            utm: formattedUtm,
            funnel: sortedFunnel,
            aiLogs: aiOptimizationLogs.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 10)
        });
        } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch dashboard stats" });
        } finally {
        client.release();
        }
        });

app.get('/api/marketing-insights', isAuthenticated, async (req, res) => {
    let { organization_id } = req.query;
    if (!organization_id) return res.status(400).json({ error: "Org ID required" });

    if (typeof organization_id === 'string' && organization_id.includes('-')) {
        const decoded = decodeOrgId(organization_id);
        if (decoded) organization_id = decoded;
    }

    const client = await pool.connect();
    try {
        const orgCheck = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [organization_id, req.user.id]);
        if (orgCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized access" });

        const sitesRes = await client.query("SELECT id, url, scraped_data FROM sites WHERE organization_id = $1 AND NOT (COALESCE(scraped_data, '{}'::jsonb) ? 'deleted_at')", [organization_id]);
        const sites = sitesRes.rows;

        // Analytics structure
        const utmPerformance = {}; // { source: { clicks: 0, conv: 0 } }
        const funnelData = {}; // { path: { views: 0, exits: 0 } }
        let widgetConv = 0;
        let nonWidgetConv = 0;
        let widgetViews = 0;
        let nonWidgetViews = 0;
        const aiOptimizationLogs = [];

        sites.forEach(site => {
            const logs = site.scraped_data?.behavior_logs || [];
            const aiLogs = site.scraped_data?.ai_logs || [];
            if (aiLogs.length > 0) aiOptimizationLogs.push(...aiLogs.map(l => ({ ...l, site_url: site.url })));

            // 1. Group logs by session to find real exits
            const sessionMap = {}; // { session_id: [logs] }
            logs.forEach(log => {
                const sid = log.sid || log.meta?.sid || 'anonymous';
                if (!sessionMap[sid]) sessionMap[sid] = [];
                sessionMap[sid].push(log);
            });

            // 2. Identify the last page of each session
            Object.values(sessionMap).forEach(sLogs => {
                const pageViews = sLogs.filter(l => l.type === 'page_view')
                                       .sort((a, b) => new Date(a.ts) - new Date(b.ts));
                
                if (pageViews.length > 0) {
                    const lastPage = pageViews[pageViews.length - 1];
                    if (!funnelData[lastPage.path]) funnelData[lastPage.path] = { views: 0, exits: 0 };
                    lastPage._is_exit = true; // Mark for later
                }
            });

            // 3. Process all logs for general stats
            logs.forEach(log => {
                const source = log.meta?.utm?.utm_source || 'organic';
                if (!utmPerformance[source]) utmPerformance[source] = { views: 0, reactions: 0 };
                
                if (log.type === 'page_view') {
                    utmPerformance[source].views++;
                    if (!funnelData[log.path]) funnelData[log.path] = { views: 0, exits: 0 };
                    funnelData[log.path].views++;
                    
                    if (log._is_exit) {
                        funnelData[log.path].exits++;
                    }

                    if (Math.random() > 0.5) nonWidgetViews++;
                    else widgetViews++;
                }

                const isReaction = ['scroll_reward_claim', 'rental_calc_click', 'coupon_copied', 'cart_abandoned', 'exit_intent'].includes(log.type);
                if (isReaction) {
                    utmPerformance[source].reactions++;
                    widgetConv++;
                }

                if (log.type === 'form_submit' || log.type === 'purchase') {
                    nonWidgetConv++; 
                }
            });
        });

        // Format Funnel (Focus on Meaningful Leaks: Filter 0% and Low Traffic)
        const sortedFunnel = Object.entries(funnelData)
            .map(([path, data]) => ({ 
                path, 
                ...data, 
                rate: data.views > 0 ? parseFloat(((data.exits / data.views) * 100).toFixed(2)) : 0 
            }))
            .filter(f => f.rate > 0 && f.views >= 5) // Meaningful: Must have exits and at least 5 views
            .sort((a, b) => b.exits - a.exits) // Business Impact: Most people lost first
            .slice(0, 5);

        // Format UTM Performance
        const formattedUtm = Object.entries(utmPerformance).map(([source, data]) => ({
            source,
            ...data,
            cvr: ((data.reactions / data.views) * 100).toFixed(1)
        })).sort((a, b) => b.views - a.views);

        res.json({
            attribution: {
                widget: { views: widgetViews, conv: widgetConv, cvr: ((widgetConv/widgetViews)*100).toFixed(1) },
                nonWidget: { views: nonWidgetViews, conv: nonWidgetConv, cvr: ((nonWidgetConv/nonWidgetViews)*100).toFixed(1) }
            },
            utm: formattedUtm,
            funnel: sortedFunnel,
            revenueRecovered: widgetConv * 50000,
            aiLogs: aiOptimizationLogs.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 10)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch marketing insights" });
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

// --- Robust JSON Parser for AI Responses ---
function robustJSONParse(str) {
    if (!str) return null;
    
    // Extract everything between the first '{' and the last '}'
    const jsonMatch = str.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    let cleanStr = jsonMatch[0];
    
    try {
        // First try standard parse
        return JSON.parse(cleanStr);
    } catch (e) {
        console.warn("[JSON Parser] Standard parse failed, attempting cleanup...");
        
        try {
            // Attempt secondary cleanup:
            // 1. Remove single-line comments (// ...)
            // 2. Remove trailing commas before closing braces/brackets
            cleanStr = cleanStr
                .replace(/\/\/.*$/gm, '') 
                .replace(/,(\s*[\]\}])/g, '$1')
                .trim();
            
            return JSON.parse(cleanStr);
        } catch (e2) {
            console.error("[JSON Parser] Critical parse error. Raw string snippet:", cleanStr.substring(0, 200) + "...");
            throw e2;
        }
    }
}

async function scrapeUrl(url, device = 'desktop') {
    let browser;
    try {
        console.log(`[Playwright] Launching browser for: ${url} (${device})`);
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const deviceConfigs = {
            desktop: {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                viewport: { width: 1440, height: 900 }
            },
            mobile: {
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                viewport: { width: 390, height: 844 },
                isMobile: true,
                hasTouch: true
            }
        };

        const config = deviceConfigs[device] || deviceConfigs.desktop;

        const context = await browser.newContext({
            userAgent: config.userAgent,
            viewport: config.viewport,
            isMobile: config.isMobile || false,
            hasTouch: config.hasTouch || false,
            ignoreHTTPSErrors: true
        });        const page = await context.newPage();
        
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

// Helper to get raw PDF buffer
async function generatePDFBuffer(siteData, siteUrl) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const context = await browser.newContext();
        const page = await context.newPage();

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    body { font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; padding: 40px; color: #2c3e50; line-height: 1.6; }
                    .header { border-bottom: 2px solid #3498db; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
                    .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
                    .seo-score { font-size: 48px; font-weight: 800; color: #2ecc71; }
                    .section-title { border-left: 5px solid #3498db; padding-left: 15px; margin: 30px 0 15px; font-weight: bold; font-size: 18px; break-after: avoid; }
                    .advice-card { background: #f8f9fa; border-radius: 10px; padding: 15px; margin-bottom: 10px; height: 100%; border: 1px solid #eee; break-inside: avoid; }
                    .advice-title { font-weight: bold; font-size: 13px; color: #7f8c8d; margin-bottom: 5px; text-transform: uppercase; }
                    .ceo-msg { white-space: pre-wrap; background: #fffcf0; border: 1px solid #f1e7bc; padding: 20px; border-radius: 10px; font-style: italic; break-inside: avoid; }
                    .badge-aio { padding: 8px 12px; border-radius: 8px; font-weight: bold; font-size: 12px; }
                    .bg-good { background: #e8f8f5; color: #27ae60; }
                    .bg-warning { background: #fef9e7; color: #f39c12; }
                    .bg-bad { background: #fdedec; color: #e74c3c; }
                    .row { break-inside: avoid; }
                    @media print {
                        .section-title, .advice-card, .ceo-msg, .row { break-inside: avoid; page-break-inside: avoid; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="logo">Bright Networks <span style="font-weight: normal; color: #95a5a6;">| AI SEO Report</span></div>
                    <div class="text-end">
                        <div class="small text-muted">분석 일시: ${new Date(siteData.analyzed_at || new Date()).toLocaleString('ko-KR')}</div>
                        <div class="small fw-bold text-primary">${siteUrl}</div>
                    </div>
                </div>

                <div class="row align-items-stretch mb-4">
                    <div class="col-4 text-center d-flex flex-column justify-content-center">
                        <div class="text-muted small mb-1">종합 SEO 점수</div>
                        <div class="seo-score">${siteData.seo_score}</div>
                        <div class="text-muted extra-small">최적화 완료</div>
                    </div>
                    <div class="col-8">
                        <h5 class="fw-bold mb-3">AI 비즈니스 요약</h5>
                        <p class="text-muted small">${siteData.summary || '분석된 요약 정보가 없습니다.'}</p>
                    </div>
                </div>

                <div class="section-title">Senior Marketer's Insight</div>
                <div class="ceo-msg mb-4 small">${siteData.ceo_message || '분석 의견을 준비 중입니다.'}</div>

                <div class="section-title">AIO (AI 검색 최적화) 지수</div>
                <div class="row text-center mb-4">
                    <div class="col-4">
                        <div class="advice-card">
                            <div class="advice-title">ChatGPT</div>
                            <span class="badge-aio ${getAioClass(siteData.ai_visibility?.chatgpt_readiness)}">${siteData.ai_visibility?.chatgpt_readiness || '-'}</span>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="advice-card">
                            <div class="advice-title">Perplexity</div>
                            <span class="badge-aio ${getAioClass(siteData.ai_visibility?.perplexity_readiness)}">${siteData.ai_visibility?.perplexity_readiness || '-'}</span>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="advice-card">
                            <div class="advice-title">Gemini</div>
                            <span class="badge-aio ${getAioClass(siteData.ai_visibility?.gemini_readiness)}">${siteData.ai_visibility?.gemini_readiness || '-'}</span>
                        </div>
                    </div>
                </div>

                <div class="section-title">분야별 최적화 가이드</div>
                <div class="row g-3">
                    <div class="col-6"><div class="advice-card"><div class="advice-title">🏷️ 메타 정보</div><div class="small">${siteData.advice?.meta || '-'}</div></div></div>
                    <div class="col-6"><div class="advice-card"><div class="advice-title">🏗️ 사이트 구조</div><div class="small">${siteData.advice?.semantics || '-'}</div></div></div>
                    <div class="col-6"><div class="advice-card"><div class="advice-title">🖼️ 이미지 최적화</div><div class="small">${siteData.advice?.images || '-'}</div></div></div>
                    <div class="col-6"><div class="advice-card"><div class="advice-title">🔗 연결성</div><div class="small">${siteData.advice?.links || '-'}</div></div></div>
                    <div class="col-12"><div class="advice-card"><div class="advice-title">💎 구조화 데이터 (Schema.org)</div><div class="small">${siteData.advice?.schemas || '-'}</div></div></div>
                </div>

                <div class="mt-5 p-4 bg-light rounded text-center small text-muted" style="font-size: 10px;">
                    본 리포트는 Bright Networks의 AI 엔진에 의해 자동 생성되었습니다. <br>
                    더 자세한 대시보드 확인은 <a href="https://marine.brightnetworks.kr">marine.brightnetworks.kr</a>에서 가능합니다.
                </div>
            </body>
            </html>
        `;

        function getAioClass(status) {
            if (!status) return '';
            if (status.toLowerCase().includes('good')) return 'bg-good';
            if (status.toLowerCase().includes('warning')) return 'bg-warning';
            return 'bg-bad';
        }

        await page.setContent(htmlContent);
        return await page.pdf({ format: 'A4', printBackground: true });
    } finally {
        if (browser) await browser.close();
    }
}

// --- PDF & Email Helper ---
async function generateAndSendPDFReport(email, siteData, siteUrl) {
    if (!process.env.RESEND_API_KEY) {
        console.warn("[Email] RESEND_API_KEY missing, skipping PDF email.");
        return;
    }

    try {
        const pdfBuffer = await generatePDFBuffer(siteData, siteUrl);
        const hostname = new URL(siteUrl).hostname;

        await resend.emails.send({
            from: 'Bright Networks <seo@updates.brightnetworks.kr>',
            to: email,
            subject: `[Bright Networks] ${hostname} AI SEO 분석 리포트`,
            html: `<p>안녕하세요,</p><p>요청하신 <b>${siteUrl}</b>의 AI SEO 분석이 완료되었습니다. 첨부된 PDF 리포트를 확인해주세요.</p><p>감사합니다.<br>Bright Networks 팀 드림</p>`,
            attachments: [
                {
                    filename: `BrightNetworks_SEO_Report_${hostname}.pdf`,
                    content: pdfBuffer,
                },
            ],
        });
        console.log(`[Email] Report sent successfully to ${email}`);
    } catch (err) {
        console.error("[PDF/Email] Error:", err);
    }
}

// --- Report Export Endpoints ---

app.get('/api/reports/:id/pdf', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query(
            "SELECT s.* FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Report not found" });
        
        const site = result.rows[0];
        if (site.scraped_data?.status !== 'active') return res.status(400).json({ error: "Analysis not complete" });

        const pdfBuffer = await generatePDFBuffer(site.scraped_data, site.url);
        const filename = `SEO_Report_${new URL(site.url).hostname}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "PDF generation failed" });
    } finally {
        client.release();
    }
});

app.post('/api/reports/:id/email', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query(
            "SELECT s.* FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Report not found" });
        
        const site = result.rows[0];
        if (site.scraped_data?.status !== 'active') return res.status(400).json({ error: "Analysis not complete" });

        // Trigger email asynchronously
        generateAndSendPDFReport(req.user.email, site.scraped_data, site.url);
        
        res.json({ success: true, message: `${req.user.email}로 리포트 발송을 시작했습니다.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Email request failed" });
    } finally {
        client.release();
    }
});

// --- Analysis Engine ---

async function processSiteAnalysis(siteId, userEmail = null) {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT * FROM sites WHERE id = $1", [siteId]);
        const site = res.rows[0];
        if (!site) return;

        const device = site.scraped_data?.device || 'desktop';
        console.log(`[Auto-Analysis] Starting analysis for: ${site.url} (Device: ${device})`);
        const { seoData, markdown, screenshotName } = await scrapeUrl(site.url, device);

        const prompt = `
            당신은 세계 최고의 쇼핑몰 CRO(전환율 최적화) 전문가이자 10년차 이상의 시니어 퍼포먼스 마케터입니다.
            제공된 데이터를 바탕으로 비즈니스 성장을 위한 냉철하고 실행 가능한 전략 리포트를 생성하세요.

            --- 작업 지침 ---
            1. **어조:** '대표님'과 같은 불필요한 호칭은 생략하고, 전문적이고 간결한 비즈니스 문체를 사용하세요.
            2. **형식:** 개조식(Bullet points)으로 작성하여 가독성을 극대화하세요.
            3. **리포트 구조 (ceo_message 필드에 아래 순서로 작성):**
               - [현 상태 분석]: 데이터 기반의 현재 상황 진단
               - [발견된 이슈]: 전환을 방해하는 핵심 문제점 (기술적/마케팅적)
               - [해결 방법]: 이슈를 해결하기 위한 구체적인 액션 아이템
               - [예상 효과]: 조치 후 기대되는 정량적/정성적 성과
            4. 응답은 반드시 지정된 JSON 구조를 유지하고 주석이나 마지막 쉼표를 남기지 마세요.

            --- 수집된 기술적 SEO 데이터 ---
            ${JSON.stringify(seoData)}

            --- 페이지 콘텐츠 요약 (Markdown) ---
            ${markdown}

            --- 응답 JSON 구조 (필수 포함) ---
            {
                "seo_score": (0~100 숫자),
                "summary": "비즈니스 모델 및 핵심 타겟 분석",
                "ceo_message": "[현 상태 분석] ...\\n[발견된 이슈] ...\\n[해결 방법] ...\\n[예상 효과] ...",
                "detected_products": ["상품1", "상품2"],
                "advice": {
                    "meta": "메타 정보 개선 제안",
                    "semantics": "HTML 구조 및 시멘틱 개선 제안",
                    "images": "이미지 최적화 제안",
                    "links": "내부/외부 링크 구조 제안",
                    "schemas": "구조화 데이터 적용 제안"
                },
                "ai_visibility": {
                    "score": (0~100 숫자),
                    "chatgpt_readiness": "Good/Warning/Bad",
                    "perplexity_readiness": "Good/Warning/Bad",
                    "gemini_readiness": "Good/Warning/Bad",
                    "improvement_tip": "AI 검색 노출을 위한 핵심 팁"
                },
                "automation_recommendations": {
                    "exit_intent": { "enabled": true, "text": "문구" },
                    "scroll_reward": { "enabled": true, "depth": 70, "coupon": "쿠폰명", "text": "문구" },
                    "social_proof": { "enabled": true, "template": "문구" },
                    "shipping_timer": { "enabled": true, "closing_hour": 15, "text": "문구" },
                    "rental_calc": { "enabled": true, "period": 24, "text": "문구" },
                    "inactivity_nudge": { "enabled": true, "idle_seconds": 30, "text": "문구" }
                },
                "sample_codes": {
                    "seo": "추천 HTML 코드",
                    "geo": "추천 JSON-LD 코드"
                }
            }
        `;

        // --- AI Analysis with Intelligent Retry (Handling 429 & 503) ---
        let result = null;
        let attempts = 0;
        const maxAttempts = 5; 

        while (attempts < maxAttempts) {
            try {
                result = await model.generateContent(prompt);
                if (result) break;
            } catch (err) {
                attempts++;
                const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));

                if (isRateLimit) {
                    const delaySeconds = 60; 
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

        const aiResult = robustJSONParse(textResponse);
        if (!aiResult) throw new Error("AI 응답에서 유효한 JSON을 추출할 수 없습니다.");

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

        const finalData = { 
            ...aiResult, 
            automation: aiResult.automation_recommendations,
            learning_progress: 25,
            event_count: 0,
            raw_seo: seoData, 
            screenshot: screenshotName, 
            status: 'active', 
            analyzed_at: new Date().toISOString(),
            history: limitedHistory
        };

        // Update site with results, applying AI automation recommendations
        await client.query(
            "UPDATE sites SET seo_score = $1, scraped_data = COALESCE(scraped_data, '{}'::jsonb) || $2::jsonb WHERE id = $3",
            [
                aiResult.seo_score || 0, 
                JSON.stringify(finalData), 
                siteId
            ]
        );
        console.log(`[Auto-Analysis] Completed for ${site.url}`);

        // If userEmail provided, send the PDF report
        if (userEmail) {
            generateAndSendPDFReport(userEmail, finalData, site.url).catch(e => console.error("Email task failed:", e));
        }
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

// Helper to calculate next run date with specific time
function calculateNextRun(schedule, timeStr) {
    if (!schedule || schedule === 'none') return null;
    
    const next = new Date();
    if (timeStr) {
        const [hours, minutes] = timeStr.split(':');
        next.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        
        // If the scheduled time for today has already passed, move to the next interval
        if (next <= new Date()) {
            if (schedule === 'daily') next.setDate(next.getDate() + 1);
            else if (schedule === 'weekly') next.setDate(next.getDate() + 7);
            else if (schedule === 'monthly') next.setMonth(next.getMonth() + 1);
        } else {
            // Even if it hasn't passed, if it's weekly/monthly we still usually want the *next* interval 
            // but for 'daily' we can run it today if the time is in the future.
            // Let's stick to simple logic: if future and daily -> today. Otherwise -> next interval.
            if (schedule === 'weekly') next.setDate(next.getDate() + 7);
            else if (schedule === 'monthly') next.setMonth(next.getMonth() + 1);
        }
    } else {
        // Fallback to legacy behavior if no time provided
        if (schedule === 'daily') next.setDate(next.getDate() + 1);
        else if (schedule === 'weekly') next.setDate(next.getDate() + 7);
        else if (schedule === 'monthly') next.setMonth(next.getMonth() + 1);
    }
    return next.toISOString();
}

// Background Worker: Every 1 minute, check for 'discovered', 'queued', or 'scheduled' sites
setInterval(async () => {
    const client = await pool.connect();
    try {
        const now = new Date().toISOString();
        
        // Priority 1: Specifically 'queued' sites (FIFO)
        let res = await client.query(
            "SELECT id FROM sites WHERE (scraped_data->>'status' = 'queued') ORDER BY created_at ASC LIMIT 2"
        );
        
        // Priority 2: If queue is empty, check for 'discovered' sites (initial scans)
        if (res.rows.length === 0) {
            res = await client.query(
                "SELECT id FROM sites WHERE (scraped_data->>'status' = 'discovered') LIMIT 2"
            );
        }

        // Priority 3: Check for scheduled runs whose time has come
        if (res.rows.length === 0) {
            res = await client.query(
                "SELECT id FROM sites WHERE (scraped_data->>'next_run_at' <= $1) LIMIT 1",
                [now]
            );
        }

        for (const row of res.rows) {
            console.log(`[Worker] Auto-triggering analysis for Site ID: ${row.id}`);
            await processSiteAnalysis(row.id);
            
            // Handle rescheduling if it was a scheduled run
            const siteRes = await client.query("SELECT scraped_data FROM sites WHERE id = $1", [row.id]);
            const sd = siteRes.rows[0].scraped_data;
            if (sd && sd.schedule && sd.schedule !== 'none') {
                const nextRunAt = calculateNextRun(sd.schedule, sd.schedule_time);
                await client.query(
                    "UPDATE sites SET scraped_data = scraped_data || jsonb_build_object('next_run_at', $1) WHERE id = $2",
                    [nextRunAt, row.id]
                );
            } else {
                // Clear next_run_at if no schedule
                await client.query(
                    "UPDATE sites SET scraped_data = scraped_data - 'next_run_at' WHERE id = $1",
                    [row.id]
                );
            }
        }
    } catch (e) {
        console.error("[Worker] Error in background task:", e);
    } finally {
        client.release();
    }
}, 60000);

// Schedule & Batch Routes
app.post('/api/sites/:id/schedule', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { schedule, time } = req.body; // 'none', 'daily', 'weekly', 'monthly' + 'HH:mm'
    
    if (!['none', 'daily', 'weekly', 'monthly'].includes(schedule)) {
        return res.status(400).json({ error: "Invalid schedule type" });
    }

    const client = await pool.connect();
    try {
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        const nextRunAt = calculateNextRun(schedule, time);

        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || jsonb_build_object('schedule', $1::text, 'schedule_time', $2::text, 'next_run_at', $3::text) WHERE id = $4",
            [schedule, time || '00:00', nextRunAt, id]
        );
        
        res.json({ success: true, schedule, schedule_time: time, next_run_at: nextRunAt });
    } catch (err) {
        res.status(500).json({ error: "Failed to update schedule" });
    } finally {
        client.release();
    }
});

app.post('/api/organizations/:id/schedule', isAuthenticated, async (req, res) => {
    let orgId = req.params.id;
    const { schedule, time } = req.body;
    
    if (!['none', 'daily', 'weekly', 'monthly'].includes(schedule)) {
        return res.status(400).json({ error: "Invalid schedule type" });
    }

    if (typeof orgId === 'string' && orgId.includes('-')) {
        orgId = decodeOrgId(orgId);
    }

    const client = await pool.connect();
    try {
        const orgCheck = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [orgId, req.user.id]);
        if (orgCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        const nextRunAt = calculateNextRun(schedule, time);

        // Update all active sites in this organization
        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || jsonb_build_object('schedule', $1::text, 'schedule_time', $2::text, 'next_run_at', $3::text) WHERE organization_id = $4 AND NOT (COALESCE(scraped_data, '{}'::jsonb) ? 'deleted_at')",
            [schedule, time || '00:00', nextRunAt, orgId]
        );

        res.json({ success: true, message: `모든 사이트의 분석 주기가 '${schedule}' (시간: ${time || '00:00'})으로 설정되었습니다.` });
    } catch (err) {
        res.status(500).json({ error: "Batch schedule failed" });
    } finally {
        client.release();
    }
});

app.post('/api/organizations/:id/batch-queue', isAuthenticated, async (req, res) => {
    let orgId = req.params.id;
    if (typeof orgId === 'string' && orgId.includes('-')) {
        orgId = decodeOrgId(orgId);
    }

    const client = await pool.connect();
    try {
        const orgCheck = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [orgId, req.user.id]);
        if (orgCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        // Queue all active sites that are not already queued
        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"status\": \"queued\"}'::jsonb WHERE organization_id = $1 AND NOT (COALESCE(scraped_data, '{}'::jsonb) ? 'deleted_at')",
            [orgId]
        );

        res.json({ success: true, message: "모든 사이트가 분석 대기 목록에 추가되었습니다." });
    } catch (err) {
        res.status(500).json({ error: "Batch analysis failed" });
    } finally {
        client.release();
    }
});

app.post('/api/sites/:id/queue', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const siteCheck = await client.query(
            "SELECT s.id FROM sites s JOIN organizations o ON s.organization_id = o.id WHERE s.id = $1 AND o.owner_id = $2",
            [id, req.user.id]
        );
        if (siteCheck.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        await client.query(
            "UPDATE sites SET scraped_data = COALESCE(scraped_data, '{}'::jsonb) || '{\"status\": \"queued\"}'::jsonb WHERE id = $1",
            [id]
        );
        res.json({ success: true, message: "분석 대기열에 추가되었습니다." });
    } catch (err) {
        res.status(500).json({ error: "Queue failed" });
    } finally {
        client.release();
    }
});

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
        const planInfo = getPlanDetails(req);

        if (used >= planInfo.limit) {
            return res.status(403).json({ error: `오늘의 분석 한도(${planInfo.limit}회)를 모두 사용하셨습니다. 내일 다시 시도하거나 플랜을 업그레이드해주세요.` });
        }
        // Run analysis and send email to current user
        await processSiteAnalysis(id, req.user.email);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Analysis failed" });
    } finally {
        client.release();
    }
});

app.post('/api/sites', isAuthenticated, async (req, res) => {
    let { organization_id, url, skip_analysis, device } = req.body;
    if (!organization_id || !url) return res.status(400).json({ error: "Org ID and URL are required" });

    const selectedDevice = ['desktop', 'mobile'].includes(device) ? device : 'desktop';

    // Try to decode if it looks like a public_id
    if (typeof organization_id === 'string' && organization_id.includes('-')) {
        const decoded = decodeOrgId(organization_id);
        if (!decoded) return res.status(403).json({ error: "Invalid Org ID" });
        organization_id = decoded;
    }

    // URL 정규화 (전체 URL을 보존하되, 중복 방지를 위해 trim 및 기본 정규화 수행)
    let normalizedUrl = url.trim();
    try {
        const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
        // origin + pathname + search (hash는 제외하는 것이 일반적)
        normalizedUrl = urlObj.origin + urlObj.pathname + urlObj.search;
        // 끝에 붙은 / 제거 (일관성)
        if (normalizedUrl.endsWith('/') && urlObj.pathname === '/') {
            normalizedUrl = normalizedUrl.slice(0, -1);
        }
    } catch (e) {
        console.error("[API] Invalid URL provided:", url);
    }

    const client = await pool.connect();
    try {
        // [Security] Verify ownership
        const orgRes = await client.query("SELECT id FROM organizations WHERE id = $1 AND owner_id = $2", [organization_id, req.user.id]);
        if (orgRes.rows.length === 0) return res.status(403).json({ error: "Unauthorized access to this organization." });

        // 기존에 등록된 사이트가 있는지 확인 (삭제되지 않은 것 중) - URL + Device 조합으로 고유성 판단할 수도 있으나 우선 URL 기준
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
            [organization_id, normalizedUrl, apiKey, 0, { status: 'registered', manual_added: true, device: selectedDevice }]
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