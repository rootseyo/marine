require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

// --- Infrastructure & Services ---
const db = require('./src/config/db');
const { isAuthenticated } = require('./src/middlewares/auth');
const workerService = require('./src/services/worker.service');
const { getPlanDetails, decodeOrgId } = require('./src/utils/helpers');

// --- Routes ---
const siteRoutes = require('./src/routes/api/sites');
const orgRoutes = require('./src/routes/api/organizations');
const automationRoutes = require('./src/routes/api/automation');

const app = express();
const PORT = process.env.PORT || 8080;

// --- Logger Setup ---
const originalLog = console.log;
const getTimestamp = () => {
    const now = new Date();
    return `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
};
console.log = (...args) => originalLog(getTimestamp(), ...args);

// --- App Config ---
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ type: ['application/json', 'text/plain'] }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Session & Auth ---
app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'marine-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'lax' 
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
    const client = await db.connect();
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
        return done(null, user);
    } catch (err) {
        return done(err, null);
    } finally {
        client.release();
    }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    const client = await db.connect();
    try {
        const res = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        done(null, res.rows[0]);
    } catch (err) {
        done(err, null);
    } finally {
        client.release();
    }
});

// --- API Routes ---
app.use('/api/sites', siteRoutes);
app.use('/api', orgRoutes); // This will handle /api/organizations AND /api/usage
app.use('/api', automationRoutes); // This will handle /api/dashboard/stats

app.get('/api/ping', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));
app.get('/api/auth/oauth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/dashboard'));
app.get('/api/auth/me', isAuthenticated, (req, res) => {
    const planInfo = getPlanDetails(req);
    res.json({ user: req.user, plan: planInfo.plan, isBeta: planInfo.isBeta });
});
app.get('/api/auth/logout', (req, res) => req.logout(() => res.redirect('/')));

// --- Page Routes ---
app.get(['/dashboard', '/organizations', '/reports', '/reports/:id', '/automation', '/subscription'], isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// --- Worker & Start ---
workerService.start();

app.listen(PORT, () => console.log(`[Server] Marine AI running on port ${PORT}`));
