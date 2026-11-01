/**
 * TRACKING PARTY BOT — ALBION ONLINE PREMIUM DASHBOARD CLIENT
 * Dark fantasy gaming analytics client connected to real production database.
 */

(function () {
  'use strict';

  // Global State
  const state = {
    currentView: 'overview',
    overviewPeriod: 'week',
    weeklyOffset: 0,
    monthlyOffset: 0,
    leaderboardType: 'hosted',
    leaderboardPeriod: 'all',
    leaderboardPage: 1,
    leaderboardTotalPages: 1,
    leaderboardSearch: '',
    historyPage: 1,
    historyTotalPages: 1,
    historySearch: '',
    historyActivity: 'ALL',
    historyStatus: 'ALL',
    historyStartDate: '',
    historyEndDate: '',
    currentPartyDetailsId: null,
  };

  // DOM Elements
  const navLinks = document.querySelectorAll('.nav-item');
  const viewSections = document.querySelectorAll('.view-section');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navLinksContainer = document.getElementById('navLinks');
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const topbarCurrentView = document.getElementById('topbarCurrentView');

  // Modal Elements: Host Profile
  const hostModalOverlay = document.getElementById('hostModalOverlay');
  const hostModalBody = document.getElementById('hostModalBody');
  const modalCloseBtn = document.getElementById('modalCloseBtn');

  // Modal Elements: Party Details
  const partyDetailsModal = document.getElementById('partyDetailsModal');
  const partyModalBody = document.getElementById('partyModalBody');
  const partyModalCloseBtn = document.getElementById('partyModalCloseBtn');

  // Dropdown Wrappers
  const userProfileWrap = document.getElementById('userProfileWrap');
  const userProfileBtn = document.getElementById('userProfileBtn');
  const userProfileDropdown = document.getElementById('userProfileDropdown');
  const notificationWrap = document.getElementById('notificationWrap');
  const notificationBtn = document.getElementById('notificationBtn');
  const notificationDropdown = document.getElementById('notificationDropdown');

  // =========================================================================
  // REAL-TIME SYNCHRONIZATION (Server-Sent Events + Fallback Polling)
  // =========================================================================
  let eventSource = null;
  let sseReconnectTimer = null;
  let sseReconnectAttempts = 0;
  let fallbackPollTimer = null;
  const seenEventIds = new Set();

  function setupRealtimeSync() {
    if (typeof EventSource === 'undefined') {
      startPollingFallback();
      return;
    }
    connectSSE();
  }

  function connectSSE() {
    if (eventSource) {
      try {
        eventSource.close();
      } catch (e) {}
    }

    const sseUrl = '/api/realtime/stream';
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = function () {
      sseReconnectAttempts = 0;
      if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
      }
      stopPollingFallback();
      updateSyncStatusUI('online');
    };

    eventSource.onmessage = function (event) {
      try {
        if (!event.data) return;
        const payload = JSON.parse(event.data);

        // Handshake message
        if (payload.type === 'connected') {
          return;
        }

        // Deduplicate events safely
        if (payload.id) {
          if (seenEventIds.has(payload.id)) {
            return;
          }
          seenEventIds.add(payload.id);
          if (seenEventIds.size > 200) {
            const first = seenEventIds.values().next().value;
            seenEventIds.delete(first);
          }
        }

        handleRealtimeEvent(payload);
      } catch (err) {
        console.warn('Error handling realtime event:', err);
      }
    };

    eventSource.onerror = function () {
      updateSyncStatusUI('offline');
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }

      startPollingFallback();

      const delay = Math.min(30000, 1000 * Math.pow(2, sseReconnectAttempts));
      sseReconnectAttempts++;

      if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
      sseReconnectTimer = setTimeout(() => {
        connectSSE();
      }, delay);
    };
  }

  function handleRealtimeEvent(event) {
    const serverTimeCard = document.querySelector('.server-time-card');
    if (serverTimeCard) {
      serverTimeCard.classList.add('pulse-sync');
      setTimeout(() => serverTimeCard.classList.remove('pulse-sync'), 1200);
    }

    // Refresh active view without full page reload
    if (state.currentView === 'overview') {
      loadOverview();
    } else if (state.currentView === 'weekly') {
      loadWeekly(state.weeklyOffset);
    } else if (state.currentView === 'monthly') {
      loadMonthly(state.monthlyOffset);
    } else if (state.currentView === 'leaderboard') {
      loadLeaderboard(state.leaderboardType, state.leaderboardPeriod, state.leaderboardPage, state.leaderboardSearch);
    } else if (state.currentView === 'history') {
      loadHistory();
    }

    // If modal is open for this party, silently refresh its roster & details
    if (state.currentPartyDetailsId && event.partyId && state.currentPartyDetailsId === event.partyId) {
      silentRefreshPartyDetails(event.partyId);
    }

    // Update user context / unread notifications
    loadUserContext();
  }

  function updateSyncStatusUI(status) {
    const liveIndicator = document.getElementById('utcLiveIndicator');
    if (liveIndicator) {
      if (status === 'online') {
        liveIndicator.style.background = 'var(--color-gold-bright)';
        liveIndicator.title = 'Real-time Neon Event Stream Connected';
      } else {
        liveIndicator.style.background = '#e74c3c';
        liveIndicator.title = 'Real-time disconnected — using background polling fallback';
      }
    }
  }

  function startPollingFallback() {
    if (fallbackPollTimer) return;
    fallbackPollTimer = setInterval(() => {
      if (state.currentView === 'overview') {
        loadOverview();
      }
    }, 30000);
  }

  function stopPollingFallback() {
    if (fallbackPollTimer) {
      clearInterval(fallbackPollTimer);
      fallbackPollTimer = null;
    }
  }

  async function silentRefreshPartyDetails(partyId) {
    try {
      const res = await fetch(`/api/parties/${encodeURIComponent(partyId)}`);
      if (!res.ok) return;
      const party = await res.json();
      if (state.currentPartyDetailsId !== partyId) return;

      const titleEl = document.getElementById('partyModalTitle');
      if (titleEl) titleEl.textContent = party.title;

      const rolesContainer = partyModalBody?.querySelector('.party-roles-list');
      if (rolesContainer) {
        rolesContainer.innerHTML = party.roles
          .map(
            (role) => `
          <div class="party-role-card">
            <div class="party-role-header">
              <span class="party-role-name">#${role.roleNumber} — ${escapeHTML(role.roleName)}</span>
              <span class="party-role-capacity font-mono">${role.registeredCount} / ${role.capacity} ${role.isFull ? '• FULL' : ''}</span>
            </div>
            <div class="party-role-members">
              ${
                role.members.length === 0
                  ? '<div style="font-size: 0.75rem; color: var(--color-text-muted); font-style: italic;">No member registered for this role yet.</div>'
                  : role.members
                      .map(
                        (m) => `
                    <div class="party-member-row">
                      <img class="avatar-xs" src="${escapeHTML(m.avatarUrl)}" alt="Avatar">
                      <span style="font-weight: 600; color: var(--color-text-primary);">${escapeHTML(m.displayName)}</span>
                      <span style="font-size: 0.7rem; color: var(--color-text-muted); margin-left: auto;" class="font-mono">${escapeHTML(m.formattedDate)}</span>
                    </div>
                  `
                      )
                      .join('')
              }
            </div>
          </div>
        `
          )
          .join('');
      }
    } catch (e) {}
  }

  // =========================================================================
  // INITIALIZATION & ROUTING
  // =========================================================================
  function init() {
    setupNavigation();
    setupDropdowns();
    setupServerClock();
    setupOverviewControls();
    setupWeeklyControls();
    setupMonthlyControls();
    setupLeaderboardControls();
    setupHistoryControls();
    setupModals();
    setupAmbientParticles();
    setupRealtimeSync();

    // Fetch initial user & bot context
    loadUserContext();

    // Listen to hash and browser history navigation
    window.addEventListener('hashchange', handleRoute);
    window.addEventListener('popstate', handleRoute);

    // Initial route resolution
    handleRoute();
  }

  /**
   * Parses route from location.hash or location.pathname.
   * Supports: #overview, #weekly, #monthly, #leaderboard, #history, #hosts, #settings, #host/123
   */
  function parseCurrentRoute() {
    let raw = window.location.hash || '';

    if (raw.startsWith('#')) raw = raw.slice(1);
    if (raw.startsWith('/')) raw = raw.slice(1);

    if (raw.startsWith('host/')) {
      const parts = raw.split('/');
      return { type: 'host', userId: parts[1] || '' };
    }

    if (raw.includes('?')) raw = raw.split('?')[0];

    if (!raw) {
      let path = window.location.pathname || '';
      if (path.startsWith('/')) path = path.slice(1);
      const firstSegment = path.split('/')[0];
      if (['overview', 'weekly', 'monthly', 'leaderboard', 'history', 'hosts', 'settings'].includes(firstSegment)) {
        raw = firstSegment;
      }
    }

    const validViews = ['overview', 'weekly', 'monthly', 'leaderboard', 'history', 'hosts', 'settings'];
    const view = validViews.includes(raw) ? raw : 'overview';
    return { type: 'view', view };
  }

  function handleRoute() {
    const route = parseCurrentRoute();

    if (route.type === 'host' && route.userId) {
      switchView(state.currentView || 'overview', false);
      openHostProfile(route.userId);
      return;
    }

    switchView(route.view, true);
  }

  function switchView(targetView, shouldLoadData = true) {
    state.currentView = targetView;

    // Close any open modals
    if (hostModalOverlay && hostModalOverlay.classList.contains('active')) {
      hostModalOverlay.classList.remove('active');
    }
    if (partyDetailsModal && partyDetailsModal.classList.contains('active')) {
      partyDetailsModal.classList.remove('active');
    }

    // Update active nav item
    navLinks.forEach((link) => {
      if (link.dataset.view === targetView) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });

    // Toggle view sections
    viewSections.forEach((sec) => {
      if (sec.id === `view-${targetView}`) {
        sec.classList.add('active');
        sec.style.display = 'block';
      } else {
        sec.classList.remove('active');
        sec.style.display = 'none';
      }
    });

    // Update topbar breadcrumb title
    const viewLabels = {
      overview: 'Overview',
      weekly: 'Weekly Report',
      monthly: 'Monthly Report',
      leaderboard: 'Leaderboard',
      history: 'Party History',
      hosts: 'Hosts Directory',
      settings: 'Settings',
    };
    if (topbarCurrentView && viewLabels[targetView]) {
      topbarCurrentView.textContent = viewLabels[targetView];
    }

    // Close mobile drawers
    if (navLinksContainer) navLinksContainer.classList.remove('open');
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('open');

    // Scroll to top
    const viewport = document.querySelector('.app-viewport');
    if (viewport) viewport.scrollTo({ top: 0, behavior: 'auto' });
    window.scrollTo({ top: 0, behavior: 'auto' });

    // Load active view data
    if (shouldLoadData) {
      loadViewData(targetView);
    }
  }

  function loadViewData(view) {
    switch (view) {
      case 'overview':
        loadOverview();
        break;
      case 'weekly':
        loadWeeklyReport();
        break;
      case 'monthly':
        loadMonthlyReport();
        break;
      case 'leaderboard':
        loadLeaderboard();
        break;
      case 'history':
        loadHistory();
        break;
      case 'hosts':
        loadHostsView();
        break;
      case 'settings':
        loadSettingsView();
        break;
    }
  }

  // =========================================================================
  // NAVIGATION & DROPDOWNS
  // =========================================================================
  function setupNavigation() {
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sidebar) sidebar.classList.toggle('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.toggle('open');
        if (navLinksContainer) navLinksContainer.classList.toggle('open');
      });
    }

    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => {
        if (sidebar) sidebar.classList.remove('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('open');
        if (navLinksContainer) navLinksContainer.classList.remove('open');
      });
    }

    document.addEventListener('click', (e) => {
      if (sidebar && sidebar.classList.contains('open')) {
        if (!sidebar.contains(e.target) && e.target !== mobileMenuBtn) {
          sidebar.classList.remove('open');
          if (sidebarBackdrop) sidebarBackdrop.classList.remove('open');
        }
      }
    });

    navLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        if (view) {
          closeHostProfile(false);
          closePartyDetails();
          if (window.location.hash !== `#${view}`) {
            window.location.hash = `#${view}`;
          } else {
            switchView(view, true);
          }
        }
      });
    });

    const brand = document.querySelector('.brand');
    if (brand) {
      brand.addEventListener('click', (e) => {
        e.preventDefault();
        closeHostProfile(false);
        closePartyDetails();
        if (window.location.hash !== '#overview') {
          window.location.hash = '#overview';
        } else {
          switchView('overview', true);
        }
      });
    }

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      if (!link.classList.contains('nav-item') && !link.classList.contains('brand')) {
        link.addEventListener('click', (e) => {
          const href = link.getAttribute('href');
          if (href && href.startsWith('#')) {
            const view = href.replace(/^#\/?/, '').split('?')[0];
            if (['overview', 'weekly', 'monthly', 'leaderboard', 'history', 'hosts', 'settings'].includes(view)) {
              e.preventDefault();
              closeHostProfile(false);
              closePartyDetails();
              window.location.hash = `#${view}`;
            }
          }
        });
      }
    });
  }

  function setupDropdowns() {
    // User profile dropdown toggle
    if (userProfileBtn && userProfileDropdown) {
      userProfileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userProfileDropdown.classList.toggle('open');
        if (notificationDropdown) notificationDropdown.classList.remove('open');
      });
    }

    // Notification dropdown toggle
    if (notificationBtn && notificationDropdown) {
      notificationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notificationDropdown.classList.toggle('open');
        if (userProfileDropdown) userProfileDropdown.classList.remove('open');
      });
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (userProfileDropdown && !userProfileWrap?.contains(e.target)) {
        userProfileDropdown.classList.remove('open');
      }
      if (notificationDropdown && !notificationWrap?.contains(e.target)) {
        notificationDropdown.classList.remove('open');
      }
    });
  }

  function setupServerClock() {
    function updateClock() {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      const timeStr = `${h}:${m}:${s} UTC`;

      const sidebarClock = document.getElementById('sidebarServerTime');
      if (sidebarClock) sidebarClock.textContent = timeStr;
      const topbarClock = document.getElementById('topbarServerTime');
      if (topbarClock) topbarClock.textContent = timeStr;
    }
    setInterval(updateClock, 1000);
    updateClock();
  }

  async function loadUserContext() {
    try {
      const res = await fetch('/api/user-context');
      if (!res.ok) return;
      const user = await res.json();

      // Topbar user meta
      const avatarEl = document.getElementById('headerUserAvatar');
      const nameEl = document.getElementById('headerUserName');
      const roleEl = document.getElementById('headerUserRole');
      if (avatarEl && user.avatarUrl) avatarEl.src = user.avatarUrl;
      if (nameEl) nameEl.textContent = user.displayName || user.username;
      if (roleEl) roleEl.textContent = user.role || 'Raid Commander';

      // Dropdown user meta
      const dAvatar = document.getElementById('dropdownUserAvatar');
      const dName = document.getElementById('dropdownUserName');
      const dGuild = document.getElementById('dropdownUserGuild');
      const dId = document.getElementById('dropdownUserId');
      if (dAvatar && user.avatarUrl) dAvatar.src = user.avatarUrl;
      if (dName) dName.textContent = user.displayName || user.username;
      if (dGuild) dGuild.textContent = user.guildName || 'Albion Tracking Asia';
      if (dId) dId.textContent = user.userId;

      // Settings tab values
      const sGuild = document.getElementById('settingsGuildName');
      const sId = document.getElementById('settingsGuildId');
      const sBot = document.getElementById('settingsBotTag');
      if (sGuild) sGuild.textContent = user.guildName || 'Albion Tracking Asia';
      if (sId) sId.textContent = user.guildId || '1480556666117427334';
      if (sBot) sBot.textContent = `${user.username}`;
    } catch (err) {
      console.warn('Could not load user context:', err);
    }
  }

  // =========================================================================
  // 1. OVERVIEW DASHBOARD VIEW
  // =========================================================================
  function setupOverviewControls() {
    const periodButtons = document.querySelectorAll('#overviewPeriodSelector .btn-period');
    periodButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        periodButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.overviewPeriod = btn.dataset.period || 'week';
        loadOverview();
      });
    });
  }

  async function loadOverview() {
    try {
      const res = await fetch(`/api/analytics/overview?period=${state.overviewPeriod}`);
      if (!res.ok) throw new Error('Failed to load overview data');
      const data = await res.json();

      // Animate summary numbers
      animateCount('ov-total-parties', data.totalPartiesHosted);
      animateCount('ov-active-parties', data.activeParties);
      animateCount('ov-unique-hosts', data.totalUniqueHosts);
      const periodLbl = document.getElementById('ov-period-label');
      if (periodLbl) periodLbl.textContent = data.dateRange.label;

      // Top host card
      const hostCard = document.getElementById('ov-top-host-card');
      if (data.topHost) {
        document.getElementById('ov-top-host-avatar').src = data.topHost.avatarUrl;
        document.getElementById('ov-top-host-name').textContent = data.topHost.displayName;
        document.getElementById('ov-top-host-count').textContent = `${data.topHost.partyCount} parties hosted`;
        if (hostCard) {
          hostCard.onclick = () => openHostProfile(data.topHost.userId);
          hostCard.style.cursor = 'pointer';
        }
      } else {
        document.getElementById('ov-top-host-name').textContent = 'No party data available yet.';
        document.getElementById('ov-top-host-count').textContent = '—';
        if (hostCard) {
          hostCard.onclick = null;
          hostCard.style.cursor = 'default';
        }
      }

      // Render Party Activity Chart (Smooth spline with gradient)
      renderSplineChart('overviewChart', data.activityOverTime, 'count', 'label');

      // Render Party Types Circular Donut Chart
      if (data.partyTypes) {
        renderPartyTypesDonut(data.partyTypes);
      }

      // Render Top Hosts List
      renderOverviewTopHosts(data.topHosts);

      // Render Recent Parties
      renderOverviewRecentParties(data.recentParties);

      // Render Recent Activity Timeline
      if (data.recentActivity) {
        renderRecentActivity(data.recentActivity);
      }

      updateLastUpdated(data.lastUpdated);
    } catch (err) {
      console.error(err);
      document.getElementById('ov-total-parties').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('ov-active-parties').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('ov-unique-hosts').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('ov-top-host-name').innerHTML = '<span class="text-error">Failed to load data</span>';
      document.getElementById('ov-top-host-count').textContent = '—';
      renderChartError('overviewChart', 'Failed to load overview data from server.');
      const topHostsContainer = document.getElementById('ov-top-hosts-list');
      if (topHostsContainer) {
        topHostsContainer.innerHTML = '<div class="error-state-box">Failed to load leading hosts.</div>';
      }
      const tbody = document.getElementById('ov-recent-parties-tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="error-state-cell">Failed to load recent parties.</td></tr>';
      }
    }
  }

  function renderOverviewTopHosts(hosts) {
    const container = document.getElementById('ov-top-hosts-list');
    if (!container) return;

    if (!hosts || hosts.length === 0) {
      container.innerHTML = '<div class="empty-state-box">No party data available yet.</div>';
      return;
    }

    container.innerHTML = hosts
      .map(
        (h) => `
        <div class="ranking-item" onclick="window.location.hash='host/${h.userId}'" title="View ${escapeHTML(h.displayName)}'s profile">
          <div class="ranking-left">
            <span class="rank-badge rank-${h.rank}">${h.rank}</span>
            <img class="avatar-xs" src="${escapeHTML(h.avatarUrl)}" alt="Avatar" loading="lazy">
            <span class="ranking-name">${escapeHTML(h.displayName)}</span>
          </div>
          <span class="ranking-count font-mono">${h.partyCount} <span style="font-size: 0.72rem; color: var(--color-text-secondary); font-weight: normal;">runs</span></span>
        </div>
      `
      )
      .join('');
  }

  function renderOverviewRecentParties(parties) {
    const tbody = document.getElementById('ov-recent-parties-tbody');
    if (!tbody) return;

    if (!parties || parties.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state-cell">No party data available yet.</td></tr>';
      return;
    }

    tbody.innerHTML = parties
      .map(
        (p) => `
        <tr class="clickable-row" onclick="openPartyDetails('${p.id}')" title="Click to view full party details">
          <td class="cell-bold">${escapeHTML(p.title)}</td>
          <td>
            <div class="host-cell" onclick="event.stopPropagation(); window.location.hash='host/${p.organizerId}'" style="cursor: pointer;" title="View Host Profile">
              <img class="avatar-xs" src="${escapeHTML(p.host?.avatarUrl || '')}" alt="" loading="lazy">
              <span>${escapeHTML(p.host?.displayName || p.organizerId)}</span>
            </div>
          </td>
          <td><span class="badge ${p.activityType === 'AVA' ? 'badge-gold' : p.activityType === 'Outlands' ? 'badge-silver' : 'badge-gold'}">${escapeHTML(p.activityType)}</span></td>
          <td class="font-mono">${p.ipRequirement}+ IP</td>
          <td><span class="status-badge status-${p.status.toLowerCase()}">${p.status}</span></td>
          <td class="font-mono">${p.registeredCount} / ${p.totalSlots}</td>
          <td class="font-mono" style="font-size: 0.75rem;">${formatTimeAgo(new Date(p.createdAt))}</td>
        </tr>
      `
      )
      .join('');
  }

  function renderPartyTypesDonut(distribution) {
    const totalEl = document.getElementById('donutTotalCount');
    const avaEl = document.getElementById('donutCountAva');
    const outlandsEl = document.getElementById('donutCountOutlands');
    const bothEl = document.getElementById('donutCountBoth');

    if (totalEl) totalEl.textContent = distribution.total.toLocaleString();
    if (avaEl) avaEl.textContent = `${distribution.ava.count} (${distribution.ava.percent}%)`;
    if (outlandsEl) outlandsEl.textContent = `${distribution.outlands.count} (${distribution.outlands.percent}%)`;
    if (bothEl) bothEl.textContent = `${distribution.both.count} (${distribution.both.percent}%)`;

    // SVG Circle Circumference: 2 * PI * 58 ≈ 364.42
    const C = 364.42;
    const segAva = document.getElementById('donutSegmentAva');
    const segOutlands = document.getElementById('donutSegmentOutlands');
    const segBoth = document.getElementById('donutSegmentBoth');

    if (segAva && segOutlands && segBoth) {
      if (distribution.total === 0) {
        segAva.style.strokeDasharray = `0 ${C}`;
        segOutlands.style.strokeDasharray = `0 ${C}`;
        segBoth.style.strokeDasharray = `0 ${C}`;
        return;
      }

      const avaLen = (distribution.ava.percent / 100) * C;
      const outLen = (distribution.outlands.percent / 100) * C;
      const bothLen = (distribution.both.percent / 100) * C;

      segAva.style.strokeDasharray = `${avaLen} ${C}`;
      segAva.style.strokeDashoffset = '0';

      segOutlands.style.strokeDasharray = `${outLen} ${C}`;
      segOutlands.style.strokeDashoffset = `${-avaLen}`;

      segBoth.style.strokeDasharray = `${bothLen} ${C}`;
      segBoth.style.strokeDashoffset = `${-(avaLen + outLen)}`;
    }
  }

  function renderRecentActivity(events) {
    const container = document.getElementById('recentActivityList');
    const notifContainer = document.getElementById('notificationList');

    if (!events || events.length === 0) {
      if (container) container.innerHTML = '<div class="empty-state-box">No recent activity recorded.</div>';
      if (notifContainer) notifContainer.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--color-text-muted); font-size: 0.8rem;">No unread alerts.</div>';
      return;
    }

    const html = events
      .map((ev) => {
        let nodeClass = '';
        let iconSvg = '';
        if (ev.type === 'party_created') {
          iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
        } else if (ev.type === 'member_registered') {
          nodeClass = 'node-reg';
          iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>';
        } else {
          nodeClass = 'node-completed';
          iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        }

        return `
          <div class="timeline-item">
            <div class="timeline-icon-node ${nodeClass}">${iconSvg}</div>
            <div class="timeline-content">
              <div>
                <span class="timeline-user">${escapeHTML(ev.displayName)}</span>
                ${escapeHTML(ev.description)}:
                <a href="javascript:void(0)" onclick="openPartyDetails('${ev.partyId}')" class="timeline-party-link">${escapeHTML(ev.partyTitle)}</a>
              </div>
              <div class="timeline-time">${escapeHTML(ev.formattedTime)}</div>
            </div>
          </div>
        `;
      })
      .join('');

    if (container) container.innerHTML = html;

    // Also populate notifications dropdown
    if (notifContainer) {
      notifContainer.innerHTML = events
        .slice(0, 5)
        .map(
          (ev) => `
        <div class="notification-item" onclick="openPartyDetails('${ev.partyId}')">
          <img class="avatar-xs" src="${escapeHTML(ev.avatarUrl)}" alt="" style="margin-top: 2px;">
          <div class="notification-text">
            <strong>${escapeHTML(ev.displayName)}</strong> ${escapeHTML(ev.description)} in <em>${escapeHTML(ev.partyTitle)}</em>
            <div class="notification-time">${escapeHTML(ev.formattedTime)}</div>
          </div>
        </div>
      `
        )
        .join('');
    }
  }

  // =========================================================================
  // 2. WEEKLY REPORT VIEW
  // =========================================================================
  function setupWeeklyControls() {
    const prevBtn = document.getElementById('btn-prev-week');
    const nextBtn = document.getElementById('btn-next-week');
    const currBtn = document.getElementById('btn-current-week');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        state.weeklyOffset -= 1;
        loadWeeklyReport();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.weeklyOffset < 0) {
          state.weeklyOffset += 1;
          loadWeeklyReport();
        }
      });
    }
    if (currBtn) {
      currBtn.addEventListener('click', () => {
        state.weeklyOffset = 0;
        loadWeeklyReport();
      });
    }
  }

  async function loadWeeklyReport() {
    try {
      const res = await fetch(`/api/reports/weekly?offset=${state.weeklyOffset}`);
      if (!res.ok) throw new Error('Failed to load weekly report');
      const data = await res.json();

      document.getElementById('weekly-range-pill').textContent = data.weekRange.label;
      const nextBtn = document.getElementById('btn-next-week');
      if (nextBtn) nextBtn.disabled = state.weeklyOffset >= 0;

      animateCount('wk-total-parties', data.summary.totalParties);
      animateCount('wk-unique-hosts', data.summary.uniqueHosts);
      document.getElementById('wk-busiest-day').textContent = data.summary.busiestDay || '—';
      document.getElementById('wk-busiest-count').textContent = data.summary.busiestDayCount ? `${data.summary.busiestDayCount} runs` : 'No runs';

      // Comparison badge
      const diffElem = document.getElementById('wk-diff-badge');
      if (diffElem) {
        const diff = data.summary.diffPercentage;
        if (diff === null) {
          diffElem.innerHTML = `<span class="badge-diff-na">No previous week data</span> (${data.summary.prevWeekCount} runs)`;
        } else if (diff > 0) {
          diffElem.innerHTML = `<span class="badge-diff-pos">+${diff}%</span> vs last week (${data.summary.prevWeekCount} runs)`;
        } else if (diff < 0) {
          diffElem.innerHTML = `<span class="badge-diff-neg">${diff}%</span> vs last week (${data.summary.prevWeekCount} runs)`;
        } else {
          diffElem.innerHTML = `<span>0%</span> vs last week (${data.summary.prevWeekCount} runs)`;
        }
      }

      // Host of week
      if (data.summary.topHost) {
        document.getElementById('wk-top-host-avatar').src = data.summary.topHost.avatarUrl;
        document.getElementById('wk-top-host-name').textContent = data.summary.topHost.displayName;
        document.getElementById('wk-top-host-count').textContent = `${data.summary.topHost.partyCount} runs`;
      } else {
        document.getElementById('wk-top-host-name').textContent = 'No host data';
        document.getElementById('wk-top-host-count').textContent = '—';
      }

      // Most joined this week
      if (data.summary.topJoined) {
        document.getElementById('wk-top-joined-avatar').src = data.summary.topJoined.avatarUrl;
        document.getElementById('wk-top-joined-name').textContent = data.summary.topJoined.displayName;
        document.getElementById('wk-top-joined-count').textContent = `${data.summary.topJoined.joinedCount} joined`;
      } else {
        document.getElementById('wk-top-joined-name').textContent = 'No participant data';
        document.getElementById('wk-top-joined-count').textContent = '—';
      }

      renderBarChart('weeklyChart', data.dailyBreakdown, 'count', 'dayName', 'No parties hosted this week.');

      // Weekly host leaderboard
      const tbody = document.getElementById('wk-leaderboard-tbody');
      if (tbody) {
        if (!data.leaderboard || data.leaderboard.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-state-cell">No parties hosted this week.</td></tr>';
        } else {
          tbody.innerHTML = data.leaderboard
            .map(
              (h) => `
              <tr>
                <td><span class="rank-badge rank-${h.rank}">${h.rank}</span></td>
                <td>
                  <div class="host-cell">
                    <img class="avatar-xs" src="${escapeHTML(h.avatarUrl)}" alt="Avatar" loading="lazy">
                    <span class="cell-bold">${escapeHTML(h.displayName)}</span>
                  </div>
                </td>
                <td class="font-mono text-gold">${h.partyCount}</td>
                <td class="font-mono" style="font-size: 0.75rem;">${h.lastActive || '—'}</td>
                <td>
                  <button class="btn-view-profile" onclick="openHostProfile('${h.userId}')">Profile</button>
                </td>
              </tr>
            `
            )
            .join('');
        }
      }

      // Weekly joined leaderboard
      const joinedTbody = document.getElementById('wk-joined-leaderboard-tbody');
      if (joinedTbody) {
        if (!data.joinedLeaderboard || data.joinedLeaderboard.length === 0) {
          joinedTbody.innerHTML = '<tr><td colspan="6" class="empty-state-cell">No members joined parties this week.</td></tr>';
        } else {
          joinedTbody.innerHTML = data.joinedLeaderboard
            .map(
              (m) => `
              <tr>
                <td><span class="rank-badge rank-${m.rank}">${m.rank}</span></td>
                <td>
                  <div class="host-cell">
                    <img class="avatar-xs" src="${escapeHTML(m.avatarUrl)}" alt="Avatar" loading="lazy">
                    <span class="cell-bold">${escapeHTML(m.displayName)}</span>
                  </div>
                </td>
                <td class="font-mono text-gold">${m.joinedCount}</td>
                <td><span class="badge badge-gold">${escapeHTML(m.preferredRole || 'General')}</span></td>
                <td class="font-mono" style="font-size: 0.75rem;">${m.lastActive || '—'}</td>
                <td>
                  <button class="btn-view-profile" onclick="openHostProfile('${m.userId}')">Profile</button>
                </td>
              </tr>
            `
            )
            .join('');
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  // =========================================================================
  // 3. MONTHLY REPORT VIEW
  // =========================================================================
  function setupMonthlyControls() {
    const prevBtn = document.getElementById('btn-prev-month');
    const nextBtn = document.getElementById('btn-next-month');
    const currBtn = document.getElementById('btn-current-month');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        state.monthlyOffset -= 1;
        loadMonthlyReport();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.monthlyOffset < 0) {
          state.monthlyOffset += 1;
          loadMonthlyReport();
        }
      });
    }
    if (currBtn) {
      currBtn.addEventListener('click', () => {
        state.monthlyOffset = 0;
        loadMonthlyReport();
      });
    }
  }

  async function loadMonthlyReport() {
    try {
      const res = await fetch(`/api/reports/monthly?offset=${state.monthlyOffset}`);
      if (!res.ok) throw new Error('Failed to load monthly report');
      const data = await res.json();

      document.getElementById('monthly-range-pill').textContent = data.monthRange.label;
      const nextBtn = document.getElementById('btn-next-month');
      if (nextBtn) nextBtn.disabled = state.monthlyOffset >= 0;

      animateCount('mo-total-parties', data.summary.totalParties);
      animateCount('mo-unique-hosts', data.summary.uniqueHosts);
      document.getElementById('mo-busiest-day').textContent = data.summary.busiestDay || '—';
      document.getElementById('mo-busiest-day-count').textContent = data.summary.busiestDayCount ? `${data.summary.busiestDayCount} runs` : 'No runs';

      // Comparison badge
      const diffElem = document.getElementById('mo-diff-badge');
      if (diffElem) {
        const diff = data.summary.diffPercentage;
        if (diff === null) {
          diffElem.innerHTML = `<span class="badge-diff-na">No previous month data</span> (${data.summary.prevMonthCount} runs)`;
        } else if (diff > 0) {
          diffElem.innerHTML = `<span class="badge-diff-pos">+${diff}%</span> vs last month (${data.summary.prevMonthCount} runs)`;
        } else if (diff < 0) {
          diffElem.innerHTML = `<span class="badge-diff-neg">${diff}%</span> vs last month (${data.summary.prevMonthCount} runs)`;
        } else {
          diffElem.innerHTML = `<span>0%</span> vs last month (${data.summary.prevMonthCount} runs)`;
        }
      }

      if (data.summary.topHost) {
        document.getElementById('mo-top-host-avatar').src = data.summary.topHost.avatarUrl;
        document.getElementById('mo-top-host-name').textContent = data.summary.topHost.displayName;
        document.getElementById('mo-top-host-count').textContent = `${data.summary.topHost.partyCount} runs`;
      } else {
        document.getElementById('mo-top-host-name').textContent = 'No host data';
        document.getElementById('mo-top-host-count').textContent = '—';
      }

      if (data.summary.topJoined) {
        document.getElementById('mo-top-joined-avatar').src = data.summary.topJoined.avatarUrl;
        document.getElementById('mo-top-joined-name').textContent = data.summary.topJoined.displayName;
        document.getElementById('mo-top-joined-count').textContent = `${data.summary.topJoined.joinedCount} joined`;
      } else {
        document.getElementById('mo-top-joined-name').textContent = 'No participant data';
        document.getElementById('mo-top-joined-count').textContent = '—';
      }

      renderBarChart('monthlyChart', data.dailyBreakdown, 'count', 'dayNumber', 'No parties hosted this month.');

      const tbody = document.getElementById('mo-leaderboard-tbody');
      if (tbody) {
        if (!data.leaderboard || data.leaderboard.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-state-cell">No parties hosted this month.</td></tr>';
        } else {
          tbody.innerHTML = data.leaderboard
            .map(
              (h) => `
              <tr>
                <td><span class="rank-badge rank-${h.rank}">${h.rank}</span></td>
                <td>
                  <div class="host-cell">
                    <img class="avatar-xs" src="${escapeHTML(h.avatarUrl)}" alt="Avatar" loading="lazy">
                    <span class="cell-bold">${escapeHTML(h.displayName)}</span>
                  </div>
                </td>
                <td class="font-mono text-gold">${h.partyCount}</td>
                <td class="font-mono" style="font-size: 0.75rem;">${h.lastActive || '—'}</td>
                <td>
                  <button class="btn-view-profile" onclick="openHostProfile('${h.userId}')">Profile</button>
                </td>
              </tr>
            `
            )
            .join('');
        }
      }

      const joinedTbody = document.getElementById('mo-joined-leaderboard-tbody');
      if (joinedTbody) {
        if (!data.joinedLeaderboard || data.joinedLeaderboard.length === 0) {
          joinedTbody.innerHTML = '<tr><td colspan="6" class="empty-state-cell">No members joined parties this month.</td></tr>';
        } else {
          joinedTbody.innerHTML = data.joinedLeaderboard
            .map(
              (m) => `
              <tr>
                <td><span class="rank-badge rank-${m.rank}">${m.rank}</span></td>
                <td>
                  <div class="host-cell">
                    <img class="avatar-xs" src="${escapeHTML(m.avatarUrl)}" alt="Avatar" loading="lazy">
                    <span class="cell-bold">${escapeHTML(m.displayName)}</span>
                  </div>
                </td>
                <td class="font-mono text-gold">${m.joinedCount}</td>
                <td><span class="badge badge-gold">${escapeHTML(m.preferredRole || 'General')}</span></td>
                <td class="font-mono" style="font-size: 0.75rem;">${m.lastActive || '—'}</td>
                <td>
                  <button class="btn-view-profile" onclick="openHostProfile('${m.userId}')">Profile</button>
                </td>
              </tr>
            `
            )
            .join('');
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  // =========================================================================
  // 4. LEADERBOARD VIEW
  // =========================================================================
  function setupLeaderboardControls() {
    const typeButtons = document.querySelectorAll('#leaderboardTypeSelector .btn-period');
    typeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        typeButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.leaderboardType = btn.dataset.type || 'hosted';
        state.leaderboardPage = 1;
        loadLeaderboard();
      });
    });

    const periodButtons = document.querySelectorAll('#leaderboardPeriodSelector .btn-period');
    periodButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        periodButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.leaderboardPeriod = btn.dataset.period || 'all';
        state.leaderboardPage = 1;
        loadLeaderboard();
      });
    });

    const searchInput = document.getElementById('leaderboardSearchInput');
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.leaderboardSearch = e.target.value.trim();
          state.leaderboardPage = 1;
          loadLeaderboard();
        }, 300);
      });
    }

    const prevBtn = document.getElementById('lb-prev-btn');
    const nextBtn = document.getElementById('lb-next-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.leaderboardPage > 1) {
          state.leaderboardPage -= 1;
          loadLeaderboard();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.leaderboardPage < state.leaderboardTotalPages) {
          state.leaderboardPage += 1;
          loadLeaderboard();
        }
      });
    }

    const exportBtn = document.getElementById('btn-export-leaderboard');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        window.location.href = `/api/export/leaderboard.csv?period=${state.leaderboardPeriod}&type=${state.leaderboardType}`;
      });
    }
  }

  async function loadLeaderboard() {
    try {
      const isJoined = state.leaderboardType === 'joined';
      const colName = document.getElementById('lb-col-name');
      const colCount = document.getElementById('lb-col-count');
      if (colName) colName.textContent = isJoined ? 'MEMBER' : 'HOST';
      if (colCount) colCount.textContent = isJoined ? 'PARTIES JOINED' : 'PARTIES HOSTED';

      const query = new URLSearchParams({
        period: state.leaderboardPeriod,
        type: state.leaderboardType,
        page: String(state.leaderboardPage),
        limit: '20',
      });
      if (state.leaderboardSearch) query.set('search', state.leaderboardSearch);

      const res = await fetch(`/api/leaderboard?${query.toString()}`);
      if (!res.ok) throw new Error('Failed to load leaderboard');
      const data = await res.json();

      state.leaderboardPage = data.pagination.page;
      state.leaderboardTotalPages = data.pagination.totalPages;

      const pageInfo = document.getElementById('lb-page-info');
      if (pageInfo) pageInfo.textContent = `Page ${data.pagination.page} of ${Math.max(1, data.pagination.totalPages)}`;
      const prevBtn = document.getElementById('lb-prev-btn');
      const nextBtn = document.getElementById('lb-next-btn');
      if (prevBtn) prevBtn.disabled = data.pagination.page <= 1;
      if (nextBtn) nextBtn.disabled = data.pagination.page >= data.pagination.totalPages;

      const tbody = document.getElementById('lb-tbody');
      if (!tbody) return;

      const list = isJoined ? data.members : data.hosts;
      if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state-cell">${isJoined ? 'No members to rank yet.' : 'No hosts to rank yet.'}</td></tr>`;
        return;
      }

      tbody.innerHTML = list
        .map(
          (m) => `
          <tr>
            <td><span class="rank-badge rank-${m.rank}">${m.rank}</span></td>
            <td>
              <div class="host-cell">
                <img class="avatar-xs" src="${escapeHTML(m.avatarUrl)}" alt="Avatar" loading="lazy">
                <span class="cell-bold">${escapeHTML(m.displayName)}</span>
              </div>
            </td>
            <td class="font-mono" style="font-size: 0.75rem; color: var(--color-text-muted);">${m.userId}</td>
            <td class="font-mono text-gold">${isJoined ? m.joinedCount : m.partyCount}</td>
            <td class="font-mono" style="font-size: 0.75rem;">${m.lastActive || '—'}</td>
            <td>
              <button class="btn-view-profile" onclick="openHostProfile('${m.userId}')">View Profile</button>
            </td>
          </tr>
        `
        )
        .join('');
    } catch (err) {
      console.error(err);
    }
  }

  // =========================================================================
  // 5. PARTY HISTORY VIEW
  // =========================================================================
  function setupHistoryControls() {
    const searchInput = document.getElementById('hist-search-input');
    const actSelect = document.getElementById('hist-activity-select');
    const statSelect = document.getElementById('hist-status-select');
    const startInput = document.getElementById('hist-start-date');
    const endInput = document.getElementById('hist-end-date');
    const resetBtn = document.getElementById('hist-reset-btn');
    const prevBtn = document.getElementById('hist-prev-btn');
    const nextBtn = document.getElementById('hist-next-btn');
    const exportBtn = document.getElementById('btn-export-parties');

    let debounceTimer;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.historySearch = e.target.value.trim();
          state.historyPage = 1;
          loadHistory();
        }, 300);
      });
    }

    if (actSelect) {
      actSelect.addEventListener('change', (e) => {
        state.historyActivity = e.target.value;
        state.historyPage = 1;
        loadHistory();
      });
    }

    if (statSelect) {
      statSelect.addEventListener('change', (e) => {
        state.historyStatus = e.target.value;
        state.historyPage = 1;
        loadHistory();
      });
    }

    if (startInput) {
      startInput.addEventListener('change', (e) => {
        state.historyStartDate = e.target.value;
        state.historyPage = 1;
        loadHistory();
      });
    }

    if (endInput) {
      endInput.addEventListener('change', (e) => {
        state.historyEndDate = e.target.value;
        state.historyPage = 1;
        loadHistory();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.historySearch = '';
        state.historyActivity = 'ALL';
        state.historyStatus = 'ALL';
        state.historyStartDate = '';
        state.historyEndDate = '';
        state.historyPage = 1;
        if (searchInput) searchInput.value = '';
        if (actSelect) actSelect.value = 'ALL';
        if (statSelect) statSelect.value = 'ALL';
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        loadHistory();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.historyPage > 1) {
          state.historyPage -= 1;
          loadHistory();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.historyPage < state.historyTotalPages) {
          state.historyPage += 1;
          loadHistory();
        }
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const query = new URLSearchParams();
        if (state.historyActivity !== 'ALL') query.set('activity', state.historyActivity);
        if (state.historyStatus !== 'ALL') query.set('status', state.historyStatus);
        window.location.href = `/api/export/parties.csv?${query.toString()}`;
      });
    }
  }

  async function loadHistory() {
    try {
      const query = new URLSearchParams({
        page: String(state.historyPage),
        limit: '20',
      });
      if (state.historySearch) query.set('search', state.historySearch);
      if (state.historyActivity !== 'ALL') query.set('activity', state.historyActivity);
      if (state.historyStatus !== 'ALL') query.set('status', state.historyStatus);
      if (state.historyStartDate) query.set('startDate', state.historyStartDate);
      if (state.historyEndDate) query.set('endDate', state.historyEndDate);

      const res = await fetch(`/api/parties?${query.toString()}`);
      if (!res.ok) throw new Error('Failed to load party history');
      const data = await res.json();

      state.historyPage = data.pagination.page;
      state.historyTotalPages = data.pagination.totalPages;

      const pageInfo = document.getElementById('hist-page-info');
      if (pageInfo) pageInfo.textContent = `Page ${data.pagination.page} of ${Math.max(1, data.pagination.totalPages)}`;
      const prevBtn = document.getElementById('hist-prev-btn');
      const nextBtn = document.getElementById('hist-next-btn');
      if (prevBtn) prevBtn.disabled = data.pagination.page <= 1;
      if (nextBtn) nextBtn.disabled = data.pagination.page >= data.pagination.totalPages;

      const tbody = document.getElementById('hist-tbody');
      if (!tbody) return;

      if (!data.parties || data.parties.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state-cell">No parties found.</td></tr>';
        return;
      }

      tbody.innerHTML = data.parties
        .map(
          (p) => `
          <tr class="clickable-row" onclick="openPartyDetails('${p.id}')">
            <td class="cell-bold">${escapeHTML(p.title)}</td>
            <td>
              <div class="host-cell" onclick="event.stopPropagation(); window.location.hash='host/${p.organizerId}'" style="cursor: pointer;">
                <img class="avatar-xs" src="${escapeHTML(p.host?.avatarUrl || '')}" alt="" loading="lazy">
                <span>${escapeHTML(p.host?.displayName || p.organizerId)}</span>
              </div>
            </td>
            <td><span class="badge ${p.activityType === 'AVA' ? 'badge-gold' : p.activityType === 'Outlands' ? 'badge-silver' : 'badge-gold'}">${escapeHTML(p.activityType)}</span></td>
            <td class="font-mono">${p.ipRequirement}+ IP</td>
            <td class="font-mono">${p.durationMinutes}m</td>
            <td class="font-mono">${p.registeredCount} / ${p.totalSlots}</td>
            <td><span class="status-badge status-${p.status.toLowerCase()}">${p.status}</span></td>
            <td class="font-mono" style="font-size: 0.75rem;">${p.formattedDate}</td>
          </tr>
        `
        )
        .join('');
    } catch (err) {
      console.error(err);
    }
  }

  // =========================================================================
  // 6. HOSTS VIEW & SETTINGS VIEW
  // =========================================================================
  async function loadHostsView() {
    try {
      const tbody = document.getElementById('hosts-view-tbody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--color-text-muted);">Loading hosts directory...</td></tr>';

      const res = await fetch('/api/leaderboard?type=hosted&period=all&limit=50');
      if (!res.ok) throw new Error('Failed to load hosts');
      const data = await res.json();

      if (!data.hosts || data.hosts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state-cell">No hosts registered yet.</td></tr>';
        return;
      }

      tbody.innerHTML = data.hosts
        .map(
          (h) => `
        <tr>
          <td><span class="rank-badge rank-${h.rank}">${h.rank}</span></td>
          <td>
            <div class="host-cell">
              <img class="avatar-xs" src="${escapeHTML(h.avatarUrl)}" alt="Avatar" loading="lazy">
              <span class="cell-bold">${escapeHTML(h.displayName)}</span>
            </div>
          </td>
          <td class="font-mono" style="font-size: 0.75rem; color: var(--color-text-muted);">${h.userId}</td>
          <td class="font-mono text-gold">${h.partyCount}</td>
          <td class="font-mono" style="font-size: 0.75rem;">${h.lastActive || '—'}</td>
          <td>
            <button class="btn-view-profile" onclick="openHostProfile('${h.userId}')">View Profile</button>
          </td>
        </tr>
      `
        )
        .join('');
    } catch (err) {
      console.error(err);
    }
  }

  function loadSettingsView() {
    loadUserContext();
  }

  // =========================================================================
  // 7. MODALS (HOST PROFILE & PARTY DETAILS)
  // =========================================================================
  function setupModals() {
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', () => closeHostProfile(true));
    }
    if (hostModalOverlay) {
      hostModalOverlay.addEventListener('click', (e) => {
        if (e.target === hostModalOverlay) closeHostProfile(true);
      });
    }

    if (partyModalCloseBtn) {
      partyModalCloseBtn.addEventListener('click', closePartyDetails);
    }
    if (partyDetailsModal) {
      partyDetailsModal.addEventListener('click', (e) => {
        if (e.target === partyDetailsModal) closePartyDetails();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (hostModalOverlay && hostModalOverlay.classList.contains('active')) closeHostProfile(true);
        if (partyDetailsModal && partyDetailsModal.classList.contains('active')) closePartyDetails();
      }
    });
  }

  window.openHostProfile = async function (userId) {
    if (!hostModalOverlay || !hostModalBody) return;
    hostModalOverlay.classList.add('active');
    hostModalBody.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--color-text-muted);">Loading host profile...</div>';

    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(userId)}`);
      if (!res.ok) throw new Error('Could not fetch host profile');
      const data = await res.json();
      const host = data.host;
      const stats = data.stats;

      hostModalBody.innerHTML = `
        <div class="profile-header-card">
          <img class="avatar-lg" src="${escapeHTML(host.avatarUrl)}" alt="Avatar">
          <div>
            <div class="profile-username">${escapeHTML(host.displayName)}</div>
            <div class="profile-id">@${escapeHTML(host.username)} · ID: ${host.userId}</div>
          </div>
        </div>

        <div class="profile-stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));">
          <div class="profile-stat-box">
            <div class="profile-stat-num">${stats.allTimeParties}</div>
            <div class="profile-stat-lbl">Hosted (Total)</div>
          </div>
          <div class="profile-stat-box">
            <div class="profile-stat-num">${stats.currentWeekParties}</div>
            <div class="profile-stat-lbl">Hosted (This Wk)</div>
          </div>
          <div class="profile-stat-box">
            <div class="profile-stat-num">${stats.allTimeJoined || 0}</div>
            <div class="profile-stat-lbl">Joined (Total)</div>
          </div>
          <div class="profile-stat-box">
            <div class="profile-stat-num">${stats.currentWeekJoined || 0}</div>
            <div class="profile-stat-lbl">Joined (This Wk)</div>
          </div>
        </div>

        <h3 style="font-size: 0.92rem; font-weight: 700; margin-top: 1.25rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">Recent Hosted Parties</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>PARTY NAME</th>
                <th>ACTIVITY</th>
                <th>REQ IP</th>
                <th>STATUS</th>
                <th>DATE</th>
              </tr>
            </thead>
            <tbody>
              ${
                data.recentParties.length === 0
                  ? '<tr><td colspan="5" class="empty-state-cell">No recent parties hosted.</td></tr>'
                  : data.recentParties
                      .map(
                        (p) => `
                    <tr class="clickable-row" onclick="openPartyDetails('${p.id}')">
                      <td class="cell-bold">${escapeHTML(p.title)}</td>
                      <td><span class="badge badge-silver">${escapeHTML(p.activityType)}</span></td>
                      <td class="font-mono">${p.ipRequirement}+ IP</td>
                      <td><span class="status-badge status-${p.status.toLowerCase()}">${p.status}</span></td>
                      <td class="font-mono" style="font-size: 0.75rem;">${p.formattedDate}</td>
                    </tr>
                  `
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>

        ${
          data.recentJoined && data.recentJoined.length > 0
            ? `
        <h3 style="font-size: 0.92rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">Recent Joined Parties</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>PARTY NAME</th>
                <th>ACTIVITY</th>
                <th>ROLE</th>
                <th>STATUS</th>
                <th>DATE</th>
              </tr>
            </thead>
            <tbody>
              ${data.recentJoined
                .map(
                  (r) => `
                <tr class="clickable-row" onclick="openPartyDetails('${r.partyId}')">
                  <td class="cell-bold">${escapeHTML(r.partyTitle)}</td>
                  <td><span class="badge badge-silver">${escapeHTML(r.activityType)}</span></td>
                  <td><span class="badge badge-gold">${escapeHTML(r.roleName)} (#${r.roleNumber})</span></td>
                  <td><span class="status-badge status-${(r.status || 'open').toLowerCase()}">${r.status || 'OPEN'}</span></td>
                  <td class="font-mono" style="font-size: 0.75rem;">${r.formattedDate}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
        `
            : ''
        }
      `;
    } catch (err) {
      hostModalBody.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--color-crimson);">Failed to load profile for host ${escapeHTML(userId)}.</div>`;
    }
  };

  function closeHostProfile(updateHash = true) {
    if (hostModalOverlay) hostModalOverlay.classList.remove('active');
    if (updateHash && window.location.hash.includes('host/')) {
      window.location.hash = `#${state.currentView || 'overview'}`;
    }
  }

  window.openPartyDetails = async function (partyId) {
    if (!partyDetailsModal || !partyModalBody) return;
    state.currentPartyDetailsId = partyId;
    partyDetailsModal.classList.add('active');
    partyModalBody.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--color-text-muted);">Loading expedition details...</div>';

    try {
      const res = await fetch(`/api/parties/${encodeURIComponent(partyId)}`);
      if (!res.ok) throw new Error('Could not fetch party details');
      const party = await res.json();

      document.getElementById('partyModalTitle').textContent = party.title;
      document.getElementById('partyModalSubtitle').textContent = `${party.activityType} Expedition · Hosted by ${party.host.displayName}`;

      partyModalBody.innerHTML = `
        <div class="party-modal-details-grid">
          <div class="party-modal-detail-box">
            <div class="party-detail-label">Status</div>
            <div class="party-detail-val"><span class="status-badge status-${party.status.toLowerCase()}">${party.status}</span></div>
          </div>
          <div class="party-modal-detail-box">
            <div class="party-detail-label">Activity</div>
            <div class="party-detail-val text-gold">${escapeHTML(party.activityType)}</div>
          </div>
          <div class="party-modal-detail-box">
            <div class="party-detail-label">Min IP</div>
            <div class="party-detail-val font-mono">${party.ipRequirement}+ IP</div>
          </div>
          <div class="party-modal-detail-box">
            <div class="party-detail-label">Duration</div>
            <div class="party-detail-val font-mono">${party.durationMinutes} mins</div>
          </div>
          <div class="party-modal-detail-box">
            <div class="party-detail-label">Side Tracking</div>
            <div class="party-detail-val">${escapeHTML(party.sideTracking)}</div>
          </div>
          <div class="party-modal-detail-box">
            <div class="party-detail-label">Toolkit Req</div>
            <div class="party-detail-val font-mono">T${party.minimumTrackingToolkit}+</div>
          </div>
        </div>

        <h3 style="font-size: 0.9rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--color-text-primary);">Roster &amp; Role Allocations (${party.totalRegistered}/${party.totalCapacity})</h3>
        <div class="party-roles-list">
          ${party.roles
            .map(
              (role) => `
            <div class="party-role-card">
              <div class="party-role-header">
                <span class="party-role-name">#${role.roleNumber} — ${escapeHTML(role.roleName)}</span>
                <span class="party-role-capacity font-mono">${role.registeredCount} / ${role.capacity} ${role.isFull ? '• FULL' : ''}</span>
              </div>
              <div class="party-role-members">
                ${
                  role.members.length === 0
                    ? '<div style="font-size: 0.75rem; color: var(--color-text-muted); font-style: italic;">No member registered for this role yet.</div>'
                    : role.members
                        .map(
                          (m) => `
                      <div class="party-member-row">
                        <img class="avatar-xs" src="${escapeHTML(m.avatarUrl)}" alt="Avatar">
                        <span style="font-weight: 600; color: var(--color-text-primary);">${escapeHTML(m.displayName)}</span>
                        <span style="font-size: 0.7rem; color: var(--color-text-muted); margin-left: auto;" class="font-mono">${escapeHTML(m.formattedDate)}</span>
                      </div>
                    `
                        )
                        .join('')
                }
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    } catch (err) {
      partyModalBody.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--color-crimson);">Failed to load party details.</div>';
    }
  };

  function closePartyDetails() {
    state.currentPartyDetailsId = null;
    if (partyDetailsModal) partyDetailsModal.classList.remove('active');
  }

  // =========================================================================
  // 8. CHART RENDERERS & ANIMATIONS
  // =========================================================================
  function renderSplineChart(svgId, data, valKey, labelKey) {
    const svg = document.getElementById(svgId);
    if (!svg || !svg.parentElement) return;
    const container = svg.parentElement;
    const tooltip = document.getElementById('chartTooltip');

    const values = (data || []).map((d) => d[valKey] || 0);
    const hasData = values.some((v) => v > 0);

    if (!hasData) {
      renderBarChart(svgId, data, valKey, labelKey, 'No party data available yet.');
      return;
    }

    svg.style.display = 'block';
    const width = 600;
    const height = 200;
    const pad = { top: 25, right: 25, bottom: 35, left: 35 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const maxVal = Math.max(...values, 4);

    const stepX = chartW / Math.max(1, data.length - 1);
    const points = data.map((d, i) => {
      const x = pad.left + i * stepX;
      const y = pad.top + chartH - ((d[valKey] || 0) / maxVal) * chartH;
      return { x, y, val: d[valKey] || 0, label: d[labelKey] || d.date };
    });

    // Generate Path Data
    const pathD = points.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');
    const areaD = `${pathD} L ${points[points.length - 1].x} ${pad.top + chartH} L ${points[0].x} ${pad.top + chartH} Z`;

    let html = `
      <defs>
        <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#d4af37" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#d4af37" stop-opacity="0" />
        </linearGradient>
      </defs>
      <!-- Gridlines -->
      <line x1="${pad.left}" y1="${pad.top}" x2="${width - pad.right}" y2="${pad.top}" class="chart-grid-line" />
      <line x1="${pad.left}" y1="${pad.top + chartH / 2}" x2="${width - pad.right}" y2="${pad.top + chartH / 2}" class="chart-grid-line" />
      <line x1="${pad.left}" y1="${pad.top + chartH}" x2="${width - pad.right}" y2="${pad.top + chartH}" class="chart-grid-line" />

      <!-- Y Axis -->
      <text x="${pad.left - 8}" y="${pad.top + 4}" text-anchor="end" class="chart-axis-text font-mono">${maxVal}</text>
      <text x="${pad.left - 8}" y="${pad.top + chartH / 2 + 4}" text-anchor="end" class="chart-axis-text font-mono">${Math.round(maxVal / 2)}</text>
      <text x="${pad.left - 8}" y="${pad.top + chartH + 4}" text-anchor="end" class="chart-axis-text font-mono">0</text>

      <!-- Fill Area & Line -->
      <path d="${areaD}" class="chart-area" />
      <path d="${pathD}" class="chart-line" />
    `;

    points.forEach((p, idx) => {
      html += `<circle cx="${p.x}" cy="${p.y}" r="3.5" class="chart-dot" data-val="${p.val}" data-label="${escapeHTML(String(p.label))}" />`;
      if (data.length <= 14 || idx % Math.ceil(data.length / 8) === 0) {
        html += `<text x="${p.x}" y="${height - 10}" text-anchor="middle" class="chart-axis-text font-mono">${escapeHTML(String(p.label))}</text>`;
      }
    });

    svg.innerHTML = html;

    // Attach interactive hover tooltips
    if (tooltip) {
      svg.querySelectorAll('.chart-dot').forEach((dot) => {
        dot.addEventListener('mouseenter', (e) => {
          const val = dot.getAttribute('data-val');
          const label = dot.getAttribute('data-label');
          tooltip.textContent = `${label}: ${val} runs`;
          tooltip.style.display = 'block';

          const rect = container.getBoundingClientRect();
          const dotX = parseFloat(dot.getAttribute('cx'));
          const dotY = parseFloat(dot.getAttribute('cy'));
          tooltip.style.left = `${dotX}px`;
          tooltip.style.top = `${dotY - 28}px`;
        });
        dot.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    }
  }

  function renderBarChart(svgId, data, valKey, labelKey, emptyMessage) {
    const svg = document.getElementById(svgId);
    if (!svg || !svg.parentElement) return;
    const container = svg.parentElement;

    const values = (data || []).map((d) => d[valKey] || 0);
    const hasData = values.some((v) => v > 0);

    if (!hasData && emptyMessage) {
      svg.style.display = 'none';
      let emptyBox = container.querySelector('.empty-state-box');
      if (!emptyBox) {
        emptyBox = document.createElement('div');
        emptyBox.className = 'empty-state-box';
        container.appendChild(emptyBox);
      }
      emptyBox.textContent = emptyMessage;
      emptyBox.style.display = 'flex';
      return;
    }

    svg.style.display = 'block';
    const existingEmpty = container.querySelector('.empty-state-box');
    if (existingEmpty) existingEmpty.style.display = 'none';

    if (!data || data.length === 0) return;

    const width = 600;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 35, left: 35 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const maxVal = Math.max(...values, 4);

    const barWidth = Math.max(4, Math.min(26, (chartW / data.length) * 0.7));
    const stepX = chartW / data.length;

    let elements = `
      <line x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" class="chart-grid-line" />
      <line x1="${padding.left}" y1="${padding.top + chartH / 2}" x2="${width - padding.right}" y2="${padding.top + chartH / 2}" class="chart-grid-line" />
      <line x1="${padding.left}" y1="${padding.top + chartH}" x2="${width - padding.right}" y2="${padding.top + chartH}" class="chart-grid-line" />

      <text x="${padding.left - 8}" y="${padding.top + 4}" text-anchor="end" class="chart-axis-text">${maxVal}</text>
      <text x="${padding.left - 8}" y="${padding.top + chartH / 2 + 4}" text-anchor="end" class="chart-axis-text">${Math.round(maxVal / 2)}</text>
      <text x="${padding.left - 8}" y="${padding.top + chartH + 4}" text-anchor="end" class="chart-axis-text">0</text>
    `;

    data.forEach((d, idx) => {
      const val = d[valKey] || 0;
      const barH = (val / maxVal) * chartH;
      const x = padding.left + idx * stepX + (stepX - barWidth) / 2;
      const y = padding.top + chartH - barH;

      elements += `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="2" class="chart-bar">
          <title>${d[labelKey] || d.date}: ${val} runs</title>
        </rect>
      `;

      const showLabel = data.length <= 14 || idx % Math.ceil(data.length / 10) === 0;
      if (showLabel) {
        elements += `
          <text x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" class="chart-axis-text">
            ${escapeHTML(String(d[labelKey]))}
          </text>
        `;
      }
    });

    svg.innerHTML = elements;
  }

  function renderChartError(svgId, message) {
    const svg = document.getElementById(svgId);
    if (!svg || !svg.parentElement) return;
    const container = svg.parentElement;
    svg.style.display = 'none';

    let errBox = container.querySelector('.error-state-box');
    if (!errBox) {
      errBox = document.createElement('div');
      errBox.className = 'error-state-box';
      container.appendChild(errBox);
    }
    errBox.textContent = message;
    errBox.style.display = 'flex';
  }

  // Animated Count-Up for Statistics Cards
  function animateCount(elemId, targetVal, duration = 600) {
    const elem = document.getElementById(elemId);
    if (!elem) return;
    const target = Number(targetVal) || 0;
    if (isNaN(target)) {
      elem.textContent = String(targetVal);
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elem.textContent = target.toLocaleString();
      return;
    }

    let start = 0;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const current = Math.floor(start + (target - start) * (1 - Math.pow(1 - progress, 3)));
      elem.textContent = current.toLocaleString();
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        elem.textContent = target.toLocaleString();
      }
    }
    requestAnimationFrame(step);
  }

  function updateLastUpdated(isoStr) {
    const elem = document.getElementById('footer-last-updated');
    if (elem && isoStr) {
      const d = new Date(isoStr);
      elem.textContent = `Last Updated: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
  }

  function formatTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Subtle ambient dust particle effect in the background
  function setupAmbientParticles() {
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const particles = Array.from({ length: 22 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.4 + 0.1,
      speedX: (Math.random() - 0.5) * 0.25,
      speedY: -Math.random() * 0.3 - 0.1,
    }));

    function loop() {
      ctx.clearRect(0, 0, width, height);
      particles.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;
        if (p.y < 0) {
          p.y = height + 5;
          p.x = Math.random() * width;
        }
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(212, 175, 55, ${p.alpha})`;
        ctx.fill();
      });
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  // Boot client
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
