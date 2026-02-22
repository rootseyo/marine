/**
 * Automation & AI Optimization Module
 */

async function runAiOptimization() {
    if (reportSites.length === 0) return alert("분석된 사이트가 없습니다. 먼저 분석 보고서를 생성해주세요.");
    const site = reportSites[0];
    if (!confirm(`[${site.url}] 사이트의 콘텐츠를 AI가 분석하여 8가지 마케팅 시나리오를 자동으로 구성합니다. 계속하시겠습니까?`)) return;

    const btn = event.target.closest('button');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> AI 분석 중...';

    try {
        const res = await fetch('/api/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organization_id: currentOrgId, url: site.url })
        });
        const data = await res.json();
        if (data.success) {
            alert("AI가 최적의 마케팅 시나리오를 구성했습니다! 설정을 확인한 후 '저장' 버튼을 눌러주세요.");
            reportSites[0] = data.site;
            await loadAutomationSettings();
        } else { alert("AI 분석 실패: " + (data.error || "알 수 없는 오류")); }
    } catch (err) { alert("서버 연결 실패"); }
    finally { btn.disabled = false; btn.innerHTML = originalHtml; }
}

async function loadAutomationSettings() {
    if (reportSites.length === 0) {
        if (currentOrgId) {
            const res = await fetch(`/api/sites?organization_id=${currentOrgId}`);
            const data = await res.json();
            reportSites = data.sites || [];
        }
    }
    if (reportSites.length === 0) return;
    
    const site = reportSites[0];
    const defaults = {
        social_proof: { enabled: true, template: "{location} {customer}님이 {product}를 방금 구매했습니다!", conversion: "click" },
        exit_intent: { enabled: true, text: "잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요...", conversion: "stay" },
        tab_recovery: { enabled: true, text: "🎁 놓치지 마세요!", conversion: "return" },
        price_match: { enabled: true, text: "🔎 최저가를 찾고 계신가요? 여기서 5% 할인받으세요: SAVE5", conversion: "copy_stop" },
        shipping_timer: { enabled: true, closing_hour: 16, text: "오늘 배송 마감까지 {timer} 남았습니다! 지금 주문하면 {delivery_date} 도착 예정.", conversion: "checkout" },
        scroll_reward: { enabled: true, depth: 80, text: "꼼꼼히 읽어주셔서 감사합니다! {product} 전용 시크릿 할인권을 드려요.", coupon: "SECRET10", conversion: "copy" },
        rental_calc: { enabled: true, period: 24, text: "이 제품, 하루 {daily_price}원이면 충분합니다. (월 {monthly_price}원 / {period}개월 기준)", conversion: "click" },
        inactivity_nudge: { enabled: true, idle_seconds: 30, text: "혹시 더 궁금한 점이 있으신가요? {customer}님만을 위한 가이드를 확인해보세요!", conversion: "wake" }
    };

    const config = { ...defaults, ...(site.scraped_data.automation || {}) };

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

    setChecked('toggleSocialProof', config.social_proof?.enabled ?? true);
    setVal('socialProofText', config.social_proof?.template || "");
    setVal('conversionSocialProof', config.social_proof?.conversion || "click");

    setChecked('toggleExitIntent', config.exit_intent?.enabled ?? true);
    setVal('exitIntentEditor', config.exit_intent?.text || "");
    setVal('conversionExitIntent', config.exit_intent?.conversion || "stay");

    setChecked('toggleTabRecovery', config.tab_recovery?.enabled ?? true);
    setVal('tabRecoveryText', config.tab_recovery?.text || "");
    setVal('conversionTabRecovery', config.tab_recovery?.conversion || "return");

    setChecked('togglePriceMatch', config.price_match?.enabled ?? true);
    setVal('priceMatchText', config.price_match?.text || "");
    setVal('conversionPriceMatch', config.price_match?.conversion || "copy_stop");

    setChecked('toggleShippingTimer', config.shipping_timer?.enabled ?? true);
    setVal('shippingClosingHour', config.shipping_timer?.closing_hour || 16);
    setVal('shippingTimerText', config.shipping_timer?.text || "");
    setVal('conversionShippingTimer', config.shipping_timer?.conversion || "checkout");

    setChecked('toggleScrollReward', config.scroll_reward?.enabled ?? true);
    setVal('scrollDepth', config.scroll_reward?.depth || 80);
    setVal('scrollCoupon', config.scroll_reward?.coupon || "SECRET10");
    setVal('scrollRewardText', config.scroll_reward?.text || "");
    setVal('conversionScrollReward', config.scroll_reward?.conversion || "copy");

    setChecked('toggleRentalCalc', config.rental_calc?.enabled ?? true);
    setVal('rentalPeriod', config.rental_calc?.period || 24);
    setVal('rentalCalcText', config.rental_calc?.text || "");
    setVal('conversionRentalCalc', config.rental_calc?.conversion || "click");

    setChecked('toggleInactivityNudge', config.inactivity_nudge?.enabled ?? true);
    setVal('inactivityIdleSeconds', config.inactivity_nudge?.idle_seconds || 30);
    setVal('inactivityNudgeText', config.inactivity_nudge?.text || "");
    setVal('conversionInactivityNudge', config.inactivity_nudge?.conversion || "wake");
    
    if (document.getElementById('socialProofText')) document.getElementById('socialProofText').dispatchEvent(new Event('input'));
}

async function saveAutomation() {
    if (reportSites.length === 0) return alert("분석된 사이트가 없습니다. 먼저 분석을 진행해주세요.");
    const site = reportSites[0]; 
    const getVal = (id) => document.getElementById(id)?.value;
    const getChecked = (id) => document.getElementById(id)?.checked;

    const config = {
        social_proof: { enabled: getChecked('toggleSocialProof'), template: getVal('socialProofText'), conversion: getVal('conversionSocialProof') },
        exit_intent: { enabled: getChecked('toggleExitIntent'), text: getVal('exitIntentEditor'), conversion: getVal('conversionExitIntent') },
        tab_recovery: { enabled: getChecked('toggleTabRecovery'), text: getVal('tabRecoveryText'), conversion: getVal('conversionTabRecovery') },
        price_match: { enabled: getChecked('togglePriceMatch'), text: getVal('priceMatchText'), conversion: getVal('conversionPriceMatch') },
        shipping_timer: { enabled: getChecked('toggleShippingTimer'), closing_hour: parseInt(getVal('shippingClosingHour')), text: getVal('shippingTimerText'), conversion: getVal('conversionShippingTimer') },
        scroll_reward: { enabled: getChecked('toggleScrollReward'), depth: parseInt(getVal('scrollDepth')), coupon: getVal('scrollCoupon'), text: getVal('scrollRewardText'), conversion: getVal('conversionScrollReward') },
        rental_calc: { enabled: getChecked('toggleRentalCalc'), period: parseInt(getVal('rentalPeriod')), text: getVal('rentalCalcText'), conversion: getVal('conversionRentalCalc') },
        inactivity_nudge: { enabled: getChecked('toggleInactivityNudge'), idle_seconds: parseInt(getVal('inactivityIdleSeconds')), text: getVal('inactivityNudgeText'), conversion: getVal('conversionInactivityNudge') }
    };

    try {
        const res = await fetch(`/api/sites/${site.id}/automation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config })
        });
        const data = await res.json();
        if (data.success) { alert("설정이 안전하게 저장되었습니다!"); site.scraped_data.automation = config; }
    } catch (err) { alert("저장 실패"); }
}
