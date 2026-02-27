require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function listAllSites() {
    try {
        const res = await pool.query("SELECT id, organization_id, url, scraped_data->'deleted_at' as deleted_at FROM sites");
        console.log("All Sites:");
        res.rows.forEach(r => console.log(`ID: ${r.id}, OrgID: ${r.organization_id}, URL: ${r.url}, DeletedAt: ${r.deleted_at}`));
    } catch (err) {
        console.error("Query failed:", err);
    } finally {
        await pool.end();
    }
}

listAllSites();
