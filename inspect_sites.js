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
        const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sites'");
        console.log(res.rows);
    } catch (e) { console.error(e); }
    finally { client.release(); await pool.end(); }
}
run();
