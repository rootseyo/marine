require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const updateSchema = async () => {
    const client = await pool.connect();
    try {
        console.log("Updating organizations table...");
        await client.query(`
            ALTER TABLE organizations 
            ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'free';
        `);
        console.log("Success: added 'plan' column to organizations");
    } catch (err) {
        console.error("Error updating schema:", err);
    } finally {
        client.release();
        await pool.end();
    }
};

updateSchema();
