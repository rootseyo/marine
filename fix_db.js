require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const migration = async () => {
    const client = await pool.connect();
    try {
        console.log("Starting DB migration/fix...");

        // 1. Ensure tables exist
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
        console.log("- Organization Members table ensured");

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
        console.log("- Invitations table ensured");

        // 2. Migration: Populate organization_members from organizations (owner_id)
        // This fixes the issue where existing organizations don't have members,
        // which causes them to not show up in the new JOIN query.
        const insertCount = await client.query(`
            INSERT INTO organization_members (organization_id, user_id, role)
            SELECT id, owner_id, 'owner'
            FROM organizations
            ON CONFLICT (organization_id, user_id) DO NOTHING
            RETURNING id;
        `);
        console.log(`- Migrated ${insertCount.rowCount} owners to members table`);

    } catch (err) {
        console.error("Migration error:", err);
    } finally {
        client.release();
        await pool.end();
        console.log("Migration complete.");
    }
};

migration();
