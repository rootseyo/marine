/**
 * Reports & Analysis Module
 */

let reportSites = [];
let scoreChart = null;
let scheduleModal = null;

async function loadReportHistory() {
    const orgParam = currentPublicId || currentOrgId;
    if (!orgParam) return;
    try {
        const res = await fetch(`/api/sites?organization_id=${orgParam}`);
        const data = await res.json();
        reportSites = data.sites || [];
        renderReportHistory();
    } catch (err) {}
}

function renderReportHistory() {
    const list = document.getElementById('reportHistoryList');
    if (!list) return;
    const searchTerm = document.getElementById('historySearchInput')?.value.toLowerCase() || "";
    
    const filteredSites = reportSites.filter(site => 
        site.url.toLowerCase().includes(searchTerm)
    );

    if (filteredSites.length === 0) {
        list.innerHTML = searchTerm 
            ? '<tr><td colspan="6" class="text-center py-4 text-muted">검색 결과가 없습니다.</td></tr>'
            : '<tr><td colspan="6" class="text-center py-4 text-muted">등록된 사이트가 없습니다.</td></tr>';
        return;
    }

    list.innerHTML = '';
    filteredSites.forEach(site => {
        const tr = document.createElement('tr');
        const status = site.scraped_data?.status;
        const isAnalyzed = status === 'active';
        const isQueued = status === 'queued';
        const historyCount = (site.scraped_data?.history?.length || 0) + (isAnalyzed ? 1 : 0);
        
        tr.onclick = () => {
            if (isAnalyzed) viewExistingReport(site.id);
        };
        const cleanUrl = site.url.replace(/^https?:\/\//, '');
        const device = site.scraped_data?.device || 'desktop';
        const deviceIcon = device === 'mobile' ? '<i class="fas fa-mobile-alt me-1 text-muted" title="Mobile View"></i>' : '<i class="fas fa-desktop me-1 text-muted" title="Desktop View"></i>';
        
        // Schedule Badge
        const schedule = site.scraped_data?.schedule || 'none';
        let scheduleBadge = '';
        if (schedule !== 'none') {
            const time = site.scraped_data?.schedule_time || '00:00';
            const nextRun = site.scraped_data?.next_run_at ? new Date(site.scraped_data.next_run_at).toLocaleDateString() : '';
            scheduleBadge = `<div class="mt-1"><span class="badge bg-light text-dark border extra-small" title="다음 예정일: ${nextRun}"><i class="fas fa-calendar-check me-1"></i>${schedule.toUpperCase()} @ ${time}</span></div>`;
        }

        tr.innerHTML = `
            <td onclick="event.stopPropagation()"><input type="checkbox" class="site-check" value="${site.id}"></td>
            <td>
                ${deviceIcon}
                <span class="text-primary fw-bold">${cleanUrl}</span>
                ${historyCount > 1 ? `<span class="badge rounded-pill bg-light text-dark border ms-1" title="분석 히스토리">v${historyCount}</span>` : ''}
            </td>
            <td>
                <span class="badge ${isAnalyzed ? 'bg-success' : (isQueued ? 'bg-info' : (status === 'error' ? 'bg-danger' : 'bg-secondary'))}">
                    ${isAnalyzed ? '분석 완료' : (isQueued ? '분석 대기 중' : (status === 'error' ? '오류' : '대기 중'))}
                </span>
                ${scheduleBadge}
            </td>
            <td><span class="badge ${site.seo_score > 70 ? 'bg-success' : (site.seo_score > 0 ? 'bg-warning' : 'bg-light text-dark')}">${site.seo_score > 0 ? site.seo_score + '점' : '--'}</span></td>
            <td class="text-muted small">${new Date(site.created_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td>
                <div class="d-flex gap-1">
                    <button class="btn btn-xs ${isQueued ? 'btn-secondary' : 'btn-primary'}" onclick="event.stopPropagation(); reAnalyzeSite('${site.id}')" title="즉시 분석 실행" ${isQueued ? 'disabled' : ''}>
                        <i class="fas ${isQueued ? 'fa-hourglass-half' : 'fa-play'} me-1"></i> 분석
                    </button>
                    <button class="btn btn-xs btn-outline-secondary" onclick="event.stopPropagation(); openScheduleModal('${site.id}', '${schedule}', '${site.scraped_data?.schedule_time || '03:00'}')" title="스케줄 설정">
                        <i class="fas fa-clock"></i>
                    </button>
                    ${isAnalyzed ? `
                        <button class="btn btn-xs btn-outline-primary" onclick="event.stopPropagation(); viewExistingReport('${site.id}')">
                            <i class="fas fa-file-alt"></i>
                        </button>
                    ` : ''}
                    <button class="btn btn-xs btn-outline-danger border-0" onclick="event.stopPropagation(); deleteSite('${site.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        `;
        list.appendChild(tr);
    });
}

function toggleAllSites(master) {
    document.querySelectorAll('.site-check').forEach(cb => cb.checked = master.checked);
}

async function batchAnalyzeSelected() {
    const selected = Array.from(document.querySelectorAll('.site-check:checked')).map(cb => cb.value);
    if (selected.length === 0) return alert("분석할 사이트를 선택해주세요.");
    
    if (!confirm(`${selected.length}개의 사이트를 순차 분석 대기 목록에 추가하시겠습니까?`)) return;

    for (let siteId of selected) {
        await fetch(`/api/sites/${siteId}/queue`, { method: 'POST' });
    }

    alert("분석 대기 목록에 추가되었습니다. 서버가 순차적으로 분석을 진행합니다.");
    loadReportHistory();
}

async function batchQueueAll() {
    const orgParam = currentPublicId || currentOrgId;
    if (!orgParam) return;

    if (!confirm("이 조직의 모든 사이트를 순차적으로 분석하시겠습니까? (서버 부하 방지를 위해 순차 진행됩니다)")) return;

    try {
        const res = await fetch(`/api/organizations/${orgParam}/batch-queue`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            loadReportHistory();
        } else {
            alert(data.error);
        }
    } catch (err) {
        alert("서버 오류");
    }
}

function openScheduleModal(siteId, currentSchedule, currentTime) {
    document.getElementById('scheduleSiteId').value = siteId;
    document.getElementById('scheduleTargetType').value = 'site';
    document.getElementById('scheduleTypeSelect').value = currentSchedule || 'none';
    document.getElementById('scheduleTimeInput').value = currentTime || '03:00';
    
    document.getElementById('scheduleModalTitle').innerHTML = '<i class="fas fa-calendar-alt me-2"></i> 사이트 정기 분석 설정';
    document.getElementById('scheduleModalDesc').textContent = '이 사이트에 대해 정기적으로 AI 분석을 수행하도록 예약합니다.';

    if (!scheduleModal) {
        scheduleModal = new bootstrap.Modal(document.getElementById('scheduleModal'));
    }
    
    const nextRunInfo = document.getElementById('nextRunInfo');
    const site = reportSites.find(s => s.id == siteId);
    if (site && site.scraped_data?.next_run_at) {
        nextRunInfo.classList.remove('d-none');
        document.getElementById('nextRunDateDisplay').textContent = new Date(site.scraped_data.next_run_at).toLocaleString();
    } else {
        nextRunInfo.classList.add('d-none');
    }
    
    scheduleModal.show();
}

function openOrgScheduleModal() {
    const orgParam = currentPublicId || currentOrgId;
    if (!orgParam) return alert("조직을 선택해주세요.");

    document.getElementById('scheduleTargetType').value = 'org';
    document.getElementById('scheduleTypeSelect').value = 'none'; 
    document.getElementById('scheduleTimeInput').value = '03:00';
    
    document.getElementById('scheduleModalTitle').innerHTML = '<i class="fas fa-building me-2"></i> 전체 사이트 정기 분석 설정';
    document.getElementById('scheduleModalDesc').textContent = '현재 조직에 등록된 모든 사이트에 대해 동일한 정기 분석 주기를 설정합니다.';
    document.getElementById('nextRunInfo').classList.add('d-none');

    if (!scheduleModal) {
        scheduleModal = new bootstrap.Modal(document.getElementById('scheduleModal'));
    }
    
    scheduleModal.show();
}

async function saveSchedule() {
    const targetType = document.getElementById('scheduleTargetType').value;
    const schedule = document.getElementById('scheduleTypeSelect').value;
    const time = document.getElementById('scheduleTimeInput').value;
    const orgParam = currentPublicId || currentOrgId;

    try {
        let url = '';
        if (targetType === 'org') {
            url = `/api/organizations/${orgParam}/schedule`;
        } else {
            const siteId = document.getElementById('scheduleSiteId').value;
            url = `/api/sites/${siteId}/schedule`;
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedule, time })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.message || "스케줄이 저장되었습니다.");
            if (scheduleModal) scheduleModal.hide();
            loadReportHistory();
        } else {
            alert(data.error);
        }
    } catch (err) {
        alert("저장 실패");
    }
}

async function reAnalyzeSite(siteId) {
    const btn = event.target.closest('button');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    try {
        const res = await triggerAnalysis(siteId);
        if (res.error) {
            alert(res.error);
        } else {
            alert("분석이 시작되었습니다 (순차 대기 목록 추가).");
        }
        loadReportHistory();
        loadUsage();
    } catch (err) {
        alert("분석 중 오류가 발생했습니다.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

async function triggerAnalysis(siteId) {
    const res = await fetch(`/api/sites/${siteId}/analyze`, { method: 'POST' });
    return await res.json();
}

async function registerOnlySite() {
    const urlInput = document.getElementById('siteUrl');
    const deviceSelect = document.getElementById('siteDevice');
    let url = urlInput.value.trim();
    if (!url) return alert("URL을 입력하세요.");
    if (!currentOrgId) return;

    const device = deviceSelect ? deviceSelect.value : 'desktop';

    // Ensure protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    const btn = document.querySelector('button[onclick="registerOnlySite()"]');
    btn.disabled = true;

    try {
        const res = await fetch('/api/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                organization_id: currentOrgId, 
                url: url, 
                device: device,
                skip_analysis: true 
            })
        });
        const data = await res.json();
        if (data.success) {
            urlInput.value = '';
            loadReportHistory();
            alert("사이트가 등록되었습니다. 목록에서 '분석' 버튼을 눌러 스캔을 시작하세요.");
        } else {
            alert(data.error || "등록 실패");
        }
    } catch (err) {
        alert("서버 오류");
    } finally {
        btn.disabled = false;
    }
}

async function viewExistingReport(siteId) {
    navigateTo(`/reports/${siteId}`);
}

let currentFullSiteData = null;

async function loadExistingReportData(siteId) {
    try {
        const res = await fetch(`/api/sites/detail/${siteId}`);
        const data = await res.json();
        if (data.site) {
            currentFullSiteData = data.site;
            const displayId = currentPublicId || data.site.organization_id;
            renderAnalysisResult(data.site.scraped_data, `<script src="https://api.brightnetworks.kr/sdk.js?key=${displayId}" async></script>`, data.site.url);
            setupHistorySelector(data.site.scraped_data);
        }
    } catch (err) {
        console.error("Report load failed", err);
    }
}

function setupHistorySelector(siteData) {
    const selectorWrap = document.getElementById('reportHistorySelector');
    const select = document.getElementById('historySelect');
    if (!selectorWrap || !select) return;

    if (siteData.history && siteData.history.length > 0) {
        selectorWrap.style.display = 'block';
        select.innerHTML = '<option value="latest">최신 분석 결과 (현재)</option>';
        siteData.history.forEach((snap, idx) => {
            const date = new Date(snap.analyzed_at || snap.archived_at).toLocaleString();
            const option = document.createElement('option');
            option.value = idx;
            option.textContent = `이전 버전 - ${date}`;
            select.appendChild(option);
        });
    } else {
        selectorWrap.style.display = 'none';
    }
}

function switchReportVersion(index) {
    if (!currentFullSiteData) return;
    const displayId = currentPublicId || currentFullSiteData.organization_id;
    const scriptTag = `<script src="https://api.brightnetworks.kr/sdk.js?key=${displayId}" async></script>`;
    
    if (index === 'latest') {
        renderAnalysisResult(currentFullSiteData.scraped_data, scriptTag, currentFullSiteData.url);
    } else {
        const snapshot = currentFullSiteData.scraped_data.history[parseInt(index)];
        renderAnalysisResult(snapshot, scriptTag, currentFullSiteData.url);
    }
}

function renderAnalysisResult(siteData, scriptTag, url) {
    const card = document.getElementById('step3Card');
    if (!card) return;
    
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
        img.src = "/screenshots/" + siteData.screenshot;
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
    const yOffset = -20; 
    const y = card.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: 'smooth' });
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
    if (checked.length === 0) return alert("등록할 URL을 선택해주세요.");
    
    if (!confirm(`${checked.length}개의 페이지를 사이트 목록에 등록하시겠습니까?`)) return;

    const btn = document.querySelector('button[onclick="batchAnalyzeSitemap()"]');
    btn.disabled = true;
    
    const urls = checked.map(cb => cb.value);
    const CONCURRENCY = 3;
    
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
        const chunk = urls.slice(i, i + CONCURRENCY);
        btn.textContent = `등록 중... (${i + 1}/${urls.length})`;
        
        await Promise.all(chunk.map(async (url) => {
            try {
                const res = await fetch('/api/sites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ organization_id: currentOrgId, url: url, skip_analysis: true })
                });
                const data = await res.json();
                if (!data.success) console.error("Failed:", url, data.error);
            } catch (err) {
                console.error("Error:", url, err);
            }
        }));
    }
    
    btn.disabled = false;
    btn.textContent = "선택 항목 사이트 등록";
    alert("선택한 모든 URL이 사이트 목록에 등록되었습니다. 목록에서 분석을 시작할 수 있습니다.");
    loadReportHistory();
}

function copyText(elementId) {
    const text = document.getElementById(elementId).textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
        alert("클립보드에 복사되었습니다.");
    });
}

function filterHistoryTable() {
    renderReportHistory();
}

function sortHistory(field) {
    if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'desc';
    }
    
    reportSites.sort((a, b) => {
        let valA = a[field];
        let valB = b[field];
        if (field === 'created_at') { valA = new Date(valA); valB = new Date(valB); }
        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    renderReportHistory();
    updateSortIcons(field);
}

function updateSortIcons(activeField) {
    const headers = { 'url': 0, 'seo_score': 3, 'created_at': 4 };
    const tableHeaders = document.querySelectorAll('#sectionReport table thead th i');
    tableHeaders.forEach((icon, idx) => {
        const headerIdx = headers[activeField];
        if (idx === headerIdx) {
            icon.className = `fas fa-sort-${currentSort.direction === 'asc' ? 'up' : 'down'} ms-1`;
        } else {
            icon.className = 'fas fa-sort ms-1';
        }
    });
}

async function deleteSite(siteId) {
    if (!confirm("정말 이 사이트를 삭제하시겠습니까?\n삭제된 사이트는 휴지통에서 30일간 보관됩니다.")) return;

    try {
        const res = await fetch(`/api/sites/${siteId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        
        if (data.success) {
            alert("사이트가 삭제되었습니다.");
            loadReportHistory();
            if (typeof loadUsage === 'function') loadUsage();
            if (typeof loadSiteHistory === 'function') loadSiteHistory();
        } else {
            alert(data.error || "삭제 실패");
        }
    } catch (err) {
        console.error("Delete failed", err);
        alert("서버 오류가 발생했습니다.");
    }
}

async function downloadPDF() {
    if (!currentFullSiteData) return;
    const siteId = currentFullSiteData.id;
    const url = `/api/reports/${siteId}/pdf`;
    
    const btn = event.target.closest('button');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> 생성 중...';

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("PDF 생성 실패");
        
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `SEO_Report_${new URL(currentFullSiteData.url).hostname}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (err) {
        alert(err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

async function emailPDF() {
    if (!currentFullSiteData) return;
    const siteId = currentFullSiteData.id;
    const url = `/api/reports/${siteId}/email`;

    const btn = event.target.closest('button');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> 발송 중...';

    try {
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
        } else {
            alert(data.error);
        }
    } catch (err) {
        alert("발송 실패");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}
