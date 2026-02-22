/**
 * Organizations & Team Module
 */

let orgSites = [];
let orgSitesPage = 1;
const ORG_SITES_PER_PAGE = 10;

async function loadOrganizations() {
    try {
        const res = await fetch('/api/organizations');
        const data = await res.json();
        const select = document.getElementById('orgSelect');
        if (!select) return;
        
        select.innerHTML = '<option value="" selected>조직을 선택하세요...</option>';
        data.organizations.forEach(org => {
            const option = document.createElement('option');
            option.value = org.id;
            option.dataset.publicId = org.public_id;
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
    currentPublicId = publicId;
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
            const [sitesRes, discoveriesRes] = await Promise.all([
                fetch(`/api/sites?organization_id=${orgId}`),
                fetch(`/api/organizations/${orgId}/discoveries`)
            ]);
            
            const sitesData = await sitesRes.json();
            const discoveriesData = await discoveriesRes.json();
            const host = window.location.origin;

            const allSites = sitesData.sites || [];
            orgSites = allSites.filter(s => s.scraped_data && s.scraped_data.sdk_verified);
            let pendingSites = allSites.filter(s => !s.scraped_data || !s.scraped_data.sdk_verified);
            
            const seenManagedOrigins = new Set();
            orgSites.forEach(s => {
                try { seenManagedOrigins.add(new URL(s.url).origin); } catch(e) { seenManagedOrigins.add(s.url); }
            });

            pendingSites = pendingSites.filter(s => {
                try {
                    const origin = new URL(s.url).origin;
                    if (seenManagedOrigins.has(origin)) return false;
                    seenManagedOrigins.add(origin);
                    return true;
                } catch (e) {
                    if (seenManagedOrigins.has(s.url)) return false;
                    seenManagedOrigins.add(s.url);
                    return true;
                }
            });

            let uniqueDiscoveries = discoveriesData.discoveries || [];
            uniqueDiscoveries = uniqueDiscoveries.filter(url => {
                try {
                    const origin = new URL(url).origin;
                    if (seenManagedOrigins.has(origin)) return false;
                    seenManagedOrigins.add(origin);
                    return true;
                } catch (e) {
                    if (seenManagedOrigins.has(url)) return false;
                    seenManagedOrigins.add(url);
                    return true;
                }
            });

            orgSitesPage = 1; 
            let html = '';
            
            if (uniqueDiscoveries && uniqueDiscoveries.length > 0) {
                html += `
                    <div class="mb-5 p-3 border-warning bg-warning bg-opacity-10 rounded border animate-pulse">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h6 class="fw-bold text-dark mb-0"><i class="fas fa-satellite-dish me-2"></i> 새로운 사이트가 감지되었습니다!</h6>
                            <button class="btn btn-xs btn-outline-warning text-dark border-warning" onclick="refreshOrgSelection()">
                                <i class="fas fa-sync-alt me-1"></i> 새로고침
                            </button>
                        </div>
                        <div class="list-group shadow-sm">
                            ${uniqueDiscoveries.map(url => `
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
            }

            const displayId = publicId || orgId;
            const sdkHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
                ? host 
                : 'https://app.brightnetworks.kr';
                
            html += `
                <div class="mb-5 p-4 bg-light rounded border border-primary shadow-sm">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="mb-0 fw-bold text-primary"><i class="fas fa-code me-2"></i> 마케팅 자동화 스크립트</h6>
                    </div>
                    <p class="text-muted small mb-3">아래 코드를 사이트의 &lt;head&gt; 섹션에 복사하여 붙여넣으세요. 설치 후 사이트에 접속하면 자동으로 감지됩니다.</p>
                    <div class="code-block p-0">
                        <button class="copy-btn" onclick="copyText('script_universal')">Copy</button>
                        <pre class="m-0"><code id="script_universal" class="language-html">&lt;script src="${sdkHost}/sdk.js?key=${displayId}" async&gt;&lt;/script&gt;</code></pre>
                    </div>
                </div>
            `;

            if (pendingSites.length > 0) {
                html += `
                    <div class="mb-5 p-3 bg-white rounded border border-dashed border-secondary">
                        <h6 class="fw-bold text-secondary mb-3 small"><i class="fas fa-hourglass-half me-2"></i> 등록됨 (스크립트 신호 대기 중)</h6>
                        <div class="d-flex flex-wrap gap-2">
                            ${pendingSites.map(s => `
                                <span class="badge bg-white text-secondary border p-2">
                                    ${s.url} <i class="fas fa-spinner fa-spin ms-1 opacity-50"></i>
                                </span>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

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
            if (orgSites.length > 0) renderOrgSitesTable();
            if (window.hljs) scriptList.querySelectorAll('code').forEach(block => hljs.highlightElement(block));
        } catch (err) {
            scriptList.innerHTML = '<div class="text-danger small">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        }
    }
}

function renderOrgSitesTable() {
    const container = document.getElementById('orgSitesTableContainer');
    const countSpan = document.getElementById('orgSitesCount');
    if (!container) return;

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
                    <tr><th>도메인</th><th>상태</th><th>마지막 스캔</th></tr>
                </thead>
                <tbody>
                    ${pagedSites.map(site => `
                        <tr>
                            <td class="fw-bold">${site.url}</td>
                            <td><span class="badge bg-success">연결됨</span></td>
                            <td class="text-muted small">${new Date(site.created_at).toLocaleDateString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    if (totalPages > 1) {
        html += `<div class="d-flex justify-content-center mt-3"><nav><ul class="pagination pagination-sm mb-0">
            <li class="page-item ${orgSitesPage === 1 ? 'disabled' : ''}"><a class="page-link" href="javascript:void(0)" onclick="changeOrgSitesPage(${orgSitesPage - 1})">이전</a></li>
            ${Array.from({ length: totalPages }, (_, i) => i + 1).map(p => `<li class="page-item ${p === orgSitesPage ? 'active' : ''}"><a class="page-link" href="javascript:void(0)" onclick="changeOrgSitesPage(${p})">${p}</a></li>`).join('')}
            <li class="page-item ${orgSitesPage === totalPages ? 'disabled' : ''}"><a class="page-link" href="javascript:void(0)" onclick="changeOrgSitesPage(${orgSitesPage + 1})">다음</a></li>
        </ul></nav></div>`;
    }
    container.innerHTML = html;
}

function filterOrgSites() { orgSitesPage = 1; renderOrgSitesTable(); }
function changeOrgSitesPage(page) { orgSitesPage = page; renderOrgSitesTable(); }

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

async function loadMembers() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/organizations/${currentOrgId}/members`);
        const data = await res.json();
        const list = document.getElementById('memberList');
        if (!list) return;
        if (!data.members || data.members.length === 0) {
            list.innerHTML = '<tr><td colspan="4" class="text-center py-3">멤버가 없습니다.</td></tr>';
            return;
        }
        list.innerHTML = data.members.map(m => `<tr><td>${m.name}</td><td>${m.email}</td><td><span class="badge ${m.role === 'owner' ? 'bg-dark' : 'bg-secondary'}">${m.role}</span></td><td>${new Date(m.joined_at).toLocaleDateString()}</td></tr>`).join('');
    } catch (err) {}
}

async function loadTrash() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/sites/trash?organization_id=${currentOrgId}`);
        const data = await res.json();
        const list = document.getElementById('trashList');
        if (!list) return;
        if (!data.sites || data.sites.length === 0) {
            list.innerHTML = '<tr><td colspan="3" class="text-center py-3">휴지통이 비어 있습니다.</td></tr>';
            return;
        }
        list.innerHTML = data.sites.map(site => `<tr><td>${site.url}</td><td>${site.scraped_data?.deleted_at ? new Date(site.scraped_data.deleted_at).toLocaleString() : '알 수 없음'}</td><td><button class="btn btn-sm btn-success" onclick="restoreSite('${site.id}')">복구</button></td></tr>`).join('');
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

async function inviteMember() {
    if (!currentOrgId) return alert("조직을 먼저 선택해주세요.");
    const email = document.getElementById('inviteEmail').value.trim();
    const role = document.getElementById('inviteRole').value;
    if (!email) return alert("이메일을 입력해주세요.");
    try {
        const res = await fetch(`/api/organizations/${currentOrgId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, role })
        });
        const data = await res.json();
        if (data.success) { alert("초대 메일이 발송되었습니다."); document.getElementById('inviteEmail').value = ''; }
        else alert(data.error || "초대 실패");
    } catch (err) { alert("서버 오류"); }
}

async function registerDetectedSite(url, orgId) {
    if (!confirm(`${url} 사이트를 이 조직에 정식 등록하고 AI 분석을 시작하시겠습니까?`)) return;
    try {
        const res = await fetch('/api/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organization_id: orgId, url })
        });
        const data = await res.json();
        if (data.success || data.error === "이미 등록된 사이트입니다.") {
            await fetch(`/api/organizations/${orgId}/discoveries/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            alert(data.success ? "사이트 등록 및 AI 분석이 시작되었습니다!" : "이미 등록된 사이트입니다.");
            const select = document.getElementById('orgSelect');
            triggerOrgSelection(orgId, select.options[select.selectedIndex].text, select.options[select.selectedIndex].dataset.publicId);
        }
    } catch (err) {}
}

function refreshOrgSelection() {
    const select = document.getElementById('orgSelect');
    if (select && select.value) {
        triggerOrgSelection(select.value, select.options[select.selectedIndex].text, select.options[select.selectedIndex].dataset.publicId);
    }
}
