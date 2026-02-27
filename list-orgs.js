require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function listOrgs() {
    try {
        const res = await pool.query("SELECT id, name FROM organizations");
        console.log("Organizations:");
        res.rows.forEach(r => console.log(`ID: ${r.id}, Name: ${r.name}`));
    } catch (err) {
        console.error("Query failed:", err);
    } finally {
        await pool.end();
    }
}

listOrgs();
