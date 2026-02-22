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
        if (typeof loadExistingReportData === 'function') loadExistingReportData(siteId);
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

// Global UI Section Control
function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.add('hidden');
    });
    const target = document.getElementById(sectionId);
    if (target) target.classList.remove('hidden');

    if (sectionId === 'sectionReport' && !window.location.pathname.includes('/reports/')) {
        document.getElementById('step2Card').classList.remove('hidden');
        document.getElementById('step3Card').classList.add('hidden');
        const historyCard = document.querySelector('#sectionReport .card.mb-4');
        if (historyCard) historyCard.classList.remove('hidden');
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput) searchInput.value = '';
    }

    // Trigger functional module reloads
    if (sectionId === 'sectionDashboard') {
        if (typeof loadSiteHistory === 'function') loadSiteHistory();
        if (typeof initRevenueChart === 'function') initRevenueChart();
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
}

// Global Usage / Plan Logic
async function loadUsage() {
    if (!currentOrgId) return;
    try {
        const res = await fetch(`/api/usage?organization_id=${currentOrgId}`);
        const data = await res.json();
        
        const remaining = data.limit - data.used;
        const display = document.getElementById('remainingCount');
        const limitDisplay = document.getElementById('limitCount');
        const planDisplay = document.getElementById('planLabel');
        
        if (display) display.textContent = remaining;
        if (limitDisplay) limitDisplay.textContent = data.limit;
        if (planDisplay) planDisplay.textContent = data.plan.charAt(0).toUpperCase() + data.plan.slice(1);

        // Update Plan UI in Subscription tab
        const planBadge = document.getElementById('currentPlanBadge');
        if (planBadge) {
            planBadge.textContent = data.plan.toUpperCase();
            document.querySelectorAll('.pricing-card').forEach(c => c.classList.remove('border-primary', 'shadow'));
            const cardMap = { 'free': 'cardPlanFree', 'starter': 'cardPlanStarter', 'pro': 'cardPlanPro' };
            const activeCard = document.getElementById(cardMap[data.plan]);
            if (activeCard) {
                activeCard.classList.add('border-primary', 'shadow');
                const btn = activeCard.querySelector('button');
                if (btn) btn.textContent = "현재 플랜";
            }
        }
    } catch (err) {}
}

async function debugSetPlan(plan) {
    if (!currentOrgId) return alert("조직을 먼저 선택해주세요.");
    try {
        const res = await fetch('/api/debug/set-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organization_id: currentOrgId, plan })
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
