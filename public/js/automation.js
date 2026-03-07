/**
 * Automation & AI Optimization Module - List/Detail Refactor
 */

let automationRefreshInterval = null;
let currentWidgetId = null;

const WIDGETS = [
    { id: 'social_proof', name: '실시간 구매 알림', icon: 'fa-users', desc: '다른 고객의 구매 소식을 실시간으로 알려 신뢰도를 높입니다.', color: 'primary' },
    { id: 'exit_intent', name: '이탈 방지 AI 팝업', icon: 'fa-door-open', desc: '고객이 나가려는 순간(Mouse Leave)을 포착해 붙잡습니다.', color: 'danger' },
    { id: 'tab_recovery', name: '탭 복구 (Tab Recovery)', icon: 'fa-exchange-alt', desc: '고객이 다른 탭으로 이동하면 제목을 깜빡여 다시 부릅니다.', color: 'warning' },
    { id: 'price_match', name: '가격 비교 방어', icon: 'fa-tags', desc: '상품명을 복사(Ctrl+C)하면 즉시 할인 혜택을 제안합니다.', color: 'success' },
    { id: 'shipping_timer', name: '마감 임박 배송 타이머', icon: 'fa-shipping-fast', desc: '오늘 배송 마감 시간을 보여주어 구매 긴박감을 조성합니다.', color: 'info' },
    { id: 'scroll_reward', name: '스크롤 깊이 보상', icon: 'fa-scroll', desc: '상세페이지를 끝까지 읽는 고관여 유저에게 혜택을 줍니다.', color: 'warning' },
    { id: 'rental_calc', name: '렌탈/구독 전환 계산기', icon: 'fa-calculator', desc: '고가 상품을 월 납입금으로 환산해 가격 장벽을 낮춥니다.', color: 'primary' },
    { id: 'inactivity_nudge', name: '장기 체류 무반응 리마인더', icon: 'fa-bed', desc: '움직임이 없는 고객을 깨워 다시 관심을 유도합니다.', color: 'secondary' }
];

async function loadAutomationSettings() {
    if (automationRefreshInterval) clearInterval(automationRefreshInterval);
    
    // Reset view to list
    showAutomationList();
    
    const refreshData = async () => {
        if (!currentOrgId) return;
        try {
            const res = await fetch(`/api/sites?organization_id=${currentOrgId}`);
            const data = await res.json();
            if (data.sites && data.sites.length > 0) {
                reportSites = data.sites;
                updateAutomationUI(data.sites[0]);
            }
        } catch (err) { console.error("데이터 갱신 실패", err); }
    };

    await refreshData();
    automationRefreshInterval = setInterval(refreshData, 5000);
}

function updateAutomationUI(site) {
    if (!site || !site.scraped_data) return;
    
    const config = site.scraped_data.automation || {};
    const progress = parseInt(site.scraped_data.learning_progress || 0);
    const tps = parseFloat(site.scraped_data.stats_tps || 0);

    // 1. AI Opinion Update
    const aiOpinionContainer = document.getElementById('aiOpinionContainer');
    const aiOpinionText = document.getElementById('aiOpinionText');
    if (aiOpinionContainer && aiOpinionText) {
        const opinion = site.scraped_data.ai_opinion;
        if (opinion) {
            aiOpinionText.innerHTML = opinion.replace(/\n/g, '<br>');
            aiOpinionContainer.style.display = 'block';
        } else if (progress >= 100) {
            aiOpinionText.innerHTML = "<i class='fas fa-sync fa-spin me-2'></i> <strong>최소 트래픽 확보 완료. AI 분석 중...</strong>";
            aiOpinionContainer.style.display = 'block';
        } else {
            aiOpinionText.innerHTML = "<i class='fas fa-hourglass-half me-2'></i> <strong>최소 트래픽 수집 중...</strong> (현재 초당 트래픽: " + tps.toFixed(2) + ")";
            aiOpinionContainer.style.display = 'block';
        }
    }

    // 2. Behavior Logs Table Update
    const logs = site.scraped_data.behavior_logs || [];
    const logBody = document.getElementById('realtimeBehaviorLogs');
    if (logBody) {
        if (logs.length > 0) {
            logBody.innerHTML = logs.map(log => {
                const time = new Date(log.ts).toLocaleTimeString('ko-KR', { hour12: false });
                let details = '';
                if (log.type === 'scroll_depth') details = `깊이: ${log.meta.depth}%`;
                else if (log.type === 'click_interaction') details = `[${log.meta.tag}] ${log.meta.text || '내용없음'}`;
                else if (log.type === 'perf_metrics') details = `LCP: ${Math.round(log.meta.load_time)}ms`;
                
                if (log.meta.utm) {
                    const utmStr = Object.entries(log.meta.utm).map(([k, v]) => `${k.replace('utm_', '')}:${v}`).join(', ');
                    details += ` <br><span class="text-primary" style="font-size: 10px;">🚩 ${utmStr}</span>`;
                }
                
                let badgeClass = 'bg-secondary';
                if (log.type === 'scroll_depth') badgeClass = 'bg-info';
                if (log.type === 'click_interaction') badgeClass = 'bg-success';
                if (log.type === 'form_submit') badgeClass = 'bg-danger';
                
                return `<tr>
                    <td class="ps-3 py-3 text-muted small" style="white-space: nowrap;">${time}</td>
                    <td class="py-3"><span class="badge ${badgeClass} small bg-opacity-10 text-${badgeClass.replace('bg-', '')} border border-${badgeClass.replace('bg-', '')} border-opacity-25">${log.type.replace('_', ' ').toUpperCase()}</span></td>
                    <td class="py-3 text-truncate" style="max-width: 150px;" title="${log.path}">${log.path}</td>
                    <td class="pe-3 py-3 small text-muted">${details}</td>
                </tr>`;
            }).join('');
        } else {
            logBody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">데이터 수집을 기다리는 중...</td></tr>';
        }
    }

    // 3. AI Auto-Pilot Toggle Update
    const aiToggle = document.getElementById('toggleAiAutoOptimize');
    if (aiToggle) {
        aiToggle.checked = config.ai_auto_optimize ?? false;
        
        // Add listener for auto-save
        if (!aiToggle.getAttribute('data-listener')) {
            aiToggle.addEventListener('change', (e) => {
                saveAutomation(true);
            });
            aiToggle.setAttribute('data-listener', 'true');
        }

        if (progress < 100) {
            aiToggle.disabled = true;
            aiToggle.parentElement.parentElement.style.opacity = '0.5';
        } else {
            aiToggle.disabled = false;
            aiToggle.parentElement.parentElement.style.opacity = '1';
        }
    }

    // 4. Widget List Rendering
    const listContainer = document.getElementById('widgetListContainer');
    if (listContainer) {
        listContainer.innerHTML = WIDGETS.map(w => {
            const isEnabled = config[w.id]?.enabled ?? false;
            return `
                <div class="list-group-item list-group-item-action d-flex align-items-center p-3" style="cursor: pointer;" onclick="showAutomationDetail('${w.id}')">
                    <div class="bg-${w.color} text-white rounded-circle p-2 me-3 shadow-sm" style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
                        <i class="fas ${w.icon}"></i>
                    </div>
                    <div class="flex-grow-1">
                        <h6 class="fw-bold mb-0 text-dark">${w.name}</h6>
                        <small class="text-muted">${w.desc}</small>
                    </div>
                    <div class="d-flex align-items-center ms-3" onclick="event.stopPropagation()">
                        <span class="badge ${isEnabled ? 'bg-success' : 'bg-light text-muted'} me-3">${isEnabled ? '활성' : '비활성'}</span>
                        <label class="switch switch-sm">
                            <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleWidgetQuick('${w.id}', this.checked)">
                            <span class="slider"></span>
                        </label>
                        <i class="fas fa-chevron-right text-muted ms-3"></i>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 5. If Detail View is open, update its values
    if (currentWidgetId) renderWidgetDetail(currentWidgetId, config);
}

function showAutomationList() {
    currentWidgetId = null;
    document.getElementById('automationListView').style.display = 'block';
    document.getElementById('automationDetailView').style.display = 'none';
}

function showAutomationDetail(widgetId) {
    currentWidgetId = widgetId;
    document.getElementById('automationListView').style.display = 'none';
    document.getElementById('automationDetailView').style.display = 'block';
    
    const site = reportSites[0];
    const config = site.scraped_data.automation || {};
    renderWidgetDetail(widgetId, config);
}

function renderWidgetDetail(widgetId, config) {
    const w = WIDGETS.find(x => x.id === widgetId);
    if (!w) return;

    document.getElementById('detailWidgetTitle').innerText = w.name;
    document.getElementById('detailWidgetDesc').innerText = w.desc;
    document.getElementById('detailWidgetIcon').className = `bg-${w.color} text-white rounded-circle p-2 me-3 shadow-sm`;
    document.getElementById('detailWidgetIcon').innerHTML = `<i class="fas ${w.icon} fa-lg"></i>`;
    
    const widgetConfig = config[widgetId] || { enabled: false };
    document.getElementById('detailWidgetToggle').checked = widgetConfig.enabled;

    const settingsCont = document.getElementById('widgetSettingsContainer');
    const convCont = document.getElementById('widgetConversionContainer');
    const previewCont = document.getElementById('widgetPreviewBox');

    // Settings & Previews based on type
    let settingsHtml = '';
    let previewHtml = '';
    let convHtml = `
        <label class="form-label small fw-bold text-primary"><i class="fas fa-bullseye me-1"></i> 성과 측정 기준</label>
        <select class="form-select" id="detailConversion">
            ${getConversionOptions(widgetId, widgetConfig.conversion)}
        </select>
        <div class="form-text small mt-2">AI가 이 기준을 바탕으로 문구의 효율을 판단합니다.</div>
    `;

    if (widgetId === 'social_proof') {
        settingsHtml = `
            <div class="mb-3">
                <label class="form-label small fw-bold">알림 문구 템플릿</label>
                <input type="text" class="form-control" id="detailText" value="${widgetConfig.template || '{location} {customer}님이 {product}를 방금 구매했습니다!'}">
                <div class="form-text">사용 가능 태그: {location}, {customer}, {product}</div>
            </div>
        `;
        previewHtml = `<div class="social-proof-toast" style="position: static; box-shadow: none; border: 1px solid #eee;">
            <div style="width: 10px; height: 10px; background: #2ecc71; border-radius: 50%; margin-right: 12px;"></div>
            <span><strong>서울시</strong> <strong>김*연</strong>님이 <strong>인기 상품</strong>을 방금 구매했습니다!</span>
        </div>`;
    } else if (widgetId === 'exit_intent') {
        settingsHtml = `
            <div class="mb-3">
                <label class="form-label small fw-bold">이탈 방지 문구</label>
                <textarea class="form-control" id="detailText" rows="3">${widgetConfig.text || '잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요.'}</textarea>
            </div>
        `;
        previewHtml = `<div class="p-3 border rounded bg-white text-center shadow-sm" style="max-width: 250px;">
            <h6 class="fw-bold">🎁 선물 도착!</h6>
            <p class="small mb-2">지금 나가시면 쿠폰이 사라져요.</p>
            <button class="btn btn-sm btn-danger w-100">혜택 받기</button>
        </div>`;
    } else if (widgetId === 'tab_recovery') {
        settingsHtml = `
            <div class="mb-3">
                <label class="form-label small fw-bold">깜빡임 문구</label>
                <input type="text" class="form-control" id="detailText" value="${widgetConfig.text || '🎁 놓치지 마세요!'}">
            </div>
        `;
        previewHtml = `<div class="bg-dark text-white p-2 rounded small"><i class="fas fa-window-maximize me-2"></i> (1) 🎁 놓치지 마세요! | 브라이트...</div>`;
    } else if (widgetId === 'price_match') {
        settingsHtml = `
            <div class="mb-3">
                <label class="form-label small fw-bold">제안 문구</label>
                <input type="text" class="form-control" id="detailText" value="${widgetConfig.text || '🔎 최저가를 찾고 계신가요? 여기서 5% 할인받으세요: SAVE5'}">
            </div>
        `;
        previewHtml = `<div class="alert alert-success small mb-0"><i class="fas fa-tag me-2"></i> <strong>최저가 보장!</strong> SAVE5 쿠폰 사용 가능</div>`;
    } else if (widgetId === 'shipping_timer') {
        settingsHtml = `
            <div class="row g-3 mb-3">
                <div class="col-6">
                    <label class="form-label small fw-bold">마감 시간 (24시)</label>
                    <input type="number" class="form-control" id="detailHour" value="${widgetConfig.closing_hour || 16}">
                </div>
            </div>
            <div class="mb-3">
                <label class="form-label small fw-bold">알림 문구</label>
                <textarea class="form-control" id="detailText" rows="2">${widgetConfig.text || '오늘 배송 마감까지 {timer} 남았습니다!'}</textarea>
            </div>
        `;
        previewHtml = `<div class="bg-info text-white p-2 rounded small w-100 text-center fw-bold">마감까지 <span class="text-warning">02:45:12</span> 남음!</div>`;
    } else if (widgetId === 'scroll_reward') {
        settingsHtml = `
            <div class="row g-3 mb-3">
                <div class="col-6">
                    <label class="form-label small fw-bold">트리거 깊이 (%)</label>
                    <input type="number" class="form-control" id="detailDepth" value="${widgetConfig.depth || 80}">
                </div>
                <div class="col-6">
                    <label class="form-label small fw-bold">쿠폰 코드</label>
                    <input type="text" class="form-control" id="detailCoupon" value="${widgetConfig.coupon || 'SECRET10'}">
                </div>
            </div>
            <div class="mb-3">
                <label class="form-label small fw-bold">제안 문구</label>
                <textarea class="form-control" id="detailText" rows="2">${widgetConfig.text || '꼼꼼히 읽어주셔서 감사합니다! 특별 할인권을 드려요.'}</textarea>
            </div>
        `;
        previewHtml = `<div class="p-3 border border-warning rounded bg-white text-center">🎉 <strong>SECRET10</strong> 복사 완료!</div>`;
    } else if (widgetId === 'rental_calc') {
        settingsHtml = `
            <div class="mb-3">
                <label class="form-label small fw-bold">렌탈 기간 (개월)</label>
                <select class="form-select" id="detailPeriod">
                    <option value="12" ${widgetConfig.period == 12 ? 'selected' : ''}>12개월</option>
                    <option value="24" ${widgetConfig.period == 24 ? 'selected' : ''}>24개월</option>
                    <option value="36" ${widgetConfig.period == 36 ? 'selected' : ''}>36개월</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label small fw-bold">제안 문구</label>
                <textarea class="form-control" id="detailText" rows="2">${widgetConfig.text || '하루 {daily_price}원이면 충분합니다.'}</textarea>
            </div>
        `;
        previewHtml = `<button class="btn btn-sm btn-outline-primary">💡 렌탈료 계산기</button>`;
    } else if (widgetId === 'inactivity_nudge') {
        settingsHtml = `
            <div class="mb-3">
                <label class="form-label small fw-bold">무반응 기준 (초)</label>
                <input type="number" class="form-control" id="detailIdle" value="${widgetConfig.idle_seconds || 30}">
            </div>
            <div class="mb-3">
                <label class="form-label small fw-bold">알림 문구</label>
                <textarea class="form-control" id="detailText" rows="2">${widgetConfig.text || '혹시 더 궁금한 점이 있으신가요?'}</textarea>
            </div>
        `;
        previewHtml = `<div class="bg-secondary text-white p-2 rounded-pill small px-3">💬 도움이 필요하신가요?</div>`;
    }

    settingsCont.innerHTML = settingsHtml;
    convCont.innerHTML = convHtml;
    previewCont.innerHTML = previewHtml;
}

function getConversionOptions(id, current) {
    const opts = {
        social_proof: [['click', '위젯 클릭 시'], ['view', '3초 이상 노출'], ['purchase', '알림 후 구매']],
        exit_intent: [['stay', '페이지 체류'], ['click', '혜택 받기 클릭'], ['purchase', '이탈 시도 후 구매']],
        tab_recovery: [['return', '탭 다시 활성화'], ['stay', '복귀 후 1분 체류']],
        price_match: [['copy_stop', '복사 후 이탈 방지'], ['coupon_use', '쿠폰 사용']],
        shipping_timer: [['checkout', '결제 페이지 진입'], ['click', '정보 확인 클릭']],
        scroll_reward: [['copy', '쿠폰 복사'], ['view', '보상 팝업 노출']],
        rental_calc: [['click', '계산기 클릭'], ['consult', '상담 신청']],
        inactivity_nudge: [['wake', '활동 재개'], ['click', '상품 클릭']]
    };
    return (opts[id] || []).map(o => `<option value="${o[0]}" ${current === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('');
}

async function toggleWidgetQuick(widgetId, isEnabled) {
    const site = reportSites[0];
    const config = site.scraped_data.automation || {};
    if (!config[widgetId]) config[widgetId] = {};
    config[widgetId].enabled = isEnabled;
    
    await performSave(config, true);
}

async function performSave(config, silent = false) {
    const site = reportSites[0];
    if (silent) showAutoSaveToast('저장 중...', 'saving');

    try {
        const res = await fetch(`/api/sites/${site.id}/automation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config })
        });
        if (res.ok) {
            site.scraped_data.automation = config;
            if (silent) showAutoSaveToast('저장 되었습니다.', 'success');
            else alert("설정이 저장되었습니다.");
        }
    } catch (err) {
        if (silent) showAutoSaveToast('저장 실패', 'error');
        else alert("저장 실패");
    }
}

async function saveAutomation(silent = false, fromDetail = false) {
    const site = reportSites[0];
    if (!site) return;
    const config = JSON.parse(JSON.stringify(site.scraped_data.automation || {}));

    if (fromDetail && currentWidgetId) {
        const w = config[currentWidgetId] || {};
        w.enabled = document.getElementById('detailWidgetToggle').checked;
        w.conversion = document.getElementById('detailConversion')?.value;
        
        const textVal = document.getElementById('detailText')?.value;
        if (currentWidgetId === 'social_proof') w.template = textVal;
        else w.text = textVal;

        if (currentWidgetId === 'shipping_timer') w.closing_hour = parseInt(document.getElementById('detailHour')?.value || 16);
        if (currentWidgetId === 'scroll_reward') {
            w.depth = parseInt(document.getElementById('detailDepth')?.value || 80);
            w.coupon = document.getElementById('detailCoupon')?.value;
        }
        if (currentWidgetId === 'rental_calc') w.period = parseInt(document.getElementById('detailPeriod')?.value || 24);
        if (currentWidgetId === 'inactivity_nudge') w.idle_seconds = parseInt(document.getElementById('detailIdle')?.value || 30);
        
        config[currentWidgetId] = w;
    }

    config.ai_auto_optimize = document.getElementById('toggleAiAutoOptimize')?.checked;
    await performSave(config, silent);
}

function showAutoSaveToast(message, type = 'info') {
    const toast = document.getElementById('autoSaveToast');
    const toastMsg = document.getElementById('toastMessage');
    if (!toast || !toastMsg) return;
    toastMsg.innerHTML = message;
    toast.classList.remove('d-none');
    toast.style.opacity = '1';
    if (type !== 'saving') setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.classList.add('d-none'), 300); }, 2000);
}
