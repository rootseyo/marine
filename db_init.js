require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const createTables = async () => {
    const client = await pool.connect();
    try {
        console.log("Creating tables...");

        // 1. Users Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                google_id VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("- Users table ready");

        // 2. Organizations Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS organizations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("- Organizations table ready");

        // 2.5 Organization Members Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS organization_members (
                id SERIAL PRIMARY KEY,
                organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(50) DEFAULT 'member',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(organization_id, user_id)
            );
        `);
        console.log("- Organization Members table ready");

        // 2.6 Invitations Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS invitations (
                id SERIAL PRIMARY KEY,
                organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                email VARCHAR(255) NOT NULL,
                token VARCHAR(255) UNIQUE NOT NULL,
                role VARCHAR(50) DEFAULT 'member',
                invited_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("- Invitations table ready");

        // 3. Sites Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS sites (
                id SERIAL PRIMARY KEY,
                organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                url VARCHAR(255) NOT NULL,
                api_key VARCHAR(64) UNIQUE NOT NULL,
                seo_score INTEGER DEFAULT 0,
                scraped_data JSONB,
                deleted_at TIMESTAMP DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("- Sites table ready");

        // Session table for connect-pg-simple
        await client.query(`
            CREATE TABLE IF NOT EXISTS session (
                sid varchar NOT NULL COLLATE "default",
                sess json NOT NULL,
                expire timestamp(6) NOT NULL
            )
            WITH (OIDS=FALSE);

            ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
            CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
        `);
        console.log("- Session table ready");

    } catch (err) {
        console.error("Error creating tables:", err);
    } finally {
        client.release();
        await pool.end();
        console.log("Database setup complete.");
    }
};

createTables();
