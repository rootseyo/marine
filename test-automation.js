const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const API_BASE = 'http://localhost:8090'; // 서버 주소

async function runTest() {
    console.log("🚀 실시간 트래픽 자동화 테스트 시작...");

    try {
        const res = await pool.query("SELECT api_key, url FROM sites ORDER BY created_at DESC LIMIT 1");
        if (res.rows.length === 0) {
            console.error("❌ 등록된 사이트가 없습니다. 먼저 사이트를 등록해주세요.");
            process.exit(1);
        }
        const { api_key, url } = res.rows[0];
        console.log(`📡 대상 사이트: ${url} (API Key: ${api_key})`);

        const events = [
            { type: 'page_view', path: '/?utm_source=google&utm_medium=cpc&utm_campaign=winter_sale', meta: { title: '홈페이지', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'winter_sale' } } },
            { type: 'click_interaction', path: '/', meta: { tag: 'BUTTON', text: '구매하기', id: 'buy-btn' } },
            { type: 'scroll_depth', path: '/product/123?id=99&category=electronics&ref=search_result', meta: { depth: 25 } },
            { type: 'scroll_depth', path: '/product/123', meta: { depth: 50 } },
            { type: 'click_interaction', path: '/product/123', meta: { tag: 'A', text: '상세정보 더보기' } }
        ];

        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            process.stdout.write(`[${i + 1}/${events.length}] 전송 중: ${event.type} ... `);
            
            const response = await fetch(`${API_BASE}/api/v1/learning/signal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: api_key,
                    event_type: event.type,
                    path: event.path,
                    referrer: 'https://google.com',
                    metadata: event.meta
                })
            });

            if (response.ok) {
                console.log(`✅ 성공 (Status: ${response.status})`);
            } else {
                console.error(`❌ 실패 (Status: ${response.status})`);
            }
            await new Promise(r => setTimeout(r, 1500));
        }

        console.log("\n✨ 테스트 완료! 이제 Marine 대시보드 '자동화 설정' 섹션을 확인해보세요.");
        console.log("- '최근 유입 행동 로그' 테이블에 이벤트가 나타나야 합니다.");
        console.log("- '학습 완료도' 게이지와 '수집된 이벤트' 카운터가 업데이트되었는지 확인하세요.");
        
    } catch (err) {
        console.error("❌ 오류 발생:", err.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

runTest();
