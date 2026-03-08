const db = require('../config/db');
const SiteService = require('./site.service');

/**
 * Background Worker for scheduled tasks
 */
class WorkerService {
    static start() {
        console.log("[Worker] Background worker started (Interval: 1m)");
        setInterval(() => this.runLoop(), 60000);
    }

    static async runLoop() {
        const client = await db.connect();
        try {
            const now = new Date().toISOString();
            
            // Priority 1: Specifically 'queued' sites
            let res = await client.query(
                "SELECT id FROM sites WHERE scraped_data->>'status' = 'queued' ORDER BY created_at ASC LIMIT 3"
            );

            // Priority 2: Scheduled sites
            if (res.rows.length === 0) {
                res = await client.query(
                    "SELECT id FROM sites WHERE scraped_data->>'next_run_at' <= $1 AND NOT (scraped_data ? 'deleted_at') LIMIT 3",
                    [now]
                );
            }

            for (const row of res.rows) {
                console.log(`[Worker] Processing site ${row.id}...`);
                // Mark as processing to avoid double-pick
                await client.query("UPDATE sites SET scraped_data = scraped_data || '{\"status\": \"processing\"}'::jsonb WHERE id = $1", [row.id]);
                
                // Trigger analysis (Fire and forget or await depending on concurrency needs)
                SiteService.processSiteAnalysis(row.id).catch(err => {
                    console.error(`[Worker] Error processing site ${row.id}:`, err);
                });
            }
        } catch (err) {
            console.error("[Worker] Loop error:", err);
        } finally {
            client.release();
        }
    }
}

module.exports = WorkerService;
