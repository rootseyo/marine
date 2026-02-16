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
        await client.query(`
            CREATE TABLE IF NOT EXISTS site_discoveries (
                id SERIAL PRIMARY KEY,
                organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                url VARCHAR(255) NOT NULL,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(organization_id, url)
            );
        `);
        console.log("Table site_discoveries created successfully");
    } catch (e) { console.error(e); }
    finally { client.release(); await pool.end(); }
}
run();
