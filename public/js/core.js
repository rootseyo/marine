/**
 * Core Logic & Router
 */

// Global State
let currentUser = null;
let currentOrgId = null;
let currentPublicId = null;
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
    startSessionTimer(); // Reset timer on navigation
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    const toggleIcon = document.getElementById('toggleIcon');
    const isCollapsed = sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');

    if (toggleIcon) {
        if (isCollapsed) {
            toggleIcon.classList.replace('fa-chevron-left', 'fa-chevron-right');
        } else {
            toggleIcon.classList.replace('fa-chevron-right', 'fa-chevron-left');
        }
    }

    setCookie('sidebar_collapsed', isCollapsed ? 'true' : 'false', 30);
}
function handleRouting() {
    let path = window.location.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    
    console.log(`[Router] Navigating to: ${path}, Org: ${currentOrgId}`);
    
    // Dynamic Route: /reports/:id (Check this first!)
    const reportMatch = path.match(/^\/reports\/([^\/]+)$/);
    if (reportMatch) {
        const siteId = reportMatch[1];
        showSection('sectionReport');
        if (typeof loadExistingReportData === 'function') loadExistingReportData(siteId);
        return;
    }

    // Auth and Org Check: For other pages, ensure org is selected
    if (path !== '/' && path !== '/organizations' && !currentOrgId) {
        console.warn("[Router] No organization selected. Redirecting to /organizations");
        navigateTo('/organizations');
        return;
    }

    const sectionId = routes[path] || 'sectionDashboard';
    showSection(sectionId);
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

// Auth
let sessionTimeout = null;
let remainingSeconds = 30 * 60;

function startSessionTimer() {
    if (sessionTimeout) clearInterval(sessionTimeout);
    remainingSeconds = 30 * 60;
    
    const timerEl = document.getElementById('sessionTimer');
    if (!timerEl) return;

    sessionTimeout = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
            clearInterval(sessionTimeout);
            alert("세션이 만료되었습니다. 다시 로그인해주세요.");
            window.location.href = '/api/auth/logout';
            return;
        }
        
        const mins = Math.floor(remainingSeconds / 60);
        const secs = remainingSeconds % 60;
        timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        // 시각적 경고 (5분 미만 시 빨간색)
        if (remainingSeconds < 300) timerEl.classList.add('text-danger');
        else timerEl.classList.remove('text-danger');
    }, 1000);
}

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) { window.location.href = '/'; return; }
        const data = await res.json();
        currentUser = data.user;
        
        // UI Update
        const userNameEls = ['userName', 'headerUserName'];
        userNameEls.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = currentUser.name;
        });
        
        const avatarEl = document.getElementById('userAvatar');
        if (avatarEl) avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}`;
        
        loadUsage();
        startSessionTimer();
    } catch (err) {
        window.location.href = '/';
    }
}

// Global UI Section Control
function copyText(elementId) {
    const text = document.getElementById(elementId)?.innerText;
    if (!text) return;

    const btn = event?.currentTarget || document.querySelector(`button[onclick*="${elementId}"]`);
    
    navigator.clipboard.writeText(text).then(() => {
        if (btn) {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check me-1"></i> Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.classList.remove('copied');
            }, 2000);
        }
    }).catch(err => {
        console.error('Copy failed', err);
    });
}

function showSection(sectionId) {
    // Update Section Title in Header
    const navLink = document.querySelector(`#mainNav .nav-link[href="${Object.keys(routes).find(key => routes[key] === sectionId)}"]`);
    const titleEl = document.getElementById('sectionTitle');
    if (titleEl && navLink) {
        titleEl.textContent = navLink.querySelector('span').textContent;
    }

    // Stop automation refresh if moving away from automation section
    if (sectionId !== 'sectionAutomation' && typeof automationRefreshInterval !== 'undefined' && automationRefreshInterval) {
        clearInterval(automationRefreshInterval);
        automationRefreshInterval = null;
    }

    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.remove('active');
    });
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');

    if (sectionId === 'sectionReport' && !window.location.pathname.includes('/reports/')) {
        document.getElementById('step2Card').classList.add('hidden');
        document.getElementById('step3Card').classList.add('hidden');
        
        // Ensure main view is visible
        const mainRow = document.querySelector('#sectionReport > .row:first-child');
        if (mainRow) mainRow.classList.remove('hidden');
        
        const step1 = document.getElementById('step1Card');
        if (step1) step1.classList.remove('hidden');

        const historyCard = document.getElementById('reportHistoryCard');
        if (historyCard) historyCard.classList.remove('hidden');
        
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput) searchInput.value = '';
    }

    // Trigger functional module reloads
    if (sectionId === 'sectionDashboard') {
        if (typeof loadSiteHistory === 'function') loadSiteHistory();
        if (typeof loadDashboardStats === 'function') loadDashboardStats();
    }
    if (sectionId === 'sectionReport') {
        if (typeof loadReportHistory === 'function') loadReportHistory();
        if (typeof loadUsage === 'function') loadUsage();
    }
    if (sectionId === 'sectionAutomation') {
        if (typeof loadAutomationSettings === 'function') loadAutomationSettings();
    }
    if (sectionId === 'sectionOrg') {
        if (typeof loadTrash === 'function') loadTrash();
        if (typeof loadMembers === 'function') loadMembers();
    }

    // Update Nav Active State
    document.querySelectorAll('#mainNav .nav-link').forEach(link => {
        if (routes[link.getAttribute('href')] === sectionId) link.classList.add('active');
        else link.classList.remove('active');
    });

    // Hide Global Loader
    const loader = document.getElementById('globalLoader');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 500);
    }
}

// Global Usage / Plan Logic
async function loadUsage() {
    const orgParam = currentPublicId || currentOrgId;
    if (!orgParam) return;
    try {
        const res = await fetch(`/api/usage?organization_id=${orgParam}`);
        const data = await res.json();
        
        const remaining = Math.max(0, data.limit - data.used);
        const display = document.getElementById('remainingCount');
        const limitDisplay = document.getElementById('limitCount');
        const planDisplay = document.getElementById('planLabel');

        // New IDs for Report Section
        const rRemaining = document.getElementById('reportRemainingCount');
        const rLimit = document.getElementById('reportLimitCount');
        const rPlan = document.getElementById('reportPlanLabel');

        if (display) display.textContent = remaining;
        if (limitDisplay) limitDisplay.textContent = data.limit;
        if (rRemaining) rRemaining.textContent = remaining;
        if (rLimit) rLimit.textContent = data.limit;

        const planText = data.isBeta ? "BETA PRO" : data.plan.charAt(0).toUpperCase() + data.plan.slice(1);
        if (planDisplay) planDisplay.textContent = planText;
        if (rPlan) rPlan.textContent = planText;

        // Update Plan UI in Subscription tab        const planBadge = document.getElementById('currentPlanBadge');
        if (planBadge) {
            if (data.isBeta) {
                planBadge.innerHTML = "BETA (PRO 혜택 적용 중)";
                planBadge.className = "badge bg-warning text-dark";
            } else {
                planBadge.textContent = data.plan.toUpperCase();
                planBadge.className = "badge bg-primary";
            }
            
            document.querySelectorAll('.pricing-card').forEach(c => {
                c.classList.remove('border-primary', 'shadow');
                const btn = c.querySelector('button');
                if (btn && btn.textContent === "현재 플랜") {
                    btn.textContent = c.id === 'cardPlanFree' ? "이 플랜으로 변경 (Debug)" : "이 플랜으로 변경 (Debug)";
                }
            });

            const cardMap = { 'free': 'cardPlanFree', 'starter': 'cardPlanStarter', 'pro': 'cardPlanPro' };
            const activeCard = document.getElementById(cardMap[data.plan]);
            if (activeCard) {
                activeCard.classList.add('border-primary', 'shadow');
                const btn = activeCard.querySelector('button');
                if (btn) btn.textContent = "현재 적용 플랜";
            }
        }
    } catch (err) {}
}

async function debugSetPlan(plan) {
    const orgParam = currentPublicId || currentOrgId;
    if (!orgParam) return alert("조직을 먼저 선택해주세요.");
    try {
        const res = await fetch('/api/debug/set-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organization_id: orgParam, plan })
        });
        const data = await res.json();
        if (data.success) {
            alert(`플랜이 ${plan}으로 변경되었습니다. (Debug Mode)`);
            loadUsage();
        }
    } catch (err) {
        alert("플랜 변경 실패");
    }
}

// Global Initialization
document.addEventListener('DOMContentLoaded', async () => {
    if (getCookie('sidebar_collapsed') === 'true') {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('mainContent');
        if (sidebar) sidebar.classList.add('collapsed');
        if (mainContent) mainContent.classList.add('expanded');
    }

    try {
        await checkAuth();
        if (currentUser) {
            if (typeof loadOrganizations === 'function') await loadOrganizations();
            
            const savedOrgId = getCookie('active_org_id');
            if (savedOrgId) {
                const select = document.getElementById('orgSelect');
                if (select) {
                    const option = Array.from(select.options).find(opt => opt.value === savedOrgId);
                    if (option) {
                        select.value = savedOrgId;
                        currentOrgId = savedOrgId;
                        if (typeof triggerOrgSelection === 'function') {
                            triggerOrgSelection(savedOrgId, option.text, option.dataset.publicId);
                        }
                        
                        if (window.location.pathname === '/') {
                            navigateTo('/dashboard');
                            return;
                        }
                        loadUsage();
                    }
                }
            }
        }
    } catch (err) {
        console.error("Initialization failed", err);
    } finally {
        handleRouting();
    }
});
