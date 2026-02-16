// public/js/dashboard.js

// State
let currentUser = null;
let currentOrgId = null;
let scoreChart = null;
let reportSites = [];
let orgSites = []; // New: store all sites for the active organization
let orgSitesPage = 1; // New: current page for org sites list
const ORG_SITES_PER_PAGE = 10;
let currentSort = { field: 'created_at', direction: 'desc' };

// Cookie Helpers
function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        let date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

function getCookie(name) {
    let nameEQ = name + "=";
    let ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

// Routing Logic
const routes = {
    '/dashboard': 'sectionDashboard',
    '/automation': 'sectionAutomation',
    '/reports': 'sectionReport',
    '/organizations': 'sectionOrg',
    '/subscription': 'sectionSubscription'
};

function navigateTo(path) {
    history.pushState(null, null, path);
    handleRouting();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    const isCollapsed = sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');
    
    setCookie('sidebar_collapsed', isCollapsed ? 'true' : 'false', 30);
}

function handleRouting() {
    let path = window.location.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    
    console.log(`[Router] Navigating to: ${path}, Org: ${currentOrgId}`);
    
    // Auth and Org Check
    if (path !== '/organizations' && !currentOrgId) {
        console.warn("[Router] No organization selected. Redirecting to /organizations");
        navigateTo('/organizations');
        return;
    }

    // Dynamic Route: /reports/:id
    const reportMatch = path.match(/^\/reports\/([^\/]+)$/);
    if (reportMatch) {
        const siteId = reportMatch[1];
        showSection('sectionReport');
        loadExistingReportData(siteId);
        return;
    }

    const sectionId = routes[path] || 'sectionDashboard';
    showSection(sectionId);
}

async function loadExistingReportData(siteId) {
    try {
        const res = await fetch(`/api/sites/detail/${siteId}`);
        const data = await res.json();
        if (data.site) {
            renderAnalysisResult(data.site.scraped_data, `<script src="https://api.brightnetworks.kr/sdk.js?key=${data.site.api_key}" async></script>`, data.site.url);
        }
    } catch (err) {
        console.error("Report load failed", err);
    }
}

window.addEventListener('popstate', handleRouting);

// Intercept link clicks for SPA navigation
document.addEventListener('click', (e) => {
    const link = e.target.closest('.nav-link');
    if (link && link.getAttribute('href').startsWith('/')) {
        e.preventDefault();
        navigateTo(link.getAttribute('href'));
    }
});

// Init
document.addEventListener('DOMContentLoaded', async () => {
    // Restore sidebar state
    if (getCookie('sidebar_collapsed') === 'true') {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('mainContent');
        if (sidebar) sidebar.classList.add('collapsed');
        if (mainContent) mainContent.classList.add('expanded');
    }

    try {
        await checkAuth();
        if (currentUser) {
            await loadOrganizations();
            
            // Check for saved org
            const savedOrgId = getCookie('active_org_id');
            if (savedOrgId) {
                const select = document.getElementById('orgSelect');
                if (select) {
                    const option = Array.from(select.options).find(opt => opt.value === savedOrgId);
                    if (option) {
                        select.value = savedOrgId;
                        currentOrgId = savedOrgId;
                        triggerOrgSelection(savedOrgId, option.text, option.dataset.publicId);
                        
                        if (window.location.pathname === '/') {
                            navigateTo('/dashboard');
                            return; // navigateTo calls handleRouting
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error("Initialization failed", err);
    } finally {
        handleRouting();
    }

    // Social Proof Real-time Preview
    const spInput = document.getElementById('socialProofText');
    if (spInput) {
        spInput.addEventListener('input', (e) => {
            let val = e.target.value;
            val = val.replace('{location}', '<strong>서울시</strong>')
                     .replace('{customer}', '<strong>김*연</strong>')
                     .replace('{product}', '<strong>린넨 셔츠</strong>')
                     .replace('{time}', '방금');
            const preview = document.querySelector('.social-proof-toast span');
            if (preview) preview.innerHTML = val;
        });
    }
});

let revenueChartInstance = null;

function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.add('hidden');
    });
    const target = document.getElementById(sectionId);
    if (target) target.classList.remove('hidden');

    if (sectionId === 'sectionReport' && !window.location.pathname.includes('/reports/')) {
        document.getElementById('step2Card').classList.remove('hidden');
        document.getElementById('step3Card').classList.add('hidden');
        // Show history card if hidden
        const historyCard = document.querySelector('#sectionReport .card.mb-4');
        if (historyCard) historyCard.classList.remove('hidden');
        
        // Reset search input
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput) searchInput.value = '';
    }

    if (sectionId === 'sectionAutomation') {
        // Ensure sites are loaded before loading settings
        if (reportSites.length === 0 && currentOrgId) {
            fetch(`/api/sites?organization_id=${currentOrgId}`)
                .then(res => res.json())
                .then(data => {
                    reportSites = data.sites || [];
                    loadAutomationSettings();
                });
        } else {
            loadAutomationSettings();
        }
    }

    if (sectionId === 'sectionDashboard') {
        loadSiteHistory();
        initRevenueChart();
    }
    if (sectionId === 'sectionReport') {
        loadReportHistory();
        loadUsage();
    }
    if (sectionId === 'sectionOrg') {
        loadTrash();
        loadMembers();
    }

    // Update Nav
    document.querySelectorAll('#mainNav .nav-link').forEach(link => {
        if (routes[link.getAttribute('href')] === sectionId) link.classList.add('active');
        else link.classList.remove('active');
    });
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
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { display: true, color: '#f1f1f1' },
                    ticks: { callback: value => '₩' + value.toLocaleString() }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// Automation Functions
async function loadAutomationSettings() {
    if (reportSites.length === 0) return;
    
    // Default to the first site's config for now
    const site = reportSites[0];
    const config = site.scraped_data.automation || {
        social_proof: { enabled: true, template: "{location} {customer}님이 {product}를 방금 구매했습니다!" },
        exit_intent: { enabled: true, text: "잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요..." },
        tab_recovery: { enabled: true, text: "🎁 놓치지 마세요!" },
        price_match: { enabled: true, text: "🔎 최저가를 찾고 계신가요? 여기서 5% 할인받으세요: SAVE5" }
    };

    if (document.getElementById('toggleSocialProof')) document.getElementById('toggleSocialProof').checked = config.social_proof?.enabled ?? true;
    if (document.getElementById('socialProofText')) document.getElementById('socialProofText').value = config.social_proof?.template || "";
    if (document.getElementById('toggleExitIntent')) document.getElementById('toggleExitIntent').checked = config.exit_intent?.enabled ?? true;
    if (document.getElementById('exitIntentEditor')) document.getElementById('exitIntentEditor').value = config.exit_intent?.text || "";
    if (document.getElementById('toggleTabRecovery')) document.getElementById('toggleTabRecovery').checked = config.tab_recovery?.enabled ?? true;
    if (document.getElementById('tabRecoveryText')) document.getElementById('tabRecoveryText').value = config.tab_recovery?.text || "";
    if (document.getElementById('togglePriceMatch')) document.getElementById('togglePriceMatch').checked = config.price_match?.enabled ?? true;
    if (document.getElementById('priceMatchText')) document.getElementById('priceMatchText').value = config.price_match?.text || "";
    
    // Trigger preview update
    if (document.getElementById('socialProofText')) document.getElementById('socialProofText').dispatchEvent(new Event('input'));
}

async function saveAutomation() {
    if (reportSites.length === 0) return alert("분석된 사이트가 없습니다. 먼저 분석을 진행해주세요.");
    
    const site = reportSites[0]; 
    const config = {
        social_proof: {
            enabled: document.getElementById('toggleSocialProof').checked,
            template: document.getElementById('socialProofText').value
        },
        exit_intent: {
            enabled: document.getElementById('toggleExitIntent').checked,
            text: document.getElementById('exitIntentEditor').value
        },
        tab_recovery: {
            enabled: document.getElementById('toggleTabRecovery').checked,
            text: document.getElementById('tabRecoveryText').value
        },
        price_match: {
            enabled: document.getElementById('togglePriceMatch').checked,
            text: document.getElementById('priceMatchText').value
        }
    };

    try {
        const res = await fetch(`/api/sites/${site.id}/automation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config })
        });
        const data = await res.json();
        if (data.success) {
            alert("설정이 안전하게 저장되었습니다! 모든 연동된 사이트에 즉시 적용됩니다.");
            // Update local state to reflect changes
            site.scraped_data.automation = config;
        }
    } catch (err) {
        alert("저장 실패");
    }
}

// Auth
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) { window.location.href = '/'; return; }
        const data = await res.json();
        currentUser = data.user;
        document.getElementById('userName').textContent = currentUser.name;
        document.getElementById('welcomeName').textContent = currentUser.name;
        document.getElementById('userAvatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}`;
    } catch (err) {
        window.location.href = '/';
    }
}

// Orgs
async function loadOrganizations() {
    try {
        const res = await fetch('/api/organizations');
        const data = await res.json();
        const select = document.getElementById('orgSelect');
        select.innerHTML = '<option value="" selected>조직을 선택하세요...</option>';
        data.organizations.forEach(org => {
            const option = document.createElement('option');
            option.value = org.id;
            option.dataset.publicId = org.public_id; // Store public_id here
            option.textContent = org.name;
            select.appendChild(option);
        });

        select.addEventListener('change', (e) => {
            const orgId = e.target.value;
            const publicId = e.target.options[e.target.selectedIndex].dataset.publicId;
            if (orgId) {
                currentOrgId = orgId;
                setCookie('active_org_id', orgId, 7);
                triggerOrgSelection(orgId, select.options[select.selectedIndex].text, publicId);
            }
        });
    } catch (err) {}
}

async function triggerOrgSelection(orgId, orgName, publicId) {
    const statusDiv = document.getElementById('activeOrgStatus');
    const activeName = document.getElementById('activeOrgName');
    if (statusDiv) statusDiv.classList.remove('hidden');
    if (activeName) activeName.textContent = orgName;

    const scriptSection = document.getElementById('orgScriptSection');
    const scriptList = document.getElementById('orgScriptList');
    
    if (scriptSection && scriptList) {
        scriptSection.classList.remove('hidden');
        scriptList.innerHTML = '<div class="text-center py-3 text-muted small">데이터를 불러오는 중...</div>';
        
        try {
            // Fetch both registered sites and discovered sites
            const [sitesRes, discoveriesRes] = await Promise.all([
                fetch(`/api/sites?organization_id=${orgId}`),
                fetch(`/api/organizations/${orgId}/discoveries`)
            ]);
            
            const sitesData = await sitesRes.json();
            const discoveriesData = await discoveriesRes.json();
            const host = window.location.origin;
            
            // 1. Split sites into Verified and Pending
            const allSites = sitesData.sites || [];
            orgSites = allSites.filter(s => s.scraped_data && s.scraped_data.sdk_verified);
            const pendingSites = allSites.filter(s => !s.scraped_data || !s.scraped_data.sdk_verified);
            
            orgSitesPage = 1; 
            
            let html = '';
            
            // 1. Discovery Section
            if (discoveriesData.discoveries && discoveriesData.discoveries.length > 0) {
                html += `
                    <div class="mb-5 p-3 border-warning bg-warning bg-opacity-10 rounded border animate-pulse">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h6 class="fw-bold text-dark mb-0"><i class="fas fa-satellite-dish me-2"></i> 새로운 사이트가 감지되었습니다!</h6>
                            <button class="btn btn-xs btn-outline-warning text-dark border-warning" onclick="refreshOrgSelection()">
                                <i class="fas fa-sync-alt me-1"></i> 새로고침
                            </button>
                        </div>
                        <div class="list-group shadow-sm">
                            ${discoveriesData.discoveries.map(url => `
                                <div class="list-group-item d-flex justify-content-between align-items-center bg-white border-warning border-opacity-20">
                                    <span class="fw-bold text-primary">${url}</span>
                                    <button class="btn btn-sm btn-success shadow-sm" onclick="registerDetectedSite('${url}', '${orgId}')">
                                        <i class="fas fa-plus me-1"></i> 등록 및 AI 분석 시작
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                html += `
                    <div class="text-end mb-3">
                        <button class="btn btn-sm btn-outline-secondary opacity-50" onclick="refreshOrgSelection()">
                            <i class="fas fa-sync-alt me-1"></i> 감지 신호 새로고침
                        </button>
                    </div>
                `;
            }

            // 2. Unified SDK Installation Script
            const displayId = publicId || orgId;
            const sdkHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
                ? host 
                : 'https://app.brightnetworks.kr';
                
            html += `
                <div class="mb-5 p-4 bg-light rounded border border-primary shadow-sm">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="mb-0 fw-bold text-primary"><i class="fas fa-code me-2"></i> SDK 설치 스크립트</h6>
                    </div>
                    <p class="text-muted small mb-3">아래 코드를 사이트의 &lt;head&gt; 섹션에 복사하여 붙여넣으세요. 설치 후 사이트에 접속하면 자동으로 감지됩니다.</p>
                    <div class="code-block p-0">
                        <button class="copy-btn" onclick="copyText('script_universal')">Copy</button>
                        <pre class="m-0"><code id="script_universal" class="language-html">&lt;script src="${sdkHost}/sdk.js?key=${displayId}" async&gt;&lt;/script&gt;</code></pre>
                    </div>
                </div>
            `;

            // 3. Pending Verification List
            if (pendingSites.length > 0) {
                html += `
                    <div class="mb-5 p-3 bg-white rounded border border-dashed border-secondary">
                        <h6 class="fw-bold text-secondary mb-3 small"><i class="fas fa-hourglass-half me-2"></i> 등록됨 (SDK 신호 대기 중)</h6>
                        <div class="d-flex flex-wrap gap-2">
                            ${pendingSites.map(s => `
                                <span class="badge bg-white text-secondary border p-2">
                                    ${s.url} <i class="fas fa-spinner fa-spin ms-1 opacity-50"></i>
                                </span>
                            `).join('')}
                        </div>
                        <p class="extra-small text-muted mt-2 mb-0">사이트에 스크립트 설치 후 한 번만 접속하시면 '연결됨' 목록으로 이동합니다.</p>
                    </div>
                `;
            }

            // 4. Registered Sites List (Paginated Container)
            html += `
                <div id="orgSitesHeader" class="d-flex justify-content-between align-items-center mb-3 mt-4 ${orgSites.length === 0 ? 'hidden' : ''}">
                    <h6 class="fw-bold mb-0 text-secondary"><i class="fas fa-check-circle me-2"></i> 연결된 사이트 목록 (<span id="orgSitesCount">${orgSites.length}</span>)</h6>
                    <div class="input-group input-group-sm" style="max-width: 250px;">
                        <span class="input-group-text bg-white border-end-0"><i class="fas fa-search text-muted"></i></span>
                        <input type="text" id="orgSitesSearch" class="form-control border-start-0 shadow-none" 
                            placeholder="도메인 검색..." onkeyup="filterOrgSites()">
                    </div>
                </div>
                <div id="orgSitesTableContainer"></div>
            `;
            
            scriptList.innerHTML = html;
            
            // Render the table if verified sites exist
            if (orgSites.length > 0) {
                renderOrgSitesTable();
            } else if ((!discoveriesData.discoveries || discoveriesData.discoveries.length === 0) && pendingSites.length === 0) {
                document.getElementById('orgSitesTableContainer').innerHTML = `
                    <div class="alert alert-light border text-center py-4 mb-0">
                        <i class="fas fa-info-circle me-2"></i> 아직 연결된 사이트가 없습니다. 위 스크립트를 설치하면 자동으로 여기에 나타납니다.
                    </div>
                `;
            }

            if (window.hljs) {
                scriptList.querySelectorAll('code').forEach(block => hljs.highlightElement(block));
            }
        } catch (err) {
            console.error("Failed to load scripts", err);
            scriptList.innerHTML = '<div class="text-danger small">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        }
    }
}

function renderOrgSitesTable() {
    const container = document.getElementById('orgSitesTableContainer');
    const countSpan = document.getElementById('orgSitesCount');
    if (!container) return;

    // Filter sites based on search input
    const searchTerm = document.getElementById('orgSitesSearch')?.value.toLowerCase() || "";
    const filteredSites = orgSites.filter(site => site.url.toLowerCase().includes(searchTerm));
    
    if (countSpan) countSpan.textContent = filteredSites.length;

    const totalPages = Math.ceil(filteredSites.length / ORG_SITES_PER_PAGE);
    const start = (orgSitesPage - 1) * ORG_SITES_PER_PAGE;
    const end = start + ORG_SITES_PER_PAGE;
    const pagedSites = filteredSites.slice(start, end);

    let html = `
        <div class="table-responsive">
            <table class="table table-sm table-hover border rounded overflow-hidden mb-0">
                <thead class="table-light">
                    <tr>
                        <th>도메인</th>
                        <th>상태</th>
                        <th>마지막 스캔</th>
                    </tr>
                </thead>
                <tbody>
                    ${pagedSites.map(site => `
                        <tr>
                            <td class="fw-bold">${site.url}</td>
                            <td><span class="badge bg-success">연결됨</span></td>
                            <td class="text-muted small">${new Date(site.created_at).toLocaleDateString()}</td>
                        </tr>
                    `).join('')}
                    ${pagedSites.length === 0 ? '<tr><td colspan="3" class="text-center py-4 text-muted small">검색 결과가 없습니다.</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;

    // Pagination controls
    if (totalPages > 1) {
        html += `
            <div class="d-flex justify-content-center mt-3">
                <nav>
                    <ul class="pagination pagination-sm mb-0">
                        <li class="page-item ${orgSitesPage === 1 ? 'disabled' : ''}">
                            <a class="page-link" href="javascript:void(0)" onclick="changeOrgSitesPage(${orgSitesPage - 1})">이전</a>
                        </li>
                        ${Array.from({ length: totalPages }, (_, i) => i + 1).map(p => `
                            <li class="page-item ${p === orgSitesPage ? 'active' : ''}">
                                <a class="page-link" href="javascript:void(0)" onclick="changeOrgSitesPage(${p})">${p}</a>
                            </li>
                        `).join('')}
                        <li class="page-item ${orgSitesPage === totalPages ? 'disabled' : ''}">
                            <a class="page-link" href="javascript:void(0)" onclick="changeOrgSitesPage(${orgSitesPage + 1})">다음</a>
                        </li>
                    </ul>
                </nav>
            </div>
        `;
    }

    container.innerHTML = html;
}

function filterOrgSites() {
    orgSitesPage = 1; // Reset to first page on search
    renderOrgSitesTable();
}

function changeOrgSitesPage(page) {
    const totalPages = Math.ceil(orgSites.length / ORG_SITES_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    orgSitesPage = page;
    renderOrgSitesTable();
}

async function registerDetectedSite(url, orgId) {
    if (!confirm(`${url} 사이트를 이 조직에 정식 등록하고 AI 분석을 시작하시겠습니까?`)) return;
    
    try {
        const btn = event.target.closest('button');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> 분석 중...';

        // 1. Register via existing site API
        const res = await fetch('/api/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organization_id: orgId, url })
        });
        const data = await res.json();
        
        if (data.success) {
            // 2. Clear from discoveries
            await fetch(`/api/organizations/${orgId}/discoveries/clear`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            
            alert("사이트 등록 및 AI 분석이 완료되었습니다!");
            const select = document.getElementById('orgSelect');
            triggerOrgSelection(orgId, select.options[select.selectedIndex].text, select.options[select.selectedIndex].dataset.publicId);
        } else {
            alert("등록 실패: " + (data.error || "알 수 없는 오류"));
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus me-1"></i> 지금 등록하기';
        }
    } catch (err) {
        alert("서버 연결 실패");
    }
}

async function createOrg() {
    const nameInput = document.getElementById('newOrgName');
    const name = nameInput.value.trim();
    if (!name) return alert("조직 이름을 입력해주세요.");
    try {
        const res = await fetch('/api/organizations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.success) {
            await loadOrganizations();
            document.getElementById('orgSelect').value = data.organization.id;
            document.getElementById('orgSelect').dispatchEvent(new Event('change'));
        }
    } catch (err) {}
}

// Sites & History
async function loadSiteHistory() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/sites?organization_id=${currentOrgId}`);
        const data = await res.json();
        const list = document.getElementById('siteHistoryList');
        if (!data.sites || data.sites.length === 0) {
            list.innerHTML = '<tr><td colspan="4" class="text-center py-4">데이터가 없습니다.</td></tr>';
            return;
        }
        list.innerHTML = '';
        data.sites.forEach(site => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${site.url}</strong></td>
                <td><span class="badge ${site.status === 'error' ? 'bg-danger' : 'bg-success'}">${site.status || '완료'}</span></td>
                <td><span class="badge ${site.seo_score > 70 ? 'bg-success' : 'bg-warning'}">${site.seo_score}점</span></td>
                <td>${new Date(site.created_at).toLocaleString()}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="viewExistingReport('${site.id}')">보기</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteSite('${site.id}')"><i class="fas fa-trash"></i></button>
                </td>
            `;
            list.appendChild(tr);
        });
    } catch (err) {}
}

async function loadReportHistory() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/sites?organization_id=${currentOrgId}`);
        const data = await res.json();
        reportSites = data.sites || [];
        renderReportHistory();
    } catch (err) {}
}

function sortHistory(field) {
    if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'desc'; // Default to desc for new field
    }
    
    // Sort logic
    reportSites.sort((a, b) => {
        let valA = a[field];
        let valB = b[field];

        if (field === 'created_at') {
            valA = new Date(valA);
            valB = new Date(valB);
        }

        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    renderReportHistory();
    updateSortIcons(field);
}

function updateSortIcons(activeField) {
    const headers = {
        'url': 0,
        'seo_score': 1,
        'created_at': 2
    };
    
    const tableHeaders = document.querySelectorAll('#sectionReport table thead th i');
    tableHeaders.forEach((icon, idx) => {
        if (idx === headers[activeField]) {
            icon.className = `fas fa-sort-${currentSort.direction === 'asc' ? 'up' : 'down'} ms-1`;
        } else {
            icon.className = 'fas fa-sort ms-1';
        }
    });
}

function filterHistoryTable() {
    renderReportHistory();
}

function renderReportHistory() {
    const list = document.getElementById('reportHistoryList');
    const searchTerm = document.getElementById('historySearchInput')?.value.toLowerCase() || "";
    
    const filteredSites = reportSites.filter(site => 
        site.url.toLowerCase().includes(searchTerm)
    );

    if (filteredSites.length === 0) {
        list.innerHTML = searchTerm 
            ? '<tr><td colspan="3" class="text-center py-4 text-muted">검색 결과가 없습니다.</td></tr>'
            : '<tr><td colspan="3" class="text-center py-4 text-muted">분석 내역이 없습니다.</td></tr>';
        return;
    }

    list.innerHTML = '';
    filteredSites.forEach(site => {
        const tr = document.createElement('tr');
        tr.onclick = () => viewExistingReport(site.id);
        const cleanUrl = site.url.replace(/^https?:\/\//, '');
        tr.innerHTML = `
            <td><span class="text-primary fw-bold">${cleanUrl}</span></td>
            <td><span class="badge ${site.seo_score > 70 ? 'bg-success' : 'bg-warning'}">${site.seo_score}점</span></td>
            <td class="text-muted">${new Date(site.created_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        `;
        list.appendChild(tr);
    });
}

async function deleteSite(siteId) {
    if (!confirm("정말 삭제하시겠습니까? (휴지통에서 복구 가능)")) return;
    try {
        const res = await fetch(`/api/sites/${siteId}`, { method: 'DELETE' });
        if (res.ok) loadSiteHistory();
    } catch (err) {}
}

// Trash & Restore
async function loadTrash() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/sites/trash?organization_id=${currentOrgId}`);
        const data = await res.json();
        const list = document.getElementById('trashList');
        if (!data.sites || data.sites.length === 0) {
            list.innerHTML = '<tr><td colspan="3" class="text-center py-3">휴지통이 비어 있습니다.</td></tr>';
            return;
        }
        list.innerHTML = '';
        data.sites.forEach(site => {
            const tr = document.createElement('tr');
            const deletedAt = site.scraped_data ? site.scraped_data.deleted_at : null;
            const dateStr = deletedAt ? new Date(deletedAt).toLocaleString() : '알 수 없음';
            tr.innerHTML = `
                <td>${site.url}</td>
                <td>${dateStr}</td>
                <td>
                    <button class="btn btn-sm btn-success" onclick="restoreSite('${site.id}')">복구</button>
                </td>
            `;
            list.appendChild(tr);
        });
    } catch (err) {}
}

async function restoreSite(siteId) {
    try {
        const res = await fetch(`/api/sites/restore/${siteId}`, { method: 'POST' });
        if (res.ok) loadTrash();
    } catch (err) {}
}

function toggleTrash() {
    const container = document.getElementById('trashContainer');
    const btn = document.getElementById('btnToggleTrash');
    const isHidden = container.classList.contains('hidden');
    
    if (isHidden) {
        container.classList.remove('hidden');
        btn.innerHTML = '닫기 <i class="fas fa-chevron-up ms-1"></i>';
    } else {
        container.classList.add('hidden');
        btn.innerHTML = '더 보기 <i class="fas fa-chevron-down ms-1"></i>';
    }
}

// Team Management
async function loadMembers() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/organizations/${currentOrgId}/members`);
        const data = await res.json();
        const list = document.getElementById('memberList');
        if (!data.members || data.members.length === 0) {
            list.innerHTML = '<tr><td colspan="4" class="text-center py-3">멤버가 없습니다.</td></tr>';
            return;
        }
        list.innerHTML = '';
        data.members.forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${m.name}</td>
                <td>${m.email}</td>
                <td><span class="badge ${m.role === 'owner' ? 'bg-dark' : 'bg-secondary'}">${m.role}</span></td>
                <td>${new Date(m.joined_at).toLocaleDateString()}</td>
            `;
            list.appendChild(tr);
        });
    } catch (err) {}
}

async function inviteMember() {
    if (!currentOrgId) return alert("조직을 먼저 선택해주세요.");
    const email = document.getElementById('inviteEmail').value.trim();
    const role = document.getElementById('inviteRole').value;
    if (!email) return alert("이메일을 입력해주세요.");

    try {
        const btn = document.querySelector('button[onclick="inviteMember()"]');
        btn.disabled = true;
        btn.textContent = "발송 중...";

        const res = await fetch(`/api/organizations/${currentOrgId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, role })
        });
        const data = await res.json();
        if (data.success) {
            alert("초대 메일이 발송되었습니다.");
            document.getElementById('inviteEmail').value = '';
        } else {
            alert(data.error || "초대 실패");
        }
    } catch (err) {
        alert("서버 오류");
    } finally {
        const btn = document.querySelector('button[onclick="inviteMember()"]');
        btn.disabled = false;
        btn.textContent = "초대 메일 발송";
    }
}

// Analysis & Scans
async function registerSite() {
    const urlInput = document.getElementById('siteUrl');
    let url = urlInput.value.trim().replace(/^(https?:\/\/)/, '');
    if (!url) return alert("URL을 입력하세요.");
    urlInput.value = url;
    if (!currentOrgId) return;

    const btn = document.querySelector('button[onclick="registerSite()"]');
    const loader = document.getElementById('scanLoader');
    btn.disabled = true;
    loader.style.display = 'block';
    document.getElementById('step3Card').classList.add('hidden');

    try {
        const res = await fetch('/api/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organization_id: currentOrgId, url: 'https://' + url })
        });
        const data = await res.json();
        if (data.success) renderAnalysisResult(data.site.scraped_data, data.script_tag, data.site.url);
    } catch (err) {
        alert("분석 실패");
    } finally {
        btn.disabled = false;
        loader.style.display = 'none';
    }
}

function renderAnalysisResult(siteData, scriptTag, url) {
    const card = document.getElementById('step3Card');
    
    // Page Transition: Hide everything else in the section
    const section = document.getElementById('sectionReport');
    if (section) {
        section.querySelectorAll('.card').forEach(c => {
            if (c.id !== 'step3Card') c.classList.add('hidden');
        });
    }

    if (url) {
        document.getElementById('analyzedUrlDisplay').textContent = url;
    }

    if (siteData.screenshot) {
        const img = document.getElementById('siteScreenshot');
        const placeholder = document.getElementById('screenshotPlaceholder');
        img.src = `/screenshots/${siteData.screenshot}`;
        img.style.display = 'inline-block';
        placeholder.style.display = 'none';
    } else {
        const img = document.getElementById('siteScreenshot');
        const placeholder = document.getElementById('screenshotPlaceholder');
        if (img) img.style.display = 'none';
        if (placeholder) placeholder.style.display = 'block';
    }

    document.getElementById('seoScoreDisplay').textContent = siteData.seo_score || 0;
    renderScoreChart(siteData.seo_score || 0);
    document.getElementById('siteSummary').textContent = siteData.summary || "--";
    
    const prodContainer = document.getElementById('detectedProducts');
    if (prodContainer) {
        prodContainer.innerHTML = '';
        (siteData.detected_products || []).forEach(p => {
            const s = document.createElement('span');
            s.className = 'badge bg-light text-primary border';
            s.textContent = p;
            prodContainer.appendChild(s);
        });
    }

    const analysisOpinion = siteData.ceo_message || siteData.analysis_opinion; 
    if (analysisOpinion) {
        document.getElementById('ceoMessage').textContent = analysisOpinion;
        document.getElementById('ceoMessageContainer').style.display = 'block';
    } else {
        document.getElementById('ceoMessageContainer').style.display = 'none';
    }

    const advice = siteData.advice || {};
    document.getElementById('adviceMeta').textContent = advice.meta || "--";
    document.getElementById('adviceSemantics').textContent = advice.semantics || "--";
    document.getElementById('adviceImages').textContent = advice.images || "--";
    document.getElementById('adviceLinks').textContent = advice.links || "--";
    document.getElementById('adviceSchemas').textContent = advice.schemas || "--";

    const aio = siteData.ai_visibility || {};
    document.getElementById('aiScore').textContent = aio.score || 0;
    document.getElementById('chatgptStatus').textContent = aio.chatgpt_readiness || "--";
    document.getElementById('perplexityStatus').textContent = aio.perplexity_readiness || "--";
    document.getElementById('geminiStatus').textContent = aio.gemini_readiness || "--";
    document.getElementById('aiTip').textContent = aio.improvement_tip || "--";

    document.getElementById('scriptTagCode').textContent = scriptTag || "";
    if (window.hljs) hljs.highlightElement(document.getElementById('scriptTagCode'));

    // Render Sample Codes
    if (siteData.sample_codes) {
        const seoEl = document.getElementById('seoSampleCode');
        const geoEl = document.getElementById('geoSampleCode');
        seoEl.textContent = siteData.sample_codes.seo || "";
        geoEl.textContent = siteData.sample_codes.geo || "";
        if (window.hljs) {
            hljs.highlightElement(seoEl);
            hljs.highlightElement(geoEl);
        }
        document.getElementById('sampleCodeContainer').style.display = 'block';
    } else {
        document.getElementById('sampleCodeContainer').style.display = 'none';
    }

    card.classList.remove('hidden');
    card.scrollIntoView({ behavior: 'smooth' });
}

async function viewExistingReport(siteId) {
    navigateTo(`/reports/${siteId}`);
}

// Usage Tracking
async function loadUsage() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/usage?organization_id=${currentOrgId}`);
        const data = await res.json();
        const display = document.getElementById('remainingCount');
        if (display) {
            display.textContent = 1000 - data.used;
        }
    } catch (err) {}
}

// Sitemap Analysis
async function parseSitemap() {
    await loadUsage();
    const input = document.getElementById('sitemapUrl');
    let url = input.value.trim().replace(/^(https?:\/\/)/, '');
    if (!url) return alert("Sitemap URL을 입력하세요.");
    input.value = url;

    const btn = document.querySelector('button[onclick="parseSitemap()"]');
    btn.disabled = true;
    btn.textContent = "추출 중...";

    try {
        const res = await fetch('/api/sitemaps/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        
        if (data.success) {
            const list = document.getElementById('sitemapUrlList');
            const resultDiv = document.getElementById('sitemapResult');
            const countSpan = document.getElementById('urlCount');
            
            list.innerHTML = '';
            data.urls.forEach(u => {
                const item = document.createElement('label');
                item.className = 'list-group-item d-flex align-items-center cursor-pointer';
                item.innerHTML = `
                    <input class="form-check-input me-3 sitemap-url-check" type="checkbox" value="${u}" checked>
                    <span class="small text-truncate">${u}</span>
                `;
                list.appendChild(item);
            });

            countSpan.textContent = data.urls.length;
            resultDiv.classList.remove('hidden');
        } else {
            alert(data.error || "파싱 실패");
        }
    } catch (err) {
        alert("서버 오류");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-list-ul me-2"></i> URL 추출하기';
    }
}

async function batchAnalyzeSitemap() {
    const checked = Array.from(document.querySelectorAll('.sitemap-url-check:checked'));
    if (checked.length === 0) return alert("분석할 URL을 선택해주세요.");
    
    // Check usage before starting
    const usageRes = await fetch(`/api/usage?organization_id=${currentOrgId}`);
    const usageData = await usageRes.json();
    const remaining = usageData.limit - usageData.used;
    
    if (checked.length > remaining) {
        return alert(`남은 분석 횟수(${remaining}회)보다 많은 URL(${checked.length}개)을 선택하셨습니다. 선택을 줄이거나 업그레이드 해주세요.`);
    }

    if (!confirm(`${checked.length}개의 페이지를 분석하시겠습니까? (최대 3개 동시 진행)`)) return;

    const btn = document.querySelector('button[onclick="batchAnalyzeSitemap()"]');
    btn.disabled = true;
    
    const urls = checked.map(cb => cb.value);
    const CONCURRENCY = 3;
    
    // Simple parallel execution with limit
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
        const chunk = urls.slice(i, i + CONCURRENCY);
        btn.textContent = `분석 중... (${i + 1}/${urls.length})`;
        
        await Promise.all(chunk.map(async (url) => {
            const tempUrl = url.replace(/^https?:\/\//, '');
            // We need a way to run registerSite without it affecting the global step3Card immediately or scrolling
            // For now, we'll just call it, but ideally we'd have a non-UI version
            try {
                const res = await fetch('/api/sites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ organization_id: currentOrgId, url: 'https://' + tempUrl })
                });
                const data = await res.json();
                if (!data.success) console.error("Failed:", url, data.error);
            } catch (err) {
                console.error("Error:", url, err);
            }
        }));
        await loadUsage();
    }
    
    btn.disabled = false;
    btn.textContent = "선택 항목 일괄 분석";
    alert("모든 분석이 완료되었습니다. 내역은 대시보드에서 확인하세요!");
    loadSiteHistory();
}

async function batchRunAll() {
    const urls = Array.from(document.querySelectorAll('#siteHistoryList tr td:first-child strong')).map(el => el.textContent);
    if (urls.length === 0) return;
    if (!confirm("일괄 분석하시겠습니까?")) return;
    navigateTo('/reports');
    for (const url of urls) {
        document.getElementById('siteUrl').value = url;
        await registerSite();
    }
}

function renderScoreChart(score) {
    const ctx = document.getElementById('scoreChart').getContext('2d');
    if (scoreChart) scoreChart.destroy();
    scoreChart = new Chart(ctx, {
        type: 'doughnut',
        data: { datasets: [{ data: [score, 100 - score], backgroundColor: ['#2ecc71', '#ecf0f1'], borderWidth: 0 }] },
        options: { cutout: '80%', plugins: { tooltip: { enabled: false }, legend: { display: false } } }
    });
}

function copyText(elementId) {
    const text = document.getElementById(elementId).textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
        alert("클립보드에 복사되었습니다.");
    });
}

function copyCode() {
    copyText('scriptTagCode');
}