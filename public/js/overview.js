/**
 * Integrated Dashboard Overview Module
 */

let revenueChartInstance = null;

async function loadDashboardStats() {
    const orgParam = currentPublicId || currentOrgId;
    if (!orgParam) return;

    try {
        const res = await fetch(`/api/dashboard/stats?organization_id=${orgParam}`);
        const data = await res.json();

        // 1. Update Top Metrics
        if (document.getElementById('statRecovered')) document.getElementById('statRecovered').textContent = data.recovered.toLocaleString();
        if (document.getElementById('statVisitors')) document.getElementById('statVisitors').textContent = data.visitors.toLocaleString();
        
        if (document.getElementById('insightWidgetCvr')) document.getElementById('insightWidgetCvr').textContent = data.attribution.widget.cvr + '%';
        if (document.getElementById('insightNonWidgetCvr')) document.getElementById('insightNonWidgetCvr').textContent = `일반 유저: ${data.attribution.nonWidget.cvr}%`;
        
        const campaignViews = data.utm.reduce((acc, curr) => acc + curr.views, 0);
        const totalViews = data.attribution.widget.views + data.attribution.nonWidget.views;
        if (document.getElementById('insightCampaignRate')) {
            const rate = totalViews > 0 ? Math.round((campaignViews / totalViews) * 100) : 0;
            document.getElementById('insightCampaignRate').textContent = `캠페인 유입: ${rate}%`;
        }

        if (document.getElementById('statSeo')) {
            const seoScore = data.seo || 0;
            document.getElementById('statSeo').textContent = seoScore;
            const seoBar = document.getElementById('seoProgressBar');
            if (seoBar) {
                seoBar.style.width = seoScore + '%';
                seoBar.className = `progress-bar ${seoScore > 80 ? 'bg-success' : (seoScore > 50 ? 'bg-warning' : 'bg-danger')}`;
            }
        }

        // 2. Update Revenue Chart
        initRevenueChart(data.revenueData);

        // 3. Update Funnel Drop-off (Meaningful Leaks Only)
        const funnelBody = document.getElementById('funnelInsightsBody');
        if (funnelBody) {
            if (!data.funnel || data.funnel.length === 0) {
                funnelBody.innerHTML = `
                    <div class="text-center py-4">
                        <i class="fas fa-circle-check text-success fa-3x mb-3"></i>
                        <p class="small fw-bold">수정할 이탈 경로가 없습니다!</p>
                        <p class="text-muted small">현재 모든 주요 페이지의 유입이 원활합니다.</p>
                    </div>
                `;
            } else {
                funnelBody.innerHTML = data.funnel.map((f, i) => {
                    const formattedRate = f.rate.toFixed(2);
                    const isHighLeak = f.rate > 40;
                    
                    const rateColor = isHighLeak ? 'text-danger' : 'text-warning';
                    const barColor = isHighLeak ? 'bg-danger' : 'bg-warning';
                    
                    return `
                    <div class="mb-3">
                        <div class="d-flex justify-content-between mb-1">
                            <span class="small text-truncate" style="max-width: 150px;" title="${f.path}">
                                <strong>${i+1}.</strong> ${f.path}
                            </span>
                            <span class="small fw-bold ${rateColor}">${formattedRate}% (${f.exits}명 이탈)</span>
                        </div>
                        <div class="progress" style="height: 6px; background-color: #f1f5f9; border-radius: 10px;">
                            <div class="progress-bar ${barColor}" style="width: ${Math.max(f.rate, 5)}%; border-radius: 10px;"></div>
                        </div>
                    </div>
                    `;
                }).join('');
            }
        }

        // 4. Update UTM Performance Table
        const utmBody = document.getElementById('utmPerformanceBody');
        if (utmBody) {
            utmBody.innerHTML = data.utm.map(u => {
                const contribution = data.attribution.widget.conv > 0 ? Math.round((u.reactions / data.attribution.widget.conv) * 100) : 0;
                return `
                    <tr>
                        <td class="ps-4"><span class="badge bg-light text-dark border">${u.source}</span></td>
                        <td>${u.views.toLocaleString()}</td>
                        <td>${u.reactions.toLocaleString()}</td>
                        <td class="fw-bold text-primary">${u.cvr}%</td>
                        <td class="pe-4">
                            <div class="d-flex align-items-center justify-content-center">
                                <div class="progress flex-grow-1 me-2" style="height: 6px; min-width: 50px;">
                                    <div class="progress-bar bg-primary" style="width: ${contribution}%"></div>
                                </div>
                                <span class="small text-muted">${contribution}%</span>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // 5. Update Logs (Behavior & AI)
        const eventLog = document.getElementById('eventLog');
        if (eventLog && data.eventLog) {
            if (data.eventLog.length === 0) {
                eventLog.innerHTML = '<div class="text-center text-muted small py-4">최근 행동이 없습니다.</div>';
            } else {
                eventLog.innerHTML = data.eventLog.map(log => {
                    const time = new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    let desc = '';
                    switch (log.type) {
                        case 'exit_intent': desc = '이탈 의도 감지 (팝업)'; break;
                        case 'cart_abandoned': desc = '장바구니 이탈 감지'; break;
                        case 'scroll_reward_claim': desc = '스크롤 보상 쿠폰 복사'; break;
                        case 'rental_calc_click': desc = '렌탈 계산기 클릭'; break;
                        case 'coupon_copied': desc = '쿠폰 코드 복사'; break;
                        default: desc = log.type;
                    }
                    return `
                        <div class="timeline-item">
                            <div class="fw-bold small text-muted">${time}</div>
                            <div class="small">${desc} <span class="text-muted">(${new URL(log.site_url).hostname})</span></div>
                        </div>
                    `;
                }).join('');
            }
        }

        const aiLogsBody = document.getElementById('aiOptimizationLogsBody');
        if (aiLogsBody) {
            if (!data.aiLogs || data.aiLogs.length === 0) {
                aiLogsBody.innerHTML = '<div class="p-4 text-center text-muted small">AI 최적화 로그가 없습니다.</div>';
            } else {
                aiLogsBody.innerHTML = data.aiLogs.map(l => {
                    const time = new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return `
                        <div class="list-group-item p-3 border-0 border-bottom bg-transparent">
                            <div class="d-flex justify-content-between align-items-start mb-1">
                                <div class="fw-bold small" style="font-size: 0.8rem;"><i class="fas fa-magic text-warning me-2"></i> ${l.action}</div>
                                <small class="text-muted" style="font-size: 10px;">${time}</small>
                            </div>
                            <p class="small text-muted mb-1" style="font-size: 0.75rem;">${l.reason}</p>
                            <span class="badge bg-success-soft text-success extra-small">${l.impact}</span>
                        </div>
                    `;
                }).join('');
            }
        }

    } catch (err) {
        console.error("Failed to load dashboard stats:", err);
    }
}

async function loadSiteHistory() {
    const orgParam = currentPublicId || currentOrgId;
    if (!orgParam) return;
    try {
        const res = await fetch(`/api/sites?organization_id=${orgParam}`);
        const data = await res.json();
        const list = document.getElementById('siteHistoryList');
        if (!list) return;
        if (!data.sites || data.sites.length === 0) {
            list.innerHTML = '<tr><td colspan="5" class="text-center py-4">데이터가 없습니다.</td></tr>';
            return;
        }
        list.innerHTML = data.sites.map(site => `
            <tr>
                <td><strong>${site.url}</strong></td>
                <td><span class="badge ${site.status === 'error' ? 'bg-danger' : 'bg-success'}">${site.status || '완료'}</span></td>
                <td><span class="badge ${site.seo_score > 70 ? 'bg-success' : 'bg-warning'}">${site.seo_score}점</span></td>
                <td>${new Date(site.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="viewExistingReport('${site.id}')">보기</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteSite('${site.id}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    } catch (err) {}
}

async function deleteSite(siteId) {
    if (!confirm("정말 삭제하시겠습니까? (휴지통에서 복구 가능)")) return;
    try {
        const res = await fetch(`/api/sites/${siteId}`, { method: 'DELETE' });
        if (res.ok) {
            loadSiteHistory();
            loadDashboardStats();
        }
    } catch (err) {}
}

function initRevenueChart(revenueData = null) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    
    if (revenueChartInstance) revenueChartInstance.destroy();

    const labels = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        labels.push(['일', '월', '화', '수', '목', '금', '토'][d.getDay()]);
    }

    const dataPoints = revenueData || [0, 0, 0, 0, 0, 0, 0];
    
    revenueChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '방어 매출 (₩)',
                data: dataPoints,
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 3,
                pointRadius: 4,
                pointBackgroundColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { color: '#f1f1f1' }, 
                    ticks: { callback: value => '₩' + value.toLocaleString() } 
                },
                x: { grid: { display: false } }
            }
        }
    });
}
