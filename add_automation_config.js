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
            ALTER TABLE sites 
            ADD COLUMN IF NOT EXISTS automation_config JSONB DEFAULT '{
                "social_proof": {"enabled": true, "template": "{location} {customer}님이 {product}를 방금 구매했습니다!"},
                "exit_intent": {"enabled": true, "text": "잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요..." }
            }'::jsonb;
        `);
        console.log("Column automation_config added successfully.");
    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}
run();
