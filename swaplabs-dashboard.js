(() => {
  'use strict';

  const portalType = document.querySelector('[data-member-portal]')?.dataset.memberPortal;
  if (!portalType) return;

  const state = {
    csrf: '',
    user: null,
    dashboard: null
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  } [character]));
  const asList = value => Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(',').map(item =>
    item.trim()).filter(Boolean);
  const formatNumber = value => new Intl.NumberFormat().format(Number(value || 0));
  const formatDateTime = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Time to be confirmed' : new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(parsed);
  };
  const initials = person => String(person?.display_name || person?.profile?.display_name || person?.username || 'SL')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const avatarUrl = person => {
    const value = String(person?.avatar_url || person?.profile?.avatar_url || '');
    return /^\/uploads\/usr_[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(value) ? value : '';
  };
  const avatarHtml = (person, className = 'match-avatar') => {
    const url = avatarUrl(person);
    const name = person?.display_name || person?.profile?.display_name || person?.username || 'SwapLabs member';
    const color = escapeHtml(person?.profile_color || person?.profile?.profile_color || 'indigo');
    return `<span class="${className} ${color}">${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)} profile photo">` : escapeHtml(initials(person))}</span>`;
  };

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      ...(options.headers || {})
    };
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      if (!state.csrf) {
        const secure = await fetch('/api/auth/csrf', {
          credentials: 'same-origin'
        });
        if (!secure.ok) throw new Error('Could not create a secure session.');
        state.csrf = (await secure.json()).csrf_token;
      }
      headers['X-CSRF-Token'] = state.csrf;
    }
    if (options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({
      error: 'The server returned an unreadable response.'
    }));
    if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
    if (payload.csrf_token) state.csrf = payload.csrf_token;
    return payload;
  }

  function reasonRows(reasons = []) {
    return reasons.map(reason => {
      const percent = Math.max(0, Math.min(100, Math.round(Number(reason.points || 0) / Math.max(Number(reason
        .max_points || 1), 1) * 100)));
      return `<li><div class="match-factor-title"><strong>${escapeHtml(reason.label)}</strong><span>${Number(reason.points || 0)}/${Number(reason.max_points || 0)}</span></div><span class="match-factor-bar"><i style="width:${percent}%"></i></span><p>${escapeHtml(reason.explanation)}</p></li>`;
    }).join('');
  }

  function matchCard(match, compact = false) {
    const person = match.candidate;
    const reputation = person.reputation || {};
    const teaches = asList(person.skills_to_teach).slice(0, compact ? 2 : 4);
    const learns = asList(person.skills_to_learn).slice(0, compact ? 1 : 3);
    const categories = asList(person.skill_categories).slice(0, 3);
    const rating = Number(reputation.review_count || 0) ? `${Number(reputation.rating || 0).toFixed(1)} rating` :
      'New member';
    const availabilityClass = match.availability?.available_now || match.availability?.next_overlap_at ? 'available' :
      'unavailable';
    const explanation = match.top_reasons?.[0] ||
      'A discovery recommendation based on your wider profile preferences.';
    return `<article class="match-profile-card${compact ? ' compact' : ''}" data-match-id="${escapeHtml(match.id)}">
      <div class="match-profile-top">
        <div class="match-person">${avatarHtml(person)}<div><h3>${escapeHtml(person.display_name)}</h3><span>@${escapeHtml(person.username)}${person.country ? ` · ${escapeHtml(person.country)}` : ''}</span></div></div>
        <div class="match-score-ring small" style="--score:${Number(match.score || 0)}"><strong>${Number(match.score || 0)}</strong><span>match</span></div>
      </div>
      <div class="match-profile-status"><span class="availability-pill ${availabilityClass}"><i class="bx bxs-circle"></i> ${escapeHtml(match.availability?.label || 'Availability not set')}</span>${categories.map(category => `<span class="skill-category-pill">${escapeHtml(category)}</span>`).join('')}</div>
      <p class="match-headline">${escapeHtml(person.headline || 'SwapLabs member ready to exchange practical knowledge.')}</p>
      <div class="match-skill-block"><span>Can teach</span><div>${teaches.length ? teaches.map(skill => `<b>${escapeHtml(skill)}</b>`).join('') : '<em>No teaching skills listed</em>'}</div></div>
      ${compact ? '' : `<div class="match-skill-block"><span>Wants to learn</span><div>${learns.length ? learns.map(skill => `<b class="soft">${escapeHtml(skill)}</b>`).join('') : '<em>No learning skills listed</em>'}</div></div>`}
      <div class="match-trust-row"><span><i class="bx bx-star"></i> ${escapeHtml(rating)}</span><span><i class="bx bx-check-shield"></i> ${Number(reputation.reliability_score || 0)}% reliable</span><span><i class="bx bx-calendar-check"></i> ${Number(reputation.completed_sessions || 0)} sessions</span></div>
      <div class="match-explanation"><i class="bx bx-bulb"></i><p><strong>Best reason:</strong> ${escapeHtml(explanation)}</p></div>
      ${compact ? '' : `<details class="match-reasons"><summary>Why this match? <span>See all scoring factors</span><i class="bx bx-chevron-down"></i></summary><ul>${reasonRows(match.reasons)}</ul></details>`}
      <div class="match-card-actions"><button class="btn btn-primary btn-sm" type="button" data-message-user="${escapeHtml(person.id)}"><i class="bx bx-message-square-dots"></i> Message</button><a class="btn btn-sm" href="community.html?user=${encodeURIComponent(person.id)}"><i class="bx bx-user"></i> View profile</a>${compact ? `<a class="text-button" href="skill-matching.html">Why ${Number(match.score || 0)}?</a>` : ''}</div>
    </article>`;
  }

  function emptyBlock(icon, title, text, href, action) {
    return `<div class="dashboard-empty"><i class="bx ${escapeHtml(icon)}"></i><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div><a href="${escapeHtml(href)}">${escapeHtml(action)} <i class="bx bx-right-arrow-alt"></i></a></div>`;
  }

  function renderDashboard(payload) {
    state.dashboard = payload;
    const firstName = payload.user?.profile?.first_name || payload.user?.profile?.display_name?.split(/\s+/)[0] ||
      'member';
    $('[data-dashboard-first-name]').textContent = firstName;
    $('[data-dashboard-date]').textContent = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    }).format(new Date());
    Object.entries(payload.summary || {}).forEach(([key, value]) => {
      const target = $(`[data-summary="${key}"]`);
      if (target) target.textContent = formatNumber(value);
    });
    Object.entries(payload.metrics || {}).forEach(([key, value]) => {
      $$(`[data-platform-metric="${key}"]`).forEach(target => {
        target.textContent = formatNumber(value);
      });
    });

    const action = payload.suggested_action || {};
    $('[data-next-action]').innerHTML =
      `<div class="next-action-content"><span class="next-action-icon"><i class="bx ${escapeHtml(action.icon || 'bx-compass')}"></i></span><div><h3>${escapeHtml(action.title || 'Choose your next step')}</h3><p>${escapeHtml(action.description || 'Explore your dashboard and continue learning.')}</p><a class="btn btn-primary" href="${escapeHtml(action.href || 'browse-skills.html')}">Continue <i class="bx bx-right-arrow-alt"></i></a></div></div>`;

    const goal = payload.learning_goal || {};
    $('[data-learning-goal]').innerHTML =
      `<p class="goal-title">${escapeHtml(goal.title || 'Add your first learning goal')}</p><div class="goal-progress-label"><span>Progress signal</span><strong>${Number(goal.progress || 0)}%</strong></div><div class="goal-progress-track"><i style="width:${Number(goal.progress || 0)}%"></i></div><div class="goal-context"><span><strong>${Number(goal.completed_sessions || 0)}</strong> completed sessions</span><span><strong>${Number(goal.profile_completeness || 0)}%</strong> profile complete</span></div>`;

    const matches = payload.recommended_matches || [];
    $('#dashboardMatches').innerHTML = matches.length ? matches.map(match => matchCard(match, true)).join('') :
      emptyBlock('bx-radar', 'No recommendation yet',
        'Add skills, languages, and availability so the matcher has enough context.', 'profile.html',
        'Complete profile');

    const sessions = payload.upcoming_sessions || [];
    $('#dashboardSessions').innerHTML = sessions.length ? sessions.map(event =>
      `<a class="dashboard-list-item" href="video-room.html?event=${encodeURIComponent(event.id)}"><span class="dashboard-list-icon"><i class="bx bx-video"></i></span><div><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(formatDateTime(event.starts_at))}</span><small>${escapeHtml(event.host?.display_name || 'SwapLabs host')} · Open protected live room</small></div><i class="bx bx-chevron-right"></i></a>`
      ).join('') : emptyBlock('bx-calendar-plus', 'No upcoming session',
      'Choose a match, agree on a useful outcome, then put it on both calendars.', 'calendar.html', 'Schedule one');

    const messages = payload.recent_messages || [];
    $('#dashboardMessages').innerHTML = messages.length ? messages.map(conversation => {
      const member = conversation.members?.[0];
      const body = conversation.latest_message?.body || 'Conversation ready';
      return `<a class="dashboard-list-item message" href="notifications.html?conversation=${encodeURIComponent(conversation.id)}">${conversation.kind === 'bot' ? '<span class="dashboard-list-icon bot"><i class="bx bx-bot"></i></span>' : avatarHtml(member, 'dashboard-message-avatar')}<div><strong>${escapeHtml(conversation.title)}</strong><span>${escapeHtml(body.slice(0, 90))}</span><small>${conversation.unread_count ? `${Number(conversation.unread_count)} unread` : 'Up to date'}</small></div>${conversation.unread_count ? `<b class="message-count">${Number(conversation.unread_count)}</b>` : '<i class="bx bx-chevron-right"></i>'}</a>`;
    }).join('') : emptyBlock('bx-message-square-dots', 'No conversation yet',
      'Your Inbox holds member chats and SwapBot account updates.', 'notifications.html', 'Open Inbox');

    if (payload.onboarding_complete) $('#dashboardOnboarding')?.classList.add('completed');
  }

  function fillMatchForm() {
    const form = $('#advancedMatchForm');
    if (!form || !state.user) return;
    const profile = state.user.profile || {};
    form.elements.learn_skills.value = asList(profile.skills_to_learn).join(', ');
    form.elements.teach_skills.value = asList(profile.skills_to_teach).join(', ');
    form.elements.proficiency.value = ['Beginner', 'Intermediate', 'Advanced', 'Expert'].includes(profile
      .experience_level) ? profile.experience_level : 'Intermediate';
    form.elements.learning_goal.value = profile.learning_goal || '';
    form.elements.teaching_style.value = profile.teaching_style || 'Project-based';
    form.elements.session_format.value = profile.preferred_format || 'Remote or local';
    form.elements.timezone.value = profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    form.elements.languages.value = [profile.primary_language, ...asList(profile.additional_languages)].filter(
      Boolean).join(', ');
    try {
      const seed = JSON.parse(sessionStorage.getItem('swaplabs-match-seed') || 'null');
      if (seed) {
        if (seed.learn_skills) form.elements.learn_skills.value = seed.learn_skills;
        if (seed.teach_skills) form.elements.teach_skills.value = seed.teach_skills;
        if (seed.session_format) form.elements.session_format.value = seed.session_format;
        sessionStorage.removeItem('swaplabs-match-seed');
      }
    } catch (_error) {
      sessionStorage.removeItem('swaplabs-match-seed');
    }
  }

  function matchingPayload(form) {
    const values = new FormData(form);
    return {
      learn_skills: asList(values.get('learn_skills')),
      teach_skills: asList(values.get('teach_skills')),
      proficiency: values.get('proficiency'),
      learning_goal: values.get('learning_goal'),
      teaching_style: values.get('teaching_style'),
      session_format: values.get('session_format'),
      timezone: values.get('timezone'),
      languages: asList(values.get('languages')),
      category: values.get('category'),
      strict_skill_match: Boolean(form.elements.strict_skill_match.checked)
    };
  }

  async function runMatching() {
    const form = $('#advancedMatchForm');
    const button = $('button[type="submit"]', form);
    const status = $('#matchingStatus');
    button.disabled = true;
    button.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Comparing live profiles';
    status.className = 'form-status';
    try {
      const result = await api('/api/matches', {
        method: 'POST',
        body: matchingPayload(form)
      });
      const matches = result.matches || [];
      $('#matchResults').innerHTML = matches.map(match => matchCard(match)).join('');
      $('#matchEmpty').hidden = matches.length > 0;
      $('#matchingResultSummary').textContent = matches.length ?
        `${matches.length} compatible member${matches.length === 1 ? '' : 's'} ranked from live profile and availability data.` :
        'No direct fit was found with the current filters.';
      status.textContent = matches.length ?
        `Matching complete. Your strongest current score is ${matches[0].score}.` :
        'No strong match was found. Broaden the search or update your profile.';
      status.className = `form-status show ${matches.length ? 'success' : 'info'}`;
    } catch (error) {
      status.textContent = error.message;
      status.className = 'form-status show error';
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="bx bx-radar"></i> Calculate my matches';
    }
  }

  async function startConversation(userId, button) {
    button.disabled = true;
    const previous = button.innerHTML;
    button.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Opening';
    try {
      const result = await api('/api/inbox/conversations', {
        method: 'POST',
        body: {
          target_user_id: userId
        }
      });
      location.href = `notifications.html?conversation=${encodeURIComponent(result.conversation.id)}`;
    } catch (error) {
      button.disabled = false;
      button.innerHTML = previous;
      alert(error.message);
    }
  }

  function setupCommonActions() {
    document.addEventListener('click', event => {
      const messageButton = event.target.closest('[data-message-user]');
      if (messageButton) startConversation(messageButton.dataset.messageUser, messageButton);
    });
  }

  function setupTour() {
    $$('[data-onboarding-step]').forEach(button => button.addEventListener('click', () => {
      $$('[data-onboarding-step]').forEach(item => item.classList.toggle('active', item === button));
      $$('[data-onboarding-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset
        .onboardingPanel === button.dataset.onboardingStep));
    }));
    $('#finishDashboardTour')?.addEventListener('click', async () => {
      try {
        await api('/api/dashboard/onboarding', {
          method: 'POST',
          body: {
            complete: true
          }
        });
        $('#dashboardOnboarding').classList.add('completed');
        $('#finishDashboardTour').innerHTML = '<i class="bx bx-check-double"></i> Tour completed';
      } catch (error) {
        alert(error.message);
      }
    });
  }

  function setupMatching() {
    fillMatchForm();
    $('#advancedMatchForm')?.addEventListener('submit', event => {
      event.preventDefault();
      runMatching();
    });
    $('#useSavedProfile')?.addEventListener('click', () => {
      fillMatchForm();
      runMatching();
    });
    $('#broadenMatch')?.addEventListener('click', () => {
      $('#matchCategory').value = '';
      $('#matchStrict').checked = false;
      runMatching();
    });
    runMatching();
  }

  async function initialize() {
    setupCommonActions();
    try {
      const auth = await api('/api/auth/me');
      state.csrf = auth.csrf_token || state.csrf;
      state.user = auth.authenticated ? auth.user : null;
      if (!state.user) {
        $(`#${portalType === 'dashboard' ? 'dashboardLoading' : 'matchingLoading'}`).hidden = true;
        $(`#${portalType === 'dashboard' ? 'dashboardLocked' : 'matchingLocked'}`).hidden = false;
        return;
      }
      if (portalType === 'dashboard') {
        const payload = await api('/api/dashboard');
        $('#dashboardLoading').hidden = true;
        $('#dashboardPortal').hidden = false;
        renderDashboard(payload);
        setupTour();
      } else {
        $('#matchingLoading').hidden = true;
        $('#matchingPortal').hidden = false;
        setupMatching();
      }
    } catch (error) {
      const loading = $(`#${portalType === 'dashboard' ? 'dashboardLoading' : 'matchingLoading'}`);
      if (loading) loading.innerHTML =
      `<i class="bx bx-error-circle"></i><span>${escapeHtml(error.message)}</span>`;
    }
  }

  initialize();
})();
