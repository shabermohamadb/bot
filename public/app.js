/**
 * TRACKING PARTY WEB ANALYTICS — FRONTEND CLIENT
 * Clean, lightweight, dependency-free vanilla JavaScript client.
 */

(function () {
  'use strict';

  // State
  const state = {
    currentView: 'overview',
    overviewPeriod: 'week',
    weeklyOffset: 0,
    monthlyOffset: 0,
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
  };

  // DOM Elements
  const navLinks = document.querySelectorAll('.nav-item');
  const viewSections = document.querySelectorAll('.view-section');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navLinksContainer = document.getElementById('navLinks');

  // Modal Elements
  const hostModalOverlay = document.getElementById('hostModalOverlay');
  const hostModalBody = document.getElementById('hostModalBody');
  const modalCloseBtn = document.getElementById('modalCloseBtn');

  // =========================================================================
  // INITIALIZATION & ROUTING
  // =========================================================================
  function init() {
    setupNavigation();
    setupOverviewControls();
    setupWeeklyControls();
    setupMonthlyControls();
    setupLeaderboardControls();
    setupHistoryControls();
    setupModal();

    // Listen to hash and history navigation
    window.addEventListener('hashchange', handleRoute);
    window.addEventListener('popstate', handleRoute);

    // Initial route resolution
    handleRoute();
  }

  /**
   * Robustly parses the target route from location.hash or location.pathname.
   * Supports: #overview, #/overview, #weekly, #/weekly, /weekly, #host/123, #/host/123
   */
  function parseCurrentRoute() {
    let raw = window.location.hash || '';

    // Strip leading hash and slash
    if (raw.startsWith('#')) {
      raw = raw.slice(1);
    }
    if (raw.startsWith('/')) {
      raw = raw.slice(1);
    }

    // 1. Host profile route
    if (raw.startsWith('host/')) {
      const parts = raw.split('/');
      return { type: 'host', userId: parts[1] || '' };
    }

    // Strip query strings if present
    if (raw.includes('?')) {
      raw = raw.split('?')[0];
    }

    // 2. If no hash, inspect pathname for direct SPA URL visits
    if (!raw) {
      let path = window.location.pathname || '';
      if (path.startsWith('/')) {
        path = path.slice(1);
      }
      const firstSegment = path.split('/')[0];
      if (['overview', 'weekly', 'monthly', 'leaderboard', 'history'].includes(firstSegment)) {
        raw = firstSegment;
      }
    }

    const validViews = ['overview', 'weekly', 'monthly', 'leaderboard', 'history'];
    const view = validViews.includes(raw) ? raw : 'overview';
    return { type: 'view', view };
  }

  /**
   * Handles router state changes and switches the active view.
   */
  function handleRoute() {
    const route = parseCurrentRoute();

    if (route.type === 'host' && route.userId) {
      // Keep underlying view active and display host modal
      switchView(state.currentView || 'overview', false);
      openHostProfile(route.userId);
      return;
    }

    switchView(route.view, true);
  }

  /**
   * Immediately switches active tab and section visibility.
   */
  function switchView(targetView, shouldLoadData = true) {
    state.currentView = targetView;

    // 1. Close modal if open
    if (hostModalOverlay && hostModalOverlay.classList.contains('active')) {
      hostModalOverlay.classList.remove('active');
    }

    // 2. Update active nav items
    navLinks.forEach((link) => {
      if (link.dataset.view === targetView) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });

    // 3. Toggle view sections
    viewSections.forEach((sec) => {
      if (sec.id === `view-${targetView}`) {
        sec.classList.add('active');
        sec.style.display = 'block';
      } else {
        sec.classList.remove('active');
        sec.style.display = 'none';
      }
    });

    // 4. Close mobile menu drawer if open
    if (navLinksContainer) {
      navLinksContainer.classList.remove('open');
    }

    // 5. Scroll to top of page
    window.scrollTo({ top: 0, behavior: 'auto' });

    // 6. Load data for active view
    if (shouldLoadData) {
      loadViewData(targetView);
    }
  }

  /**
   * Sets up click handlers for navbar, brand, mobile menu, and in-page tab links.
   */
  function setupNavigation() {
    // Mobile menu toggle
    if (mobileMenuBtn && navLinksContainer) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navLinksContainer.classList.toggle('open');
      });
    }

    // Close mobile nav when clicking outside
    document.addEventListener('click', (e) => {
      if (navLinksContainer && navLinksContainer.classList.contains('open')) {
        if (!navLinksContainer.contains(e.target) && e.target !== mobileMenuBtn) {
          navLinksContainer.classList.remove('open');
        }
      }
    });

    // Attach click listeners to all nav items
    navLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        if (view) {
          closeHostProfile(false);
          if (window.location.hash !== `#${view}`) {
            window.location.hash = `#${view}`;
          } else {
            // Already on this view: refresh tab data immediately
            switchView(view, true);
          }
        }
      });
    });

    // Brand click navigates to overview
    const brand = document.querySelector('.brand');
    if (brand) {
      brand.addEventListener('click', (e) => {
        e.preventDefault();
        closeHostProfile(false);
        if (window.location.hash !== '#overview') {
          window.location.hash = '#overview';
        } else {
          switchView('overview', true);
        }
      });
    }

    // In-page internal tab anchors (e.g. "View Full" -> Leaderboard, "Browse All History" -> History)
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      if (!link.classList.contains('nav-item') && !link.classList.contains('brand')) {
        link.addEventListener('click', (e) => {
          const href = link.getAttribute('href');
          if (href && href.startsWith('#')) {
            const view = href.replace(/^#\/?/, '').split('?')[0];
            if (['overview', 'weekly', 'monthly', 'leaderboard', 'history'].includes(view)) {
              e.preventDefault();
              closeHostProfile(false);
              window.location.hash = `#${view}`;
            }
          }
        });
      }
    });
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

      document.getElementById('ov-total-parties').textContent = data.totalPartiesHosted.toLocaleString();
      document.getElementById('ov-active-parties').textContent = data.activeParties.toLocaleString();
      document.getElementById('ov-unique-hosts').textContent = data.totalUniqueHosts.toLocaleString();
      document.getElementById('ov-period-label').textContent = data.dateRange.label;

      // Top host card
      if (data.topHost) {
        document.getElementById('ov-top-host-avatar').src = data.topHost.avatarUrl;
        document.getElementById('ov-top-host-name').textContent = data.topHost.displayName;
        document.getElementById('ov-top-host-count').textContent = `${data.topHost.partyCount} parties hosted`;
        document.getElementById('ov-top-host-card').onclick = () => openHostProfile(data.topHost.userId);
        document.getElementById('ov-top-host-card').style.cursor = 'pointer';
      } else {
        document.getElementById('ov-top-host-name').textContent = 'No party data available yet.';
        document.getElementById('ov-top-host-count').textContent = '—';
        document.getElementById('ov-top-host-card').onclick = null;
        document.getElementById('ov-top-host-card').style.cursor = 'default';
      }

      // Render Activity Chart with clean empty state when no parties exist
      renderBarChart('overviewChart', data.activityOverTime, 'count', 'label', 'No party data available yet.');

      // Render Top Hosts List
      renderOverviewTopHosts(data.topHosts);

      // Render Recent Parties
      renderOverviewRecentParties(data.recentParties);

      // Update footer
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
        <div class="ranking-item" onclick="window.location.hash='host/${h.userId}'">
          <div class="ranking-left">
            <span class="rank-badge rank-${h.rank}">${h.rank}</span>
            <img class="avatar-xs" src="${escapeHTML(h.avatarUrl)}" alt="Avatar" loading="lazy">
            <span class="ranking-name">${escapeHTML(h.displayName)}</span>
          </div>
          <span class="ranking-count">${h.partyCount} <span style="font-size: 0.72rem; color: var(--color-text-secondary); font-weight: normal;">runs</span></span>
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
        <tr>
          <td class="cell-bold">${escapeHTML(p.title)}</td>
          <td>
            <div class="host-cell" onclick="window.location.hash='host/${p.organizerId}'" style="cursor: pointer;">
              <img class="avatar-xs" src="${escapeHTML(p.host?.avatarUrl || '')}" alt="" loading="lazy">
              <span>${escapeHTML(p.host?.displayName || p.organizerId)}</span>
            </div>
          </td>
          <td><span class="badge badge-silver">${p.activityType}</span></td>
          <td class="font-mono">${p.ipRequirement}+ IP</td>
          <td class="font-mono">${p.registeredCount} / ${p.totalSlots}</td>
          <td><span class="status-badge status-${p.status.toLowerCase()}">${p.status}</span></td>
          <td class="font-mono" style="font-size: 0.75rem;">${p.formattedDate}</td>
        </tr>
      `
      )
      .join('');
  }

  // =========================================================================
  // 2. WEEKLY REPORT VIEW
  // =========================================================================
  function setupWeeklyControls() {
    document.getElementById('btn-prev-week')?.addEventListener('click', () => {
      state.weeklyOffset -= 1;
      loadWeeklyReport();
    });
    document.getElementById('btn-next-week')?.addEventListener('click', () => {
      state.weeklyOffset += 1;
      loadWeeklyReport();
    });
    document.getElementById('btn-current-week')?.addEventListener('click', () => {
      state.weeklyOffset = 0;
      loadWeeklyReport();
    });
  }

  async function loadWeeklyReport() {
    try {
      const res = await fetch(`/api/reports/weekly?offset=${state.weeklyOffset}`);
      if (!res.ok) throw new Error('Failed to load weekly report');
      const data = await res.json();

      document.getElementById('weekly-range-pill').textContent = data.period.label;
      document.getElementById('wk-total-parties').textContent = data.summary.totalParties.toLocaleString();
      document.getElementById('wk-unique-hosts').textContent = data.summary.uniqueHosts.toLocaleString();

      if (data.summary.totalParties === 0) {
        document.getElementById('wk-diff-badge').innerHTML = '<span class="badge-diff-na">No parties hosted this week.</span>';
        document.getElementById('wk-busiest-day').textContent = 'No parties hosted this week.';
        document.getElementById('wk-busiest-count').textContent = '—';
        document.getElementById('wk-top-host-name').textContent = 'No parties hosted this week.';
        document.getElementById('wk-top-host-count').textContent = '—';
        document.getElementById('wk-top-host-content').onclick = null;
        document.getElementById('wk-top-host-content').style.cursor = 'default';
      } else {
        // Comparison badge: never fabricate comparisons when previous period has 0 data
        const diffElem = document.getElementById('wk-diff-badge');
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

        // Busiest day
        document.getElementById('wk-busiest-day').textContent = data.summary.busiestDay?.day || 'None';
        document.getElementById('wk-busiest-count').textContent = `${data.summary.busiestDay?.count || 0} parties hosted`;

        // Top host of week
        const topHost = data.summary.topHost;
        if (topHost) {
          document.getElementById('wk-top-host-avatar').src = topHost.avatarUrl;
          document.getElementById('wk-top-host-name').textContent = topHost.displayName;
          document.getElementById('wk-top-host-count').textContent = `${topHost.partyCount} parties hosted`;
          document.getElementById('wk-top-host-content').onclick = () => openHostProfile(topHost.userId);
          document.getElementById('wk-top-host-content').style.cursor = 'pointer';
        } else {
          document.getElementById('wk-top-host-name').textContent = 'No parties hosted this week.';
          document.getElementById('wk-top-host-count').textContent = '—';
          document.getElementById('wk-top-host-content').onclick = null;
          document.getElementById('wk-top-host-content').style.cursor = 'default';
        }
      }

      // Render 7-day daily activity chart (Mon through Sun) with clean empty state
      renderBarChart('weeklyChart', data.dailyActivity, 'count', 'shortLabel', 'No parties hosted this week.');

      // Render Weekly Leaderboard
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
                    <img class="avatar-xs" src="${escapeHTML(h.avatarUrl)}" alt="" loading="lazy">
                    <span>${escapeHTML(h.displayName)}</span>
                  </div>
                </td>
                <td class="font-mono text-gold" style="font-weight: 800; font-size: 1.05rem;">${h.partyCount}</td>
                <td class="font-mono" style="font-size: 0.75rem;">${h.lastActive ? new Date(h.lastActive).toLocaleDateString() : '—'}</td>
                <td>
                  <button class="btn-view-profile" onclick="window.location.hash='host/${h.userId}'">View Profile</button>
                </td>
              </tr>
            `
            )
            .join('');
        }
      }
    } catch (err) {
      console.error(err);
      document.getElementById('wk-total-parties').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('wk-unique-hosts').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('wk-diff-badge').innerHTML = '<span class="text-error">Failed to load comparison</span>';
      document.getElementById('wk-busiest-day').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('wk-busiest-count').textContent = '—';
      document.getElementById('wk-top-host-name').innerHTML = '<span class="text-error">Failed to load data</span>';
      document.getElementById('wk-top-host-count').textContent = '—';
      renderChartError('weeklyChart', 'Failed to load weekly report from server.');
      const tbody = document.getElementById('wk-leaderboard-tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="error-state-cell">Failed to load weekly report from server.</td></tr>';
      }
    }
  }

  // =========================================================================
  // 3. MONTHLY REPORT VIEW
  // =========================================================================
  function setupMonthlyControls() {
    document.getElementById('btn-prev-month')?.addEventListener('click', () => {
      state.monthlyOffset -= 1;
      loadMonthlyReport();
    });
    document.getElementById('btn-next-month')?.addEventListener('click', () => {
      state.monthlyOffset += 1;
      loadMonthlyReport();
    });
    document.getElementById('btn-current-month')?.addEventListener('click', () => {
      state.monthlyOffset = 0;
      loadMonthlyReport();
    });
  }

  async function loadMonthlyReport() {
    try {
      const res = await fetch(`/api/reports/monthly?offset=${state.monthlyOffset}`);
      if (!res.ok) throw new Error('Failed to load monthly report');
      const data = await res.json();

      document.getElementById('monthly-range-pill').textContent = data.period.label;
      document.getElementById('mo-total-parties').textContent = data.summary.totalParties.toLocaleString();
      document.getElementById('mo-unique-hosts').textContent = data.summary.uniqueHosts.toLocaleString();

      if (data.summary.totalParties === 0) {
        document.getElementById('mo-diff-badge').innerHTML = '<span class="badge-diff-na">No parties hosted this month.</span>';
        document.getElementById('mo-busiest-day').textContent = 'No parties hosted this month.';
        document.getElementById('mo-busiest-day-count').textContent = '—';
        document.getElementById('mo-top-host-name').textContent = 'No parties hosted this month.';
        document.getElementById('mo-top-host-count').textContent = '—';
        document.getElementById('mo-top-host-content').onclick = null;
        document.getElementById('mo-top-host-content').style.cursor = 'default';
      } else {
        const diffElem = document.getElementById('mo-diff-badge');
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

        document.getElementById('mo-busiest-day').textContent = data.summary.busiestDay ? `Day ${data.summary.busiestDay.day}` : 'None';
        document.getElementById('mo-busiest-day-count').textContent = `${data.summary.busiestDay?.count || 0} parties hosted`;

        const topHost = data.summary.topHost;
        if (topHost) {
          document.getElementById('mo-top-host-avatar').src = topHost.avatarUrl;
          document.getElementById('mo-top-host-name').textContent = topHost.displayName;
          document.getElementById('mo-top-host-count').textContent = `${topHost.partyCount} parties hosted`;
          document.getElementById('mo-top-host-content').onclick = () => openHostProfile(topHost.userId);
          document.getElementById('mo-top-host-content').style.cursor = 'pointer';
        } else {
          document.getElementById('mo-top-host-name').textContent = 'No parties hosted this month.';
          document.getElementById('mo-top-host-count').textContent = '—';
          document.getElementById('mo-top-host-content').onclick = null;
          document.getElementById('mo-top-host-content').style.cursor = 'default';
        }
      }

      // Render monthly calendar bars with clean empty state
      renderBarChart('monthlyChart', data.dailyActivity, 'count', 'day', 'No parties hosted this month.');

      // Monthly Leaderboard Table
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
                    <img class="avatar-xs" src="${escapeHTML(h.avatarUrl)}" alt="" loading="lazy">
                    <span>${escapeHTML(h.displayName)}</span>
                  </div>
                </td>
                <td class="font-mono text-gold" style="font-weight: 800; font-size: 1.05rem;">${h.partyCount}</td>
                <td class="font-mono" style="font-size: 0.75rem;">${h.lastActive ? new Date(h.lastActive).toLocaleDateString() : '—'}</td>
                <td>
                  <button class="btn-view-profile" onclick="window.location.hash='host/${h.userId}'">View Profile</button>
                </td>
              </tr>
            `
            )
            .join('');
        }
      }
    } catch (err) {
      console.error(err);
      document.getElementById('mo-total-parties').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('mo-unique-hosts').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('mo-diff-badge').innerHTML = '<span class="text-error">Failed to load comparison</span>';
      document.getElementById('mo-busiest-day').innerHTML = '<span class="text-error">Unavailable</span>';
      document.getElementById('mo-busiest-day-count').textContent = '—';
      document.getElementById('mo-top-host-name').innerHTML = '<span class="text-error">Failed to load data</span>';
      document.getElementById('mo-top-host-count').textContent = '—';
      renderChartError('monthlyChart', 'Failed to load monthly report from server.');
      const tbody = document.getElementById('mo-leaderboard-tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="error-state-cell">Failed to load monthly report from server.</td></tr>';
      }
    }
  }

  // =========================================================================
  // 4. LEADERBOARD VIEW
  // =========================================================================
  function setupLeaderboardControls() {
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
    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.leaderboardSearch = e.target.value;
        state.leaderboardPage = 1;
        loadLeaderboard();
      }, 300);
    });

    document.getElementById('lb-prev-btn')?.addEventListener('click', () => {
      if (state.leaderboardPage > 1) {
        state.leaderboardPage -= 1;
        loadLeaderboard();
      }
    });

    document.getElementById('lb-next-btn')?.addEventListener('click', () => {
      if (state.leaderboardPage < state.leaderboardTotalPages) {
        state.leaderboardPage += 1;
        loadLeaderboard();
      }
    });

    document.getElementById('btn-export-leaderboard')?.addEventListener('click', () => {
      window.open(`/api/export/leaderboard.csv?period=${state.leaderboardPeriod}`, '_blank');
    });
  }

  async function loadLeaderboard() {
    try {
      const url = `/api/leaderboard?period=${state.leaderboardPeriod}&page=${state.leaderboardPage}&limit=20&search=${encodeURIComponent(state.leaderboardSearch)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load leaderboard');
      const data = await res.json();

      state.leaderboardTotalPages = data.pagination?.totalPages || 1;

      const tbody = document.getElementById('lb-tbody');
      if (tbody) {
        if (!data.hosts || data.hosts.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state-cell">No hosts to rank yet.</td></tr>';
        } else {
          tbody.innerHTML = data.hosts
            .map(
              (h) => `
              <tr>
                <td><span class="rank-badge rank-${h.rank}">${h.rank}</span></td>
                <td>
                  <div class="host-cell" onclick="window.location.hash='host/${h.userId}'" style="cursor: pointer;">
                    <img class="avatar-xs" src="${escapeHTML(h.avatarUrl)}" alt="" loading="lazy">
                    <div>
                      <div class="cell-bold">${escapeHTML(h.displayName)}</div>
                      <div style="font-size: 0.72rem; color: var(--color-text-muted);">@${escapeHTML(h.username)}</div>
                    </div>
                  </div>
                </td>
                <td class="font-mono" style="font-size: 0.75rem; color: var(--color-text-muted);">${h.userId}</td>
                <td class="font-mono text-gold" style="font-weight: 800; font-size: 1.1rem;">${h.partyCount}</td>
                <td class="font-mono" style="font-size: 0.75rem;">${h.lastActive ? new Date(h.lastActive).toLocaleDateString() : '—'}</td>
                <td>
                  <button class="btn-view-profile" onclick="window.location.hash='host/${h.userId}'">View Profile</button>
                </td>
              </tr>
            `
            )
            .join('');
        }
      }

      // Update Pagination
      const pageInfo = document.getElementById('lb-page-info');
      if (pageInfo) {
        pageInfo.textContent = `Page ${data.pagination.page} of ${data.pagination.totalPages}`;
      }
      const prevBtn = document.getElementById('lb-prev-btn');
      if (prevBtn) prevBtn.disabled = data.pagination.page <= 1;
      const nextBtn = document.getElementById('lb-next-btn');
      if (nextBtn) nextBtn.disabled = data.pagination.page >= data.pagination.totalPages;
    } catch (err) {
      console.error(err);
      const tbody = document.getElementById('lb-tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="error-state-cell">Failed to load leaderboard from server.</td></tr>';
      }
    }
  }

  // =========================================================================
  // 5. PARTY HISTORY VIEW
  // =========================================================================
  function setupHistoryControls() {
    const searchInput = document.getElementById('hist-search-input');
    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.historySearch = e.target.value;
        state.historyPage = 1;
        loadHistory();
      }, 300);
    });

    document.getElementById('hist-activity-select')?.addEventListener('change', (e) => {
      state.historyActivity = e.target.value;
      state.historyPage = 1;
      loadHistory();
    });

    document.getElementById('hist-status-select')?.addEventListener('change', (e) => {
      state.historyStatus = e.target.value;
      state.historyPage = 1;
      loadHistory();
    });

    document.getElementById('hist-start-date')?.addEventListener('change', (e) => {
      state.historyStartDate = e.target.value;
      state.historyPage = 1;
      loadHistory();
    });

    document.getElementById('hist-end-date')?.addEventListener('change', (e) => {
      state.historyEndDate = e.target.value;
      state.historyPage = 1;
      loadHistory();
    });

    document.getElementById('hist-reset-btn')?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      const actSelect = document.getElementById('hist-activity-select');
      if (actSelect) actSelect.value = 'ALL';
      const statSelect = document.getElementById('hist-status-select');
      if (statSelect) statSelect.value = 'ALL';
      const startInput = document.getElementById('hist-start-date');
      if (startInput) startInput.value = '';
      const endInput = document.getElementById('hist-end-date');
      if (endInput) endInput.value = '';

      state.historySearch = '';
      state.historyActivity = 'ALL';
      state.historyStatus = 'ALL';
      state.historyStartDate = '';
      state.historyEndDate = '';
      state.historyPage = 1;
      loadHistory();
    });

    document.getElementById('hist-prev-btn')?.addEventListener('click', () => {
      if (state.historyPage > 1) {
        state.historyPage -= 1;
        loadHistory();
      }
    });

    document.getElementById('hist-next-btn')?.addEventListener('click', () => {
      if (state.historyPage < state.historyTotalPages) {
        state.historyPage += 1;
        loadHistory();
      }
    });

    document.getElementById('btn-export-parties')?.addEventListener('click', () => {
      let url = '/api/export/parties.csv?';
      if (state.historyActivity !== 'ALL') url += `activity=${state.historyActivity}&`;
      if (state.historyStatus !== 'ALL') url += `status=${state.historyStatus}&`;
      window.open(url, '_blank');
    });
  }

  async function loadHistory() {
    try {
      let query = `/api/parties?page=${state.historyPage}&limit=20`;
      if (state.historySearch) query += `&search=${encodeURIComponent(state.historySearch)}`;
      if (state.historyActivity !== 'ALL') query += `&activity=${state.historyActivity}`;
      if (state.historyStatus !== 'ALL') query += `&status=${state.historyStatus}`;
      if (state.historyStartDate) query += `&startDate=${state.historyStartDate}`;
      if (state.historyEndDate) query += `&endDate=${state.historyEndDate}`;

      const res = await fetch(query);
      if (!res.ok) throw new Error('Failed to load party history');
      const data = await res.json();

      state.historyTotalPages = data.pagination?.totalPages || 1;

      const tbody = document.getElementById('hist-tbody');
      if (tbody) {
        if (!data.parties || data.parties.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state-cell">No parties found.</td></tr>';
        } else {
          tbody.innerHTML = data.parties
            .map(
              (p) => `
              <tr>
                <td class="cell-bold">${escapeHTML(p.title)}</td>
                <td>
                  <div class="host-cell" onclick="window.location.hash='host/${p.organizerId}'" style="cursor: pointer;">
                    <img class="avatar-xs" src="${escapeHTML(p.host?.avatarUrl || '')}" alt="" loading="lazy">
                    <span>${escapeHTML(p.host?.displayName || p.organizerId)}</span>
                  </div>
                </td>
                <td><span class="badge badge-silver">${p.activityType}</span></td>
                <td class="font-mono">${p.ipRequirement}+ IP</td>
                <td class="font-mono">${p.durationMinutes}m</td>
                <td class="font-mono">${p.registeredCount} / ${p.totalSlots}</td>
                <td><span class="status-badge status-${p.status.toLowerCase()}">${p.status}</span></td>
                <td class="font-mono" style="font-size: 0.75rem;">${p.formattedDate}</td>
              </tr>
            `
            )
            .join('');
        }
      }

      const pageInfo = document.getElementById('hist-page-info');
      if (pageInfo) {
        pageInfo.textContent = `Page ${data.pagination.page} of ${data.pagination.totalPages} (${data.pagination.totalCount} parties)`;
      }
      const prevBtn = document.getElementById('hist-prev-btn');
      if (prevBtn) prevBtn.disabled = data.pagination.page <= 1;
      const nextBtn = document.getElementById('hist-next-btn');
      if (nextBtn) nextBtn.disabled = data.pagination.page >= data.pagination.totalPages;
    } catch (err) {
      console.error(err);
      const tbody = document.getElementById('hist-tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="error-state-cell">Failed to load party history from server.</td></tr>';
      }
    }
  }

  // =========================================================================
  // 6. HOST PROFILE MODAL / DRAWER
  // =========================================================================
  function setupModal() {
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', () => closeHostProfile(true));
    }
    if (hostModalOverlay) {
      hostModalOverlay.addEventListener('click', (e) => {
        if (e.target === hostModalOverlay) {
          closeHostProfile(true);
        }
      });
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && hostModalOverlay && hostModalOverlay.classList.contains('active')) {
        closeHostProfile(true);
      }
    });
  }

  async function openHostProfile(userId) {
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

        <div class="profile-stats-grid">
          <div class="profile-stat-box">
            <div class="profile-stat-num">${stats.allTimeParties}</div>
            <div class="profile-stat-lbl">All-Time Runs</div>
          </div>
          <div class="profile-stat-box">
            <div class="profile-stat-num">${stats.currentMonthParties}</div>
            <div class="profile-stat-lbl">This Month</div>
          </div>
          <div class="profile-stat-box">
            <div class="profile-stat-num">${stats.currentWeekParties}</div>
            <div class="profile-stat-lbl">This Week</div>
          </div>
        </div>

        <h3 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--color-text-primary);">Recent Hosted Parties</h3>
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
                    <tr>
                      <td class="cell-bold">${escapeHTML(p.title)}</td>
                      <td><span class="badge badge-silver">${p.activityType}</span></td>
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
      `;
    } catch (err) {
      hostModalBody.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--color-crimson);">Failed to load profile for host ${escapeHTML(userId)}.</div>`;
    }
  }

  function closeHostProfile(updateHash = true) {
    if (hostModalOverlay) {
      hostModalOverlay.classList.remove('active');
    }
    // Revert hash if currently pointing to host profile
    if (updateHash && window.location.hash.includes('host/')) {
      window.location.hash = `#${state.currentView || 'overview'}`;
    }
  }

  // =========================================================================
  // UTILITIES & SVG CHART RENDERING
  // =========================================================================
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

    const emptyBox = container.querySelector('.empty-state-box');
    if (emptyBox) emptyBox.style.display = 'none';
  }

  function renderBarChart(svgId, data, valKey, labelKey, emptyMessage) {
    const svg = document.getElementById(svgId);
    if (!svg || !svg.parentElement) return;
    const container = svg.parentElement;

    // Hide any previous error state
    const existingErr = container.querySelector('.error-state-box');
    if (existingErr) existingErr.style.display = 'none';

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

    const barWidth = Math.max(4, Math.min(28, (chartW / data.length) * 0.7));
    const stepX = chartW / data.length;

    let elements = `
      <!-- Horizontal gridlines -->
      <line x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" class="chart-grid-line" />
      <line x1="${padding.left}" y1="${padding.top + chartH / 2}" x2="${width - padding.right}" y2="${padding.top + chartH / 2}" class="chart-grid-line" />
      <line x1="${padding.left}" y1="${padding.top + chartH}" x2="${width - padding.right}" y2="${padding.top + chartH}" class="chart-grid-line" />

      <!-- Y-Axis labels -->
      <text x="${padding.left - 8}" y="${padding.top + 4}" text-anchor="end" class="chart-axis-text">${maxVal}</text>
      <text x="${padding.left - 8}" y="${padding.top + chartH / 2 + 4}" text-anchor="end" class="chart-axis-text">${Math.round(maxVal / 2)}</text>
      <text x="${padding.left - 8}" y="${padding.top + chartH + 4}" text-anchor="end" class="chart-axis-text">0</text>
    `;

    data.forEach((d, idx) => {
      const val = d[valKey] || 0;
      const barH = (val / maxVal) * chartH;
      const x = padding.left + (idx * stepX) + (stepX - barWidth) / 2;
      const y = padding.top + chartH - barH;

      elements += `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="3" class="chart-bar">
          <title>${d[labelKey] || d.date}: ${val} runs</title>
        </rect>
      `;

      // Show labels for selected items or all if small count
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

  function updateLastUpdated(isoStr) {
    const elem = document.getElementById('footer-last-updated');
    if (elem && isoStr) {
      const d = new Date(isoStr);
      elem.textContent = `Last Updated: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
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

  // Start app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
