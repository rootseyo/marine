require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function listSites() {
    const orgId = 1; // From key 1-eb72cea889
    try {
        const res = await pool.query("SELECT id, url FROM sites WHERE organization_id = $1", [orgId]);
        console.log("Domains for Org 1:");
        res.rows.forEach(r => console.log(`ID: ${r.id}, URL: ${r.url}`));
        if (res.rows.length === 0) console.log("No domains found for Org 1.");
    } catch (err) {
        console.error("Query failed:", err);
    } finally {
        await pool.end();
    }
}

listSites();
