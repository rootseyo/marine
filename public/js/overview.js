/**
 * Dashboard Overview Module
 */

let revenueChartInstance = null;

async function loadSiteHistory() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/sites?organization_id=${currentOrgId}`);
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
                <td>${new Date(site.created_at).toLocaleString()}</td>
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
            if (typeof loadReportHistory === 'function') loadReportHistory();
        }
    } catch (err) {}
}

function initRevenueChart() {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    
    if (revenueChartInstance) revenueChartInstance.destroy();
    
    revenueChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: ['월', '화', '수', '목', '금', '토', '일'],
            datasets: [{
                label: '방어 매출 (₩)',
                data: [150000, 230000, 180000, 290000, 320000, 450000, 410000],
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
                y: { beginAtZero: true, grid: { color: '#f1f1f1' }, ticks: { callback: value => '₩' + value.toLocaleString() } },
                x: { grid: { display: false } }
            }
        }
    });
}
