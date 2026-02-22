require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});
async function run() {
    const client = await pool.connect();
    try {
        await client.query("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb");
        console.log("Column 'metadata' added to 'organizations' table.");
    } catch (e) { console.error(e); }
    finally { client.release(); await pool.end(); }
}
run();
