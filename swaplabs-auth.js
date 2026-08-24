(() => {
  'use strict';

  const state = {
    csrf: '',
    user: null,
    serverAvailable: true,
    adminUsers: [],
    audit: [],
    selectedUserId: null,
    communityUsers: [],
    notifications: null,
    accessWatch: null
  };

  const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  } [character]));
  const initials = user => {
    const name = user?.profile?.display_name || user?.username || 'SL';
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  };
  const safeAvatarUrl = user => {
    const value = String(user?.profile?.avatar_url || '');
    return /^\/uploads\/usr_[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(value) ? value : '';
  };
  const avatarHtml = (user, className = 'auth-avatar') => {
    const url = safeAvatarUrl(user);
    const color = escapeHtml(user?.profile?.profile_color || 'indigo');
    const content = url ?
      `<img src="${escapeHtml(url)}" alt="${escapeHtml(user?.profile?.display_name || user?.username || 'Member')} profile photo">` :
      initials(user);
    return `<span class="${className} ${color}">${content}</span>`;
  };
  const setAvatar = (element, user, className = 'profile-avatar-xl') => {
    if (!element) return;
    const url = safeAvatarUrl(user);
    element.className = `${className} ${user?.profile?.profile_color || 'indigo'}`;
    element.innerHTML = url ?
      `<img src="${escapeHtml(url)}" alt="${escapeHtml(user?.profile?.display_name || 'Member')} profile photo">` :
      initials(user);
  };
  const list = value => Array.isArray(value) ? value : String(value || '').split(',').map(item => item.trim()).filter(
    Boolean);
  const formatDate = value => {
    if (!value) return 'Never';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(parsed);
  };
  const currentPage = location.pathname.split('/').pop() || 'swaplabs.html';

  async function api(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (writeMethods.has(method) && !state.csrf) {
      const response = await fetch('/api/auth/csrf', {
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Could not establish a secure session.');
      state.csrf = (await response.json()).csrf_token;
    }
    const headers = {
      ...(options.headers || {})
    };
    if (writeMethods.has(method)) headers['X-CSRF-Token'] = state.csrf;
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
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {
        error: 'The server returned an unreadable response.'
      };
    }
    if (!response.ok) {
      if (payload.access_status === 'suspended' && currentPage !== 'login.html') {
        sessionStorage.setItem('swaplabs-access-notice', payload.error || 'This account is temporarily suspended.');
        setTimeout(() => location.replace('login.html?access=suspended'), 50);
      }
      const error = new Error(payload.error || 'Something went wrong.');
      error.status = response.status;
      throw error;
    }
    if (payload.csrf_token) state.csrf = payload.csrf_token;
    return payload;
  }

  function setStatus(form, message, type = 'error') {
    const box = $('[data-status]', form);
    if (!box) return;
    box.textContent = message;
    box.className = `form-status show ${type}`;
  }

  function clearStatus(form) {
    const box = $('[data-status]', form);
    if (!box) return;
    box.textContent = '';
    box.className = 'form-status';
  }

  function loading(button, active, label) {
    if (!button) return;
    if (active) {
      button.dataset.originalHtml = button.innerHTML;
      button.classList.add('button-loading');
      button.disabled = true;
      button.innerHTML = `<i class="bx bx-loader-alt"></i> ${escapeHtml(label || 'Working')}`;
    } else {
      button.classList.remove('button-loading');
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
  }

  function toast(message, type = 'success') {
    let element = $('.auth-toast');
    if (!element) {
      element = document.createElement('div');
      element.className = 'auth-toast';
      document.body.appendChild(element);
    }
    element.className = `auth-toast ${type}`;
    element.innerHTML =
      `<i class="bx ${type === 'error' ? 'bx-error-circle' : 'bx-check-circle'}"></i><span>${escapeHtml(message)}</span>`;
    requestAnimationFrame(() => element.classList.add('show'));
    clearTimeout(element.hideTimer);
    element.hideTimer = setTimeout(() => element.classList.remove('show'), 3600);
  }

  function showServerRequired() {
    $$('[data-server-required]').forEach(element => element.classList.add('show'));
  }

  function renderAccountNavigation() {
    const host = $('[data-auth-nav]');
    if (!host) return;
    if (!state.user) {
      host.innerHTML =
        '<a class="btn" href="login.html"><i class="bx bx-log-in"></i> Log in</a><a class="btn btn-primary" href="register.html">Create account</a>';
      return;
    }
    const user = state.user;
    const adminButton = user.role === 'admin' ?
      '<a class="btn auth-icon-btn" href="admin.html" aria-label="Open administrator panel" title="Administrator panel"><i class="bx bx-shield-quarter"></i></a>' :
      '';
    host.innerHTML =
      `${adminButton}<a class="btn auth-icon-btn" href="dashboard.html" aria-label="Open dashboard" title="Dashboard"><i class="bx bx-grid-alt"></i></a><a class="btn auth-icon-btn" href="calendar.html" aria-label="Open calendar" title="Calendar"><i class="bx bx-calendar"></i></a><a class="btn auth-icon-btn" href="credits.html" aria-label="Open credit ledger" title="Credit ledger"><i class="bx bx-wallet"></i></a><a class="btn auth-icon-btn notification-nav-link" href="notifications.html" aria-label="Open inbox" title="Inbox"><i class="bx bx-message-square-dots"></i><span class="notification-badge" data-notification-badge hidden>0</span></a><a class="btn auth-user-button" href="profile.html" aria-label="Open ${escapeHtml(user.profile.display_name)} profile" title="My profile">${avatarHtml(user)}</a><button class="btn auth-icon-btn" type="button" data-auth-logout aria-label="Log out" title="Log out"><i class="bx bx-log-out"></i></button>`;
    $('[data-auth-logout]', host)?.addEventListener('click', logout);
  }

  async function refreshNotificationBadge() {
    if (!state.user) return;
    try {
      const result = await api('/api/notifications');
      state.notifications = result;
      const badge = $('[data-notification-badge]');
      if (badge) {
        const count = Math.max(Number(result.inbox_unread_count || result.unread_count || 0), Number(result
          .pending_count || 0));
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.hidden = count === 0;
      }
    } catch (_error) {
      // The global header remains usable if notifications cannot be refreshed.
    }
  }

  function renderMemberContext() {
    document.querySelector('.member-context-bar')?.remove();
    if (!state.user) return;
    const user = state.user;
    const teaches = list(user.profile.skills_to_teach)[0] || 'your skills';
    const learns = list(user.profile.skills_to_learn)[0] || 'something new';
    const bar = document.createElement('div');
    bar.className = 'member-context-bar';
    bar.innerHTML =
      `<div class="container member-context-inner"><div class="member-context-copy"><strong>Welcome, ${escapeHtml(user.profile.display_name)}.</strong><span>Teaching ${escapeHtml(teaches)} · Learning ${escapeHtml(learns)} · ${Number(user.time_credits || 0)} credits</span></div><div class="member-context-links"><a href="dashboard.html"><i class="bx bx-grid-alt"></i> Dashboard</a><a href="notifications.html"><i class="bx bx-message-square-dots"></i> Inbox</a><a href="calendar.html"><i class="bx bx-calendar"></i> Calendar</a><a href="credits.html"><i class="bx bx-wallet"></i> Credits</a><a href="profile.html"><i class="bx bx-edit-alt"></i> Edit profile</a>${user.role === 'admin' ? '<a href="admin.html"><i class="bx bx-shield-quarter"></i> Administration</a>' : ''}</div></div>`;
    $('[data-site-header]')?.insertAdjacentElement('afterend', bar);
  }

  async function logout() {
    try {
      await api('/api/auth/logout', {
        method: 'POST'
      });
      state.user = null;
      location.href = 'swaplabs.html';
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function setupPasswordToggles() {
    $$('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      button.innerHTML = `<i class="bx ${input.type === 'password' ? 'bx-show' : 'bx-hide'}"></i>`;
      button.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
    }));
  }

  async function submitLogin(form, mode, destination) {
    clearStatus(form);
    const submit = $('button[type="submit"]', form);
    const fields = new FormData(form);
    const payload = mode === 'admin' ?
      {
        mode,
        admin_id: fields.get('admin_id'),
        password: fields.get('password')
      } :
      {
        mode,
        login: fields.get('login'),
        password: fields.get('password')
      };
    loading(submit, true, 'Verifying');
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: payload
      });
      state.user = result.user;
      window.SwapLabsPreferences?.apply(result.user.preferences || {});
      setStatus(form, `Welcome back, ${result.user.profile.display_name}.`, 'success');
      const landingPages = {
        dashboard: 'dashboard.html',
        home: 'swaplabs.html',
        profile: 'profile.html',
        inbox: 'notifications.html',
        calendar: 'calendar.html',
        community: 'community.html'
      };
      const accountDestination = landingPages[result.user.preferences?.default_landing] || destination;
      setTimeout(() => {
        location.href = mode === 'admin' ? destination : accountDestination;
      }, 380);
    } catch (error) {
      setStatus(form, error.message, 'error');
      loading(submit, false);
    }
  }

  function setupLoginPage() {
    const memberForm = $('#memberLoginForm');
    const adminForm = $('#adminLoginForm');
    memberForm?.addEventListener('submit', event => {
      event.preventDefault();
      submitLogin(memberForm, 'member', 'dashboard.html');
    });
    adminForm?.addEventListener('submit', event => {
      event.preventDefault();
      submitLogin(adminForm, 'admin', 'admin.html');
    });
    const accessNotice = sessionStorage.getItem('swaplabs-access-notice');
    if (accessNotice && memberForm) {
      setStatus(memberForm, accessNotice, 'error');
      sessionStorage.removeItem('swaplabs-access-notice');
    }
    if (state.user) {
      const banner = $('[data-current-session]');
      if (banner) {
        banner.hidden = false;
        banner.innerHTML =
          `<div><strong>You are already signed in as ${escapeHtml(state.user.profile.display_name)}.</strong><span>Continue to your ${state.user.role === 'admin' ? 'administrator workspace or profile' : 'member profile'}.</span></div><a class="btn btn-sm" href="${state.user.role === 'admin' ? 'admin.html' : 'profile.html'}">Continue <i class="bx bx-right-arrow-alt"></i></a>`;
      }
    }
  }

  function registrationPayload(form) {
    const fields = new FormData(form);
    const text = name => String(fields.get(name) || '').trim();
    return {
      username: text('username'),
      email: text('email'),
      password: String(fields.get('password') || ''),
      accepted_terms: fields.get('terms') === 'on',
      profile: {
        first_name: text('first_name'),
        last_name: text('last_name'),
        display_name: text('display_name'),
        pronouns: text('pronouns'),
        date_of_birth: text('date_of_birth'),
        age: text('age'),
        country: text('country'),
        city: text('city'),
        timezone: text('timezone'),
        primary_language: text('primary_language'),
        additional_languages: text('additional_languages'),
        occupation: text('occupation'),
        professional_role: text('professional_role'),
        organization: text('organization'),
        headline: text('headline'),
        bio: text('bio'),
        website: text('website'),
        availability: text('availability'),
        preferred_format: text('preferred_format'),
        teaching_style: text('teaching_style'),
        experience_level: text('experience_level'),
        learning_goal: text('learning_goal'),
        skills_to_teach: text('skills_to_teach'),
        skills_to_learn: text('skills_to_learn'),
        interests: text('interests'),
        profile_color: text('profile_color')
      },
      preferences: {
        match_visibility: fields.get('match_visibility') === 'on',
        show_location: fields.get('show_location') === 'on',
        email_notifications: fields.get('email_notifications') === 'on',
        weekly_digest: fields.get('weekly_digest') === 'on',
        profile_visibility: text('profile_visibility') || 'public'
      },
      safety: {
        guardian_name: text('guardian_name'),
        guardian_email: text('guardian_email'),
        guardian_relationship: text('guardian_relationship'),
        guardian_consent_declared: fields.get('guardian_consent_declared') === 'on'
      }
    };
  }

  function ageFromDateOfBirth(value) {
    const birthDate = new Date(`${value}T12:00:00`);
    if (Number.isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const beforeBirthday = today.getMonth() < birthDate.getMonth() ||
      today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate();
    if (beforeBirthday) age -= 1;
    return age;
  }

  function setupStudentSafetyFields(form, existingSafety = null) {
    const dateInput = form.elements.date_of_birth;
    const ageInput = form.elements.age;
    const section = form.querySelector('.student-safety-section');
    if (!dateInput || !ageInput || !section) return;
    const guardianFields = ['guardian_name', 'guardian_email', 'guardian_relationship'];
    const update = () => {
      const calculatedAge = ageFromDateOfBirth(dateInput.value);
      if (calculatedAge !== null && calculatedAge >= 13 && calculatedAge <= 120) {
        ageInput.value = String(calculatedAge);
      }
      const age = calculatedAge ?? Number(ageInput.value || 0);
      const isMinor = age >= 13 && age < 18;
      section.hidden = !isMinor;
      guardianFields.forEach(name => {
        if (form.elements[name]) form.elements[name].required = isMinor;
      });
      if (form.elements.guardian_consent_declared) form.elements.guardian_consent_declared.required = isMinor;
      const privateOption = form.querySelector('[name="profile_visibility"][value="private"]');
      const publicOption = form.querySelector('[name="profile_visibility"][value="public"]');
      if (isMinor) {
        if (privateOption) privateOption.checked = true;
        if (publicOption) publicOption.disabled = true;
        if (form.elements.show_location) {
          form.elements.show_location.checked = false;
          form.elements.show_location.disabled = true;
        }
      } else {
        if (publicOption) publicOption.disabled = false;
        if (form.elements.show_location) form.elements.show_location.disabled = false;
      }
    };
    if (existingSafety) {
      Object.entries(existingSafety).forEach(([name, value]) => setFormValue(form, name, value));
    }
    dateInput.addEventListener('change', update);
    ageInput.addEventListener('change', update);
    update();
  }

  async function uploadProfilePhoto(file) {
    const body = new FormData();
    body.append('profile_photo', file);
    return api('/api/profile/photo', {
      method: 'POST',
      body
    });
  }

  function setupPhotoPreview(input, preview) {
    if (!input || !preview) return;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4_000_000) {
        input.value = '';
        toast('Choose a JPG, PNG, or WebP image no larger than 4 MB.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        preview.innerHTML = `<img src="${reader.result}" alt="Selected profile photo preview">`;
      });
      reader.readAsDataURL(file);
    });
  }

  function setupRegistrationPage() {
    const form = $('#registrationForm');
    if (!form) return;
    const photoInput = $('#registrationPhoto');
    setupPhotoPreview(photoInput, $('#registrationPhotoPreview'));
    setupStudentSafetyFields(form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(form);
      const fields = new FormData(form);
      if (fields.get('password') !== fields.get('confirm_password')) {
        setStatus(form, 'The password confirmation does not match.', 'error');
        $('#registrationConfirm')?.focus();
        return;
      }
      const submit = $('button[type="submit"]', form);
      loading(submit, true, 'Creating account');
      try {
        const result = await api('/api/auth/register', {
          method: 'POST',
          body: registrationPayload(form)
        });
        state.user = result.user;
        if (photoInput?.files?.[0]) {
          const photoResult = await uploadProfilePhoto(photoInput.files[0]);
          state.user = photoResult.user;
        }
        setStatus(form, 'Your member account and profile have been created. Opening your dashboard…',
        'success');
        setTimeout(() => {
          location.href = 'dashboard.html';
        }, 520);
      } catch (error) {
        setStatus(form, error.message, 'error');
        loading(submit, false);
      }
    });
  }

  function setFormValue(form, name, value) {
    const input = form.elements[name];
    if (!input) return;
    if (typeof RadioNodeList !== 'undefined' && input instanceof RadioNodeList) {
      [...input].forEach(option => {
        option.checked = option.value === String(value);
      });
    } else if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = Array.isArray(value) ? value.join(', ') : (value ?? '');
  }

  function profilePayload(form) {
    const data = new FormData(form);
    const text = name => String(data.get(name) || '').trim();
    return {
      profile: {
        first_name: text('first_name'),
        last_name: text('last_name'),
        display_name: text('display_name'),
        pronouns: text('pronouns'),
        date_of_birth: text('date_of_birth'),
        age: text('age'),
        country: text('country'),
        city: text('city'),
        timezone: text('timezone'),
        primary_language: text('primary_language'),
        additional_languages: text('additional_languages'),
        occupation: text('occupation'),
        professional_role: text('professional_role'),
        organization: text('organization'),
        headline: text('headline'),
        bio: text('bio'),
        website: text('website'),
        availability: text('availability'),
        preferred_format: text('preferred_format'),
        teaching_style: text('teaching_style'),
        experience_level: text('experience_level'),
        learning_goal: text('learning_goal'),
        skills_to_teach: text('skills_to_teach'),
        skills_to_learn: text('skills_to_learn'),
        interests: text('interests'),
        profile_color: text('profile_color')
      },
      preferences: {
        match_visibility: form.elements.match_visibility.checked,
        show_location: form.elements.show_location.checked,
        email_notifications: form.elements.email_notifications.checked,
        weekly_digest: form.elements.weekly_digest.checked,
        profile_visibility: text('profile_visibility') || 'public',
        theme: text('theme') || 'light',
        font_scale: text('font_scale') || 'default',
        content_density: text('content_density') || 'comfortable',
        navigation_style: text('navigation_style') || 'expanded',
        default_landing: text('default_landing') || 'dashboard',
        high_contrast: Boolean(form.elements.high_contrast?.checked),
        reduced_motion: Boolean(form.elements.reduced_motion?.checked),
        link_underlines: Boolean(form.elements.link_underlines?.checked),
        focus_mode: Boolean(form.elements.focus_mode?.checked),
        show_ai_assistant: form.elements.show_ai_assistant?.checked !== false,
        auto_play_testimonials: form.elements.auto_play_testimonials?.checked !== false
      },
      safety: {
        guardian_name: text('guardian_name'),
        guardian_email: text('guardian_email'),
        guardian_relationship: text('guardian_relationship'),
        guardian_consent_declared: Boolean(form.elements.guardian_consent_declared?.checked)
      }
    };
  }

  function renderProfileSummary(user) {
    const avatar = $('[data-profile-avatar]');
    setAvatar(avatar, user);
    setAvatar($('#profilePhotoPreview'), user, 'profile-photo-preview');
    $('[data-profile-name]').textContent = user.profile.display_name;
    $('[data-profile-handle]').textContent = `@${user.username} · ${user.profile.country}`;
    $('[data-profile-role]').textContent = user.role;
    $('[data-profile-credits]').textContent = user.time_credits ?? 0;
    $('[data-profile-skills]').textContent = list(user.profile.skills_to_teach).length + list(user.profile
      .skills_to_learn).length;
  }

  function setupProfilePhotoControls() {
    const input = $('#profilePhotoInput');
    const preview = $('#profilePhotoPreview');
    const uploadButton = $('#profilePhotoUpload');
    const removeButton = $('#profilePhotoRemove');
    const status = $('#profilePhotoStatus');
    setupPhotoPreview(input, preview);
    uploadButton?.addEventListener('click', async () => {
      const file = input?.files?.[0];
      if (!file) {
        status.textContent = 'Choose an image before uploading.';
        status.className = 'form-status show error';
        return;
      }
      loading(uploadButton, true, 'Uploading');
      try {
        const result = await uploadProfilePhoto(file);
        state.user = result.user;
        renderProfileSummary(state.user);
        renderAccountNavigation();
        refreshNotificationBadge();
        status.textContent = 'Profile photo uploaded and applied throughout SwapLabs.';
        status.className = 'form-status show success';
        input.value = '';
      } catch (error) {
        status.textContent = error.message;
        status.className = 'form-status show error';
      } finally {
        loading(uploadButton, false);
      }
    });
    removeButton?.addEventListener('click', async () => {
      if (!safeAvatarUrl(state.user)) {
        status.textContent = 'Your profile is already using initials.';
        status.className = 'form-status show info';
        return;
      }
      if (!confirm('Remove your current profile photo and use initials instead?')) return;
      loading(removeButton, true, 'Removing');
      try {
        const result = await api('/api/profile/photo', {
          method: 'DELETE'
        });
        state.user = result.user;
        renderProfileSummary(state.user);
        renderAccountNavigation();
        refreshNotificationBadge();
        status.textContent = 'Profile photo removed. Your initials are now shown.';
        status.className = 'form-status show success';
      } catch (error) {
        status.textContent = error.message;
        status.className = 'form-status show error';
      } finally {
        loading(removeButton, false);
      }
    });
  }

  function renderPrivacyData(payload) {
    const form = $('#privacyDataForm');
    if (!form) return;
    Object.entries(payload.preferences || {}).forEach(([name, value]) => setFormValue(form, name, value));
    const counts = payload.counts || {};
    const values = [
      [counts.messages || 0, 'Messages'],
      [counts.calendar_events || 0, 'Sessions'],
      [counts.ledger_entries || 0, 'Ledger records'],
      [counts.ideas || 0, 'Ideas']
    ];
    const countHost = $('#privacyDataCounts');
    if (countHost) countHost.innerHTML = values.map(([value, label]) =>
      `<div><strong>${Number(value).toLocaleString()}</strong><span>${escapeHtml(label)}</span></div>`).join('');
    const schedule = payload.schedule || {};
    const messageCutoff = schedule.messages_cleanup_before ? formatDate(schedule.messages_cleanup_before) :
      'kept until account deletion';
    const sessionCutoff = schedule.session_history_cleanup_before ? formatDate(schedule
      .session_history_cleanup_before) : 'kept until account deletion';
    const note = $('#privacyRetentionNote');
    if (note) note.innerHTML =
      `<i class="bx bx-info-circle"></i><span>Message cutoff: <strong>${escapeHtml(messageCutoff)}</strong>. Session cutoff: <strong>${escapeHtml(sessionCutoff)}</strong>. Ledger and essential safety records are retained or pseudonymized where required.</span>`;
  }

  async function loadPrivacyData() {
    const result = await api('/api/account/privacy');
    renderPrivacyData(result);
    return result;
  }

  function setupPrivacyDataControls() {
    const form = $('#privacyDataForm');
    if (!form) return;
    loadPrivacyData().catch(error => setStatus(form, error.message, 'error'));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(form);
      const fields = new FormData(form);
      const button = $('button[type="submit"]', form);
      loading(button, true, 'Saving privacy');
      try {
        const result = await api('/api/account/privacy', {
          method: 'PATCH',
          body: {
            data_retention: fields.get('data_retention'),
            message_retention: fields.get('message_retention'),
            session_history_retention: fields.get('session_history_retention'),
            allow_research_analytics: fields.get('allow_research_analytics') === 'on'
          }
        });
        state.user.preferences = result.preferences;
        await loadPrivacyData();
        setStatus(form, 'Privacy and retention choices saved to your account.', 'success');
        toast('Privacy controls saved.');
      } catch (error) {
        setStatus(form, error.message, 'error');
      } finally {
        loading(button, false);
      }
    });
    $('#privacyCleanupButton')?.addEventListener('click', async event => {
      if (!confirm('Apply your saved retention rules now? Eligible old activity cannot be restored.')) return;
      const button = event.currentTarget;
      loading(button, true, 'Cleaning up');
      clearStatus(form);
      try {
        const result = await api('/api/account/privacy/cleanup', {
          method: 'POST'
        });
        await loadPrivacyData();
        const total = Object.values(result.removed || {}).reduce((sum, value) => sum + Number(value || 0), 0);
        setStatus(form, `${total} eligible record${total === 1 ? '' : 's'} cleaned up under your retention settings.`,
          'success');
      } catch (error) {
        setStatus(form, error.message, 'error');
      } finally {
        loading(button, false);
      }
    });

    const deletionForm = $('#accountDeletionForm');
    if (!deletionForm) return;
    if (state.user.role === 'admin') {
      deletionForm.hidden = true;
      return;
    }
    const expected = `DELETE ${state.user.username}`;
    $('#accountDeletionPrompt').textContent = `Confirmation phrase: ${expected}`;
    $('#accountDeletionConfirmation').placeholder = expected;
    deletionForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!confirm('Permanently delete your SwapLabs account? This cannot be undone.')) return;
      clearStatus(deletionForm);
      const fields = new FormData(deletionForm);
      const button = $('button[type="submit"]', deletionForm);
      loading(button, true, 'Deleting account');
      try {
        const result = await api('/api/account', {
          method: 'DELETE',
          body: {
            password: fields.get('password'),
            confirmation: fields.get('confirmation')
          }
        });
        sessionStorage.setItem('swaplabs-access-notice', result.message);
        location.replace('swaplabs.html');
      } catch (error) {
        setStatus(deletionForm, error.message, 'error');
        loading(button, false);
      }
    });
  }

  function setupProfilePage() {
    const loadingPanel = $('#profileLoading');
    const locked = $('#profileLocked');
    const panel = $('#profilePanel');
    if (!loadingPanel) return;
    loadingPanel.hidden = true;
    if (!state.user) {
      locked.hidden = false;
      return;
    }
    panel.hidden = false;
    if (location.hash) {
      const anchor = document.getElementById(location.hash.slice(1));
      if (anchor) requestAnimationFrame(() => setTimeout(() => anchor.scrollIntoView({
        block: 'start'
      }), 40));
    }
    const form = $('#profileForm');
    setFormValue(form, 'username', state.user.username);
    setFormValue(form, 'email', state.user.email);
    Object.entries(state.user.profile).forEach(([name, value]) => setFormValue(form, name, value));
    Object.entries(state.user.preferences).forEach(([name, value]) => setFormValue(form, name, value));
    setupStudentSafetyFields(form, state.user.safety || {});
    const safetySection = $('#student-safety');
    const isMinor = Boolean(state.user.safety?.is_minor);
    if (safetySection) safetySection.hidden = !isMinor;
    const safetyLink = $('.profile-nav a[href="#student-safety"]');
    if (safetyLink) safetyLink.hidden = !isMinor;
    const consentStatus = $('#guardianConsentStatus');
    if (consentStatus && isMinor) {
      const status = state.user.safety?.guardian_consent_status || 'pending';
      consentStatus.textContent = `Guardian consent: ${status.replaceAll('_', ' ')}`;
      consentStatus.className = `guardian-status ${status}`;
    }
    const previewPreferences = () => window.SwapLabsPreferences?.apply(profilePayload(form).preferences);
    ['theme', 'font_scale', 'content_density', 'navigation_style', 'high_contrast', 'reduced_motion',
      'link_underlines', 'focus_mode', 'show_ai_assistant', 'auto_play_testimonials'
    ].forEach(name => {
      const field = form.elements[name];
      if (typeof RadioNodeList !== 'undefined' && field instanceof RadioNodeList)[...field].forEach(option =>
        option.addEventListener('change', previewPreferences));
      else field?.addEventListener('change', previewPreferences);
    });
    renderProfileSummary(state.user);
    setupProfilePhotoControls();
    setupPrivacyDataControls();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(form);
      const submit = $('button[type="submit"]', form);
      loading(submit, true, 'Saving profile');
      try {
        const result = await api('/api/profile', {
          method: 'PATCH',
          body: profilePayload(form)
        });
        state.user = result.user;
        window.SwapLabsPreferences?.apply(state.user.preferences || {});
        renderProfileSummary(state.user);
        if ($('#guardianConsentStatus') && state.user.safety?.is_minor) {
          const status = state.user.safety.guardian_consent_status || 'pending';
          $('#guardianConsentStatus').textContent = `Guardian consent: ${status.replaceAll('_', ' ')}`;
          $('#guardianConsentStatus').className = `guardian-status ${status}`;
        }
        renderAccountNavigation();
        renderMemberContext();
        refreshNotificationBadge();
        setStatus(form, 'All profile changes were saved and are now used across SwapLabs.', 'success');
        toast('Profile changes saved across the website.');
      } catch (error) {
        setStatus(form, error.message, 'error');
      } finally {
        loading(submit, false);
      }
    });
    const passwordForm = $('#passwordForm');
    passwordForm.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(passwordForm);
      const submit = $('button[type="submit"]', passwordForm);
      loading(submit, true, 'Updating');
      try {
        const data = new FormData(passwordForm);
        await api('/api/profile/password', {
          method: 'POST',
          body: {
            current_password: data.get('current_password'),
            new_password: data.get('new_password')
          }
        });
        passwordForm.reset();
        setStatus(passwordForm, 'Your password has been updated.', 'success');
      } catch (error) {
        setStatus(passwordForm, error.message, 'error');
      } finally {
        loading(submit, false);
      }
    });
  }

  function userSearchText(user) {
    return [user.username, user.email, user.profile.display_name, user.profile.country, user.profile.city,
        user.profile.occupation, user.profile.professional_role, user.profile.primary_language,
        ...list(user.profile.additional_languages), ...list(user.profile.interests),
        ...list(user.profile.skills_to_teach), ...list(user.profile.skills_to_learn)
      ]
      .join(' ').toLowerCase();
  }

  function renderAdminStats(stats) {
    const mapping = {
      statTotal: 'total',
      statMembers: 'members',
      statActive: 'active',
      statSuspended: 'suspended',
      statVerified: 'verified',
      statCredits: 'credits'
    };
    Object.entries(mapping).forEach(([id, key]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = Number(stats[key] || 0).toLocaleString();
    });
  }

  const chartColors = ['#5d5fef', '#d56b9f', '#4b83f5', '#8b5cf6', '#21856a', '#f59e0b', '#667085', '#b54708',
    '#7f56d9', '#0e9384'
  ];
  const countValues = values => {
    const counts = new Map();
    values.filter(value => value !== undefined && value !== null && String(value).trim()).forEach(value => {
      const label = String(value).trim();
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()].map(([label, value]) => ({
      label,
      value
    })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  };
  const prepareCanvas = id => {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const width = Math.max(280, canvas.parentElement.clientWidth - 36);
    const height = Number(canvas.getAttribute('height')) || 240;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = '11px Inter, system-ui, sans-serif';
    context.textBaseline = 'middle';
    return {
      canvas,
      context,
      width,
      height
    };
  };
  const renderChartData = (id, data) => {
    const host = document.getElementById(id);
    if (!host) return;
    host.innerHTML = data.map(item =>
        `<span>${escapeHtml(item.label)} <strong>${Number(item.value).toLocaleString()}</strong></span>`).join(
      '') || '<span>No saved values</span>';
  };
  const renderLegend = (id, data) => {
    const host = document.getElementById(id);
    if (!host) return;
    host.innerHTML = data.map((item, index) =>
      `<span><i style="background:${chartColors[index % chartColors.length]}"></i>${escapeHtml(item.label)} · ${item.value}</span>`
      ).join('');
  };

  function drawDoughnut(id, data, legendId) {
    const prepared = prepareCanvas(id);
    if (!prepared) return;
    const {
      context,
      width,
      height
    } = prepared;
    const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
    const radius = Math.min(width, height) * .31;
    const inner = radius * .62;
    let angle = -Math.PI / 2;
    data.forEach((item, index) => {
      const slice = item.value / total * Math.PI * 2;
      context.beginPath();
      context.arc(width / 2, height / 2, radius, angle, angle + slice);
      context.arc(width / 2, height / 2, inner, angle + slice, angle, true);
      context.closePath();
      context.fillStyle = chartColors[index % chartColors.length];
      context.fill();
      angle += slice;
    });
    context.fillStyle = '#101828';
    context.textAlign = 'center';
    context.font = '700 24px Inter, system-ui, sans-serif';
    context.fillText(String(total), width / 2, height / 2 - 7);
    context.fillStyle = '#667085';
    context.font = '11px Inter, system-ui, sans-serif';
    context.fillText('accounts', width / 2, height / 2 + 16);
    renderLegend(legendId, data);
  }

  function drawBarChart(id, data, horizontal = false) {
    const prepared = prepareCanvas(id);
    if (!prepared) return;
    const {
      context,
      width,
      height
    } = prepared;
    const shown = data.slice(0, horizontal ? 9 : 10);
    const maximum = Math.max(1, ...shown.map(item => item.value));
    const left = horizontal ? Math.min(135, width * .35) : 38;
    const right = 16;
    const top = 12;
    const bottom = horizontal ? 15 : 58;
    context.strokeStyle = '#e4e7ec';
    context.lineWidth = 1;
    if (horizontal) {
      const row = (height - top - bottom) / Math.max(shown.length, 1);
      shown.forEach((item, index) => {
        const y = top + index * row + row * .16;
        const barHeight = Math.max(7, row * .56);
        const barWidth = (width - left - right) * item.value / maximum;
        context.fillStyle = '#667085';
        context.textAlign = 'right';
        context.font = '10px Inter, system-ui, sans-serif';
        const label = item.label.length > 19 ? `${item.label.slice(0, 18)}…` : item.label;
        context.fillText(label, left - 8, y + barHeight / 2);
        context.fillStyle = chartColors[index % chartColors.length];
        context.fillRect(left, y, barWidth, barHeight);
        context.fillStyle = '#344054';
        context.textAlign = 'left';
        context.fillText(String(item.value), Math.min(width - 14, left + barWidth + 6), y + barHeight / 2);
      });
    } else {
      const chartHeight = height - top - bottom;
      const column = (width - left - right) / Math.max(shown.length, 1);
      context.beginPath();
      context.moveTo(left, top + chartHeight);
      context.lineTo(width - right, top + chartHeight);
      context.stroke();
      shown.forEach((item, index) => {
        const barWidth = Math.max(8, column * .58);
        const barHeight = chartHeight * item.value / maximum;
        const x = left + index * column + (column - barWidth) / 2;
        const y = top + chartHeight - barHeight;
        context.fillStyle = chartColors[index % chartColors.length];
        context.fillRect(x, y, barWidth, barHeight);
        context.fillStyle = '#344054';
        context.textAlign = 'center';
        context.font = '10px Inter, system-ui, sans-serif';
        context.fillText(String(item.value), x + barWidth / 2, Math.max(7, y - 8));
        context.save();
        context.translate(x + barWidth / 2, top + chartHeight + 9);
        context.rotate(-.45);
        const label = item.label.length > 13 ? `${item.label.slice(0, 12)}…` : item.label;
        context.fillStyle = '#667085';
        context.textAlign = 'right';
        context.fillText(label, 0, 0);
        context.restore();
      });
    }
  }

  function drawLineChart(id, data) {
    const prepared = prepareCanvas(id);
    if (!prepared) return;
    const {
      context,
      width,
      height
    } = prepared;
    const left = 42,
      right = 18,
      top = 20,
      bottom = 42;
    const maximum = Math.max(1, ...data.map(item => item.value));
    context.strokeStyle = '#e4e7ec';
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
      const y = top + (height - top - bottom) * index / 4;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
    }
    const points = data.map((item, index) => ({
      x: data.length === 1 ? width / 2 : left + (width - left - right) * index / (data.length - 1),
      y: top + (height - top - bottom) * (1 - item.value / maximum),
      item
    }));
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.strokeStyle = '#5d5fef';
    context.lineWidth = 3;
    context.stroke();
    points.forEach(point => {
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fillStyle = '#fff';
      context.fill();
      context.strokeStyle = '#5d5fef';
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = '#667085';
      context.textAlign = 'center';
      context.font = '10px Inter, system-ui, sans-serif';
      context.fillText(point.item.label, point.x, height - 17);
      context.fillStyle = '#101828';
      context.font = '700 10px Inter, system-ui, sans-serif';
      context.fillText(String(point.item.value), point.x, point.y - 13);
    });
  }

  function renderAdminCharts() {
    if (!$('#chartStatus') || !state.adminUsers.length) return;
    const users = state.adminUsers;
    const statuses = countValues(users.map(user => user.status));
    const visibility = countValues(users.map(user => user.preferences?.profile_visibility || 'public'));
    const ageBands = [{
        label: '13–17',
        min: 13,
        max: 17
      }, {
        label: '18–24',
        min: 18,
        max: 24
      },
      {
        label: '25–34',
        min: 25,
        max: 34
      }, {
        label: '35–44',
        min: 35,
        max: 44
      },
      {
        label: '45–54',
        min: 45,
        max: 54
      }, {
        label: '55–64',
        min: 55,
        max: 64
      },
      {
        label: '65+',
        min: 65,
        max: 120
      }
    ].map(band => ({
      label: band.label,
      value: users.filter(user => Number(user.profile.age) >= band.min && Number(user.profile.age) <= band.max)
        .length
    }));
    const countries = countValues(users.map(user => user.profile.country || 'Not set'));
    const languages = countValues(users.map(user => user.profile.primary_language || 'Not set'));
    const credits = [{
        label: '0–5',
        min: 0,
        max: 5
      }, {
        label: '6–10',
        min: 6,
        max: 10
      }, {
        label: '11–20',
        min: 11,
        max: 20
      },
      {
        label: '21–50',
        min: 21,
        max: 50
      }, {
        label: '51+',
        min: 51,
        max: Infinity
      }
    ].map(band => ({
      label: band.label,
      value: users.filter(user => Number(user.time_credits || 0) >= band.min && Number(user.time_credits ||
        0) <= band.max).length
    }));
    const occupations = countValues(users.flatMap(user => [user.profile.occupation, user.profile.professional_role]));
    const skills = countValues(users.flatMap(user => [...list(user.profile.skills_to_teach), ...list(user.profile
      .skills_to_learn)]));
    const monthly = countValues(users.map(user => {
      const date = new Date(user.created_at);
      return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        year: 'numeric'
      }).format(date);
    })).sort((a, b) => {
      const parse = label => new Date(`1 ${label}`).getTime() || 0;
      return parse(a.label) - parse(b.label);
    });
    let cumulative = 0;
    const growth = monthly.map(item => ({
      label: item.label,
      value: (cumulative += item.value)
    }));
    drawDoughnut('chartStatus', statuses, 'legendStatus');
    drawDoughnut('chartVisibility', visibility, 'legendVisibility');
    drawBarChart('chartAges', ageBands);
    drawBarChart('chartCountries', countries, true);
    drawBarChart('chartLanguages', languages);
    drawBarChart('chartCredits', credits);
    drawBarChart('chartOccupations', occupations, true);
    drawBarChart('chartSkills', skills, true);
    drawLineChart('chartGrowth', growth);
    renderChartData('dataAges', ageBands);
    renderChartData('dataCountries', countries);
    renderChartData('dataLanguages', languages);
    renderChartData('dataCredits', credits);
    renderChartData('dataOccupations', occupations);
    renderChartData('dataSkills', skills);
    renderChartData('dataGrowth', growth);
  }

  function filteredAdminUsers() {
    const query = ($('#adminSearch')?.value || '').trim().toLowerCase();
    const status = $('#adminStatusFilter')?.value || 'all';
    const role = $('#adminRoleFilter')?.value || 'all';
    return state.adminUsers.filter(user => (!query || userSearchText(user).includes(query)) && (status === 'all' ||
      user.status === status) && (role === 'all' || user.role === role));
  }

  function renderAdminRows() {
    const rows = $('#adminUserRows');
    if (!rows) return;
    const users = filteredAdminUsers();
    $('#adminResultCount').textContent = `${users.length} record${users.length === 1 ? '' : 's'}`;
    rows.innerHTML = users.map(user =>
        `<tr class="${state.selectedUserId === user.id ? 'selected' : ''}" data-user-row="${escapeHtml(user.id)}"><td><div class="table-user">${avatarHtml(user)}<div><strong>${escapeHtml(user.profile.display_name)}</strong><span>@${escapeHtml(user.username)} · ${escapeHtml(user.email)}</span></div></div></td><td><span class="status-pill ${escapeHtml(user.role)}">${escapeHtml(user.role)}</span></td><td><span class="status-pill ${escapeHtml(user.status)}">${escapeHtml(user.status)}</span></td><td>${escapeHtml([user.profile.city, user.profile.country].filter(Boolean).join(', ') || 'Not set')}</td><td>${Number(user.time_credits || 0)}</td><td>${escapeHtml(formatDate(user.updated_at))}</td><td><button class="table-action" type="button" data-view-user="${escapeHtml(user.id)}">View</button></td></tr>`
        ).join('') ||
      '<tr><td colspan="7" style="text-align:center;padding:35px">No accounts match these filters.</td></tr>';
    $$('[data-view-user]', rows).forEach(button => button.addEventListener('click', () => selectAdminUser(button
      .dataset.viewUser)));
    $$('[data-user-row]', rows).forEach(row => row.addEventListener('dblclick', () => selectAdminUser(row.dataset
      .userRow)));
  }

  function detailPairs(object) {
    return Object.entries(object).map(([key, value]) =>
      `<div><dt>${escapeHtml(key.replaceAll('_', ' '))}</dt><dd>${escapeHtml(Array.isArray(value) ? value.join(', ') || 'None' : (value === true ? 'Yes' : value === false ? 'No' : value || 'Not set'))}</dd></div>`
      ).join('');
  }

  function suspensionMinutes(fields) {
    const amount = Math.max(1, Number(fields.get('suspension_amount') || 1));
    const factors = {
      minutes: 1,
      hours: 60,
      days: 1440,
      weeks: 10080
    };
    return Math.round(amount * (factors[fields.get('suspension_unit')] || 1440));
  }

  function suspensionControls(user) {
    const deadline = user.suspended_until ? formatDate(user.suspended_until) : 'No active suspension deadline';
    return `<div class="admin-suspension-fields" data-suspension-fields ${user.status === 'suspended' ? '' : 'hidden'}>
      <div class="field"><label>Suspension length</label><input name="suspension_amount" type="number" min="1" max="365" value="1"></div>
      <div class="field"><label>Duration unit</label><select name="suspension_unit"><option value="hours">Hours</option><option value="days" selected>Days</option><option value="weeks">Weeks</option><option value="minutes">Minutes</option></select></div>
      <div class="field full"><label>Suspension reason</label><input name="suspension_reason" maxlength="1000" value="${escapeHtml(user.suspension_reason || '')}" placeholder="Explain why access is being suspended"></div>
      <p class="admin-suspension-deadline"><i class="bx bx-time-five"></i> Current access deadline: ${escapeHtml(deadline)}. Saving a suspension sets a new deadline from now.</p>
    </div>`;
  }

  function selectAdminUser(userId) {
    state.selectedUserId = userId;
    renderAdminRows();
    const user = state.adminUsers.find(candidate => candidate.id === userId);
    const detail = $('#adminDetail');
    if (!user || !detail) return;
    const safetyPanel = user.safety?.is_minor ? `<form id="guardianReviewForm" class="detail-section student-review-panel">
      <div class="student-review-heading"><div><span class="eyebrow"><i class="bx bx-shield-quarter"></i> Student safeguarding</span><h3>Guardian consent review</h3></div><span class="guardian-status ${escapeHtml(user.safety.guardian_consent_status || 'pending')}">${escapeHtml((user.safety.guardian_consent_status || 'pending').replaceAll('_', ' '))}</span></div>
      <dl class="detail-list">${detailPairs({student_age_group: Number(user.profile.age) <= 15 ? '13–15' : '16–17', guardian_name: user.safety.guardian_name, guardian_email: user.safety.guardian_email, guardian_relationship: user.safety.guardian_relationship, consent_declared: user.safety.guardian_consent_declared, messaging_rule: user.safety.minor_messaging, innovation_access: user.safety.innovation_access, verified_at: formatDate(user.safety.guardian_verified_at)})}</dl>
      <div class="admin-control-grid"><div class="field"><label>Consent decision</label><select name="status"><option value="pending" ${user.safety.guardian_consent_status === 'pending' ? 'selected' : ''}>Pending review</option><option value="verified" ${user.safety.guardian_consent_status === 'verified' ? 'selected' : ''}>Verified</option><option value="rejected" ${user.safety.guardian_consent_status === 'rejected' ? 'selected' : ''}>Rejected</option></select></div><div class="field full"><label>Specialist guardian-review notes</label><textarea name="guardian_notes" maxlength="2000">${escapeHtml(user.safety.guardian_notes || '')}</textarea></div></div>
      <div class="form-actions end"><button class="btn btn-primary" type="submit"><i class="bx bx-shield-quarter"></i> Save guardian review</button></div><div class="form-status" data-status></div>
    </form>` : '';
    detail.innerHTML = `<div class="admin-detail-header"><div class="admin-detail-user">${avatarHtml(user)}<div><h2>${escapeHtml(user.profile.display_name)}</h2><p>@${escapeHtml(user.username)} · ${escapeHtml(user.email)}</p></div></div></div><div class="admin-detail-body">
      <section class="detail-section"><h3>Account record</h3><dl class="detail-list">${detailPairs({id: user.id, username: user.username, email: user.email, role: user.role, status: user.status, suspended_until: formatDate(user.suspended_until), suspension_reason: user.suspension_reason, verified: user.verified, time_credits: user.time_credits, moderation_label: user.moderation_label, created_at: formatDate(user.created_at), updated_at: formatDate(user.updated_at), last_login_at: formatDate(user.last_login_at), terms_accepted_at: formatDate(user.terms_accepted_at)})}</dl></section>
      <section class="detail-section"><h3>Complete profile</h3><dl class="detail-list">${detailPairs(user.profile)}</dl></section>
      <section class="detail-section"><h3>Member preferences</h3><dl class="detail-list">${detailPairs(user.preferences)}</dl></section>
      ${safetyPanel}
      <form id="adminControlForm" class="detail-section"><h3>Administrative annotation and control</h3><div class="admin-control-grid"><div class="field"><label>Status</label><select name="status"><option value="active" ${user.status === 'active' ? 'selected' : ''}>Active</option><option value="suspended" ${user.status === 'suspended' ? 'selected' : ''}>Suspended</option></select></div><div class="field"><label>Moderation label</label><select name="moderation_label"><option value="none" ${user.moderation_label === 'none' ? 'selected' : ''}>None</option><option value="review" ${user.moderation_label === 'review' ? 'selected' : ''}>Needs review</option><option value="trusted" ${user.moderation_label === 'trusted' ? 'selected' : ''}>Trusted</option><option value="warning" ${user.moderation_label === 'warning' ? 'selected' : ''}>Warning</option></select></div><div class="field"><label>Time credits</label><input name="time_credits" type="number" min="0" max="100000" value="${Number(user.time_credits || 0)}"></div><label class="check-row"><input name="verified" type="checkbox" ${user.verified ? 'checked' : ''}><span><strong>Verified profile</strong><span>Show the verified account marker.</span></span></label>${suspensionControls(user)}<div class="field full"><label>Private administrator notes</label><textarea name="admin_notes" maxlength="2000" placeholder="Only administrators can see these notes.">${escapeHtml(user.admin_notes || '')}</textarea></div></div><div class="form-actions end"><button class="btn btn-primary" type="submit"><i class="bx bx-save"></i> Save account controls</button></div><div class="form-status" data-status></div></form>
      ${user.role === 'admin' ? '<section class="detail-section"><div class="account-security-note"><i class="bx bx-shield-quarter"></i><div><strong>Protected administrator</strong><span>The primary administrator cannot be suspended or deleted.</span></div></div></section>' : `<section class="detail-section"><div class="danger-box"><strong>Permanent account deletion</strong><p>Deletes this member record and cannot be reversed from the dashboard.</p><button class="btn btn-danger btn-sm" id="adminDeleteUser" type="button"><i class="bx bx-trash"></i> Delete member account</button></div></section>`}
    </div>`;
    $('#adminControlForm')?.addEventListener('submit', saveAdminControls);
    $('#guardianReviewForm')?.addEventListener('submit', saveGuardianReview);
    $('#adminControlForm [name="status"]')?.addEventListener('change', event => {
      const fields = $('[data-suspension-fields]', $('#adminControlForm'));
      if (fields) fields.hidden = event.currentTarget.value !== 'suspended';
    });
    $('#adminDeleteUser')?.addEventListener('click', deleteAdminUser);
  }

  async function saveGuardianReview(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const button = $('button[type="submit"]', form);
    loading(button, true, 'Saving review');
    clearStatus(form);
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(state.selectedUserId)}/guardian-consent`, {
        method: 'PATCH',
        body: {
          status: fields.get('status'),
          guardian_notes: fields.get('guardian_notes')
        }
      });
      const index = state.adminUsers.findIndex(user => user.id === result.user.id);
      if (index >= 0) state.adminUsers[index] = result.user;
      setStatus(form, 'Guardian consent review saved and the student was notified.', 'success');
      toast('Student safeguarding review saved.');
      await loadAdminData(true);
    } catch (error) {
      setStatus(form, error.message, 'error');
      loading(button, false);
    }
  }

  async function saveAdminControls(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const submit = $('button[type="submit"]', form);
    loading(submit, true, 'Saving controls');
    clearStatus(form);
    try {
      const payload = {
        status: data.get('status'),
        moderation_label: data.get('moderation_label'),
        time_credits: Number(data.get('time_credits')),
        verified: data.get('verified') === 'on',
        admin_notes: data.get('admin_notes')
      };
      if (payload.status === 'suspended') {
        payload.suspension_minutes = suspensionMinutes(data);
        payload.suspension_reason = data.get('suspension_reason');
      }
      const result = await api(`/api/admin/users/${encodeURIComponent(state.selectedUserId)}`, {
        method: 'PATCH',
        body: payload
      });
      const index = state.adminUsers.findIndex(user => user.id === result.user.id);
      if (index >= 0) state.adminUsers[index] = result.user;
      setStatus(form, 'Account controls and private annotation saved.', 'success');
      toast('Administrator changes saved.');
      await loadAdminData(true);
    } catch (error) {
      setStatus(form, error.message, 'error');
      loading(submit, false);
    }
  }

  async function deleteAdminUser() {
    const user = state.adminUsers.find(candidate => candidate.id === state.selectedUserId);
    if (!user || !confirm(
        `Permanently delete ${user.profile.display_name}'s member account? This cannot be undone.`)) return;
    const button = $('#adminDeleteUser');
    loading(button, true, 'Deleting');
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'DELETE'
      });
      state.selectedUserId = null;
      toast(result.message);
      await loadAdminData();
      $('#adminDetail').innerHTML =
        '<div class="admin-detail-empty"><i class="bx bx-check-circle"></i><strong>Account deleted</strong><p>Select another account to continue.</p></div>';
    } catch (error) {
      toast(error.message, 'error');
      loading(button, false);
    }
  }

  function renderAudit() {
    const host = $('#adminAudit');
    if (!host) return;
    host.innerHTML = state.audit.map(entry =>
      `<article class="audit-item"><i class="bx ${entry.action.includes('deleted') ? 'bx-trash' : entry.action.includes('signed') ? 'bx-log-in-circle' : entry.action.includes('registered') ? 'bx-user-plus' : 'bx-edit-alt'}"></i><div><strong>${escapeHtml(entry.actor_name)} · ${escapeHtml(entry.action.replaceAll('_', ' '))}</strong><p>${escapeHtml(entry.details)}</p></div><time>${escapeHtml(formatDate(entry.created_at))}</time></article>`
      ).join('') || '<div class="admin-detail-empty">No recorded activity.</div>';
  }

  async function loadAdminData(preserveDetail = false) {
    try {
      const result = await api('/api/admin/overview');
      state.adminUsers = result.users;
      state.audit = result.audit_log;
      renderAdminStats(result.stats);
      renderAdminCharts();
      renderAdminRows();
      renderAudit();
      if (preserveDetail && state.selectedUserId) selectAdminUser(state.selectedUserId);
    } catch (error) {
      toast(error.message, 'error');
      if (error.status === 401 || error.status === 403) location.href = 'login.html';
    }
  }

  function setupAdminPage() {
    const gate = $('#adminGate');
    const dashboard = $('#adminDashboard');
    if (!gate) return;
    const loginForm = $('#adminPageLoginForm');
    loginForm?.addEventListener('submit', event => {
      event.preventDefault();
      submitLogin(loginForm, 'admin', 'admin.html');
    });
    if (!state.user) return;
    if (state.user.role !== 'admin') {
      gate.innerHTML =
        '<div class="container"><div class="profile-locked auth-card"><i class="bx bx-shield-x"></i><h2>Administrator access only</h2><p class="muted">Member accounts can view the platform and edit their own profile, but cannot view or annotate administration data.</p><a class="btn" href="profile.html">Return to my profile</a></div></div>';
      return;
    }
    gate.hidden = true;
    dashboard.hidden = false;
    loadAdminData();
    ['adminSearch', 'adminStatusFilter', 'adminRoleFilter'].forEach(id => document.getElementById(id)
      ?.addEventListener(id === 'adminSearch' ? 'input' : 'change', renderAdminRows));
    $('#adminRefresh')?.addEventListener('click', () => loadAdminData(Boolean(state.selectedUserId)));
    $('#adminRedrawCharts')?.addEventListener('click', renderAdminCharts);
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderAdminCharts, 180);
    });
  }

  function communitySearchText(user) {
    const profile = user.profile || {};
    return [
      user.username, profile.display_name, profile.full_name, profile.headline, profile.professional_role,
      profile.occupation, profile.organization, profile.country, profile.city, profile.primary_language,
      ...list(profile.additional_languages), ...list(profile.skills_to_teach), ...list(profile.skills_to_learn),
      ...list(profile.interests)
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function communityRelationshipAction(user, compact = false) {
    if (user.relationship === 'self')
    return `<a class="btn btn-sm" href="profile.html"><i class="bx bx-edit-alt"></i>${compact ? '' : ' Edit profile'}</a>`;
    if (!state.user)
    return `<a class="btn btn-sm" href="login.html"><i class="bx bx-log-in"></i>${compact ? '' : ' Log in to follow'}</a>`;
    if (user.relationship === 'following')
    return `<button class="btn btn-sm" type="button" data-community-unfollow="${escapeHtml(user.id)}"><i class="bx bx-user-check"></i>${compact ? '' : ' Following'}</button>`;
    if (user.relationship === 'requested')
    return `<button class="btn btn-sm" type="button" data-community-unfollow="${escapeHtml(user.id)}"><i class="bx bx-time-five"></i>${compact ? '' : ' Requested'}</button>`;
    return `<button class="btn btn-primary btn-sm" type="button" data-community-follow="${escapeHtml(user.id)}"><i class="bx ${user.visibility === 'private' ? 'bx-user-plus' : 'bx-user-check'}"></i>${compact ? '' : (user.visibility === 'private' ? ' Request to follow' : ' Follow')}</button>`;
  }

  function communityMessageAction(user, compact = false) {
    if (user.relationship === 'self') return '';
    if (!state.user)
    return `<a class="btn btn-sm" href="login.html"><i class="bx bx-message-square-dots"></i>${compact ? '' : ' Log in to message'}</a>`;
    return `<a class="btn btn-sm" href="notifications.html?member=${encodeURIComponent(user.id)}"><i class="bx bx-message-square-dots"></i>${compact ? '' : ' Message'}</a>`;
  }

  function filteredCommunityUsers() {
    const query = ($('#communitySearch')?.value || '').trim().toLowerCase();
    const visibility = $('#communityVisibilityFilter')?.value || 'all';
    const country = $('#communityCountryFilter')?.value || 'all';
    const sort = $('#communitySort')?.value || 'name';
    const users = state.communityUsers.filter(user => {
      const visibilityMatch = visibility === 'all' || user.visibility === visibility || user.relationship ===
        visibility;
      const countryMatch = country === 'all' || user.profile.country === country;
      return (!query || communitySearchText(user).includes(query)) && visibilityMatch && countryMatch;
    });
    users.sort((a, b) => {
      if (sort === 'followers') return b.followers_count - a.followers_count || a.profile.display_name
        .localeCompare(b.profile.display_name);
      if (sort === 'skills') return (list(b.profile.skills_to_teach).length + list(b.profile.skills_to_learn)
        .length) - (list(a.profile.skills_to_teach).length + list(a.profile.skills_to_learn).length);
      if (sort === 'newest') return String(b.joined_at || '').localeCompare(String(a.joined_at || ''));
      return a.profile.display_name.localeCompare(b.profile.display_name);
    });
    return users;
  }

  function bindCommunityActions(root = document) {
    $$('[data-community-view]', root).forEach(button => button.addEventListener('click', () => openCommunityProfile(
      button.dataset.communityView)));
    $$('[data-community-follow]', root).forEach(button => button.addEventListener('click', () =>
      changeCommunityFollow(button.dataset.communityFollow, false, button)));
    $$('[data-community-unfollow]', root).forEach(button => button.addEventListener('click', () =>
      changeCommunityFollow(button.dataset.communityUnfollow, true, button)));
  }

  function renderCommunityUsers() {
    const host = $('#communityUserGrid');
    if (!host) return;
    const users = filteredCommunityUsers();
    $('#communityResultCount').textContent =
    `${users.length} of ${state.communityUsers.length} active profiles shown`;
    $('#communityEmpty').hidden = users.length > 0;
    host.hidden = users.length === 0;
    host.innerHTML = users.map(user => {
      const profile = user.profile;
      const skills = user.can_view_full ? [...list(profile.skills_to_teach), ...list(profile.skills_to_learn)]
        .slice(0, 5) : [];
      const copy = user.can_view_full ? (profile.bio || profile.headline ||
          'This member is building their SwapLabs profile.') :
        'This profile is private. Follow the member and wait for approval to view skills, languages, location, bio, goals, and availability.';
      return `<article class="community-user-card"><div class="community-card-head">${avatarHtml(user)}<div class="community-card-identity"><h3>${escapeHtml(profile.display_name)} ${user.verified ? '<i class="bx bx-badge-check" title="Verified account"></i>' : ''}</h3><p>@${escapeHtml(user.username)} · ${escapeHtml(profile.full_name || profile.display_name)}</p></div><span class="visibility-pill ${escapeHtml(user.visibility)}"><i class="bx ${user.visibility === 'private' ? 'bx-lock-alt' : 'bx-world'}"></i>${escapeHtml(user.visibility)}</span></div><p class="community-card-copy">${escapeHtml(copy)}</p>${user.can_view_full ? `<div class="community-card-meta"><span><i class="bx bx-briefcase-alt-2"></i>${escapeHtml(profile.professional_role || profile.occupation || 'Role not listed')}</span><span><i class="bx bx-map"></i>${escapeHtml([profile.city, profile.country].filter(Boolean).join(', ') || 'Location private')}</span></div><div class="community-card-skills">${skills.map(skill => `<span>${escapeHtml(skill)}</span>`).join('') || '<span>Skills coming soon</span>'}</div>` : `<div class="community-private-state"><i class="bx bx-lock-alt"></i> Basics only until this member accepts your follow request.</div>`}<div class="community-card-meta"><span><i class="bx bx-group"></i>${user.followers_count} followers</span><span><i class="bx bx-user-check"></i>${user.following_count} following</span></div><div class="community-card-actions"><button class="btn btn-sm" type="button" data-community-view="${escapeHtml(user.id)}"><i class="bx bx-show"></i> View profile</button>${communityMessageAction(user, true)}${communityRelationshipAction(user, true)}</div></article>`;
    }).join('');
    bindCommunityActions(host);
  }

  function renderCommunityDrawer(user) {
    const host = $('#communityDrawerContent');
    if (!host) return;
    const profile = user.profile;
    const locked = !user.can_view_full;
    host.innerHTML =
      `<div class="drawer-profile-head">${avatarHtml(user, 'profile-avatar-xl')}<h2>${escapeHtml(profile.display_name)} ${user.verified ? '<i class="bx bx-badge-check"></i>' : ''}</h2><p>@${escapeHtml(user.username)} · ${escapeHtml(profile.full_name || profile.display_name)}</p><span class="visibility-pill ${escapeHtml(user.visibility)}"><i class="bx ${user.visibility === 'private' ? 'bx-lock-alt' : 'bx-world'}"></i>${escapeHtml(user.visibility)} profile</span><div class="drawer-stats"><div><strong>${user.followers_count}</strong><span>followers</span></div><div><strong>${user.following_count}</strong><span>following</span></div></div><div class="form-actions" style="justify-content:center">${communityMessageAction(user)}${communityRelationshipAction(user)}</div></div>${locked ? `<section class="drawer-section"><div class="community-private-state"><i class="bx bx-lock-alt"></i><strong>Full profile access is private.</strong><br>Send a follow request. If ${escapeHtml(profile.display_name)} accepts it from the Inbox, their complete profile will become visible to you.</div></section>` : `<section class="drawer-section"><h3>About</h3><p>${escapeHtml(profile.bio || 'No biography has been added yet.')}</p></section><section class="drawer-section"><h3>Professional and location</h3><p><strong>${escapeHtml(profile.professional_role || profile.occupation || 'Role not listed')}</strong>${profile.organization ? ` at ${escapeHtml(profile.organization)}` : ''}<br>${escapeHtml([profile.city, profile.country].filter(Boolean).join(', ') || 'Location private')} · Age ${escapeHtml(profile.age || 'not listed')}</p></section><section class="drawer-section"><h3>Can teach</h3><div class="member-tags">${list(profile.skills_to_teach).map(skill => `<span>${escapeHtml(skill)}</span>`).join('') || '<span>Not listed</span>'}</div></section><section class="drawer-section"><h3>Wants to learn</h3><div class="member-tags">${list(profile.skills_to_learn).map(skill => `<span>${escapeHtml(skill)}</span>`).join('') || '<span>Not listed</span>'}</div></section><section class="drawer-section"><h3>Languages</h3><div class="member-tags">${[profile.primary_language, ...list(profile.additional_languages)].filter(Boolean).map(language => `<span>${escapeHtml(language)}</span>`).join('') || '<span>Not listed</span>'}</div></section><section class="drawer-section"><h3>Learning goal and availability</h3><p>${escapeHtml(profile.learning_goal || 'No learning goal shared.')}</p><p><i class="bx bx-time-five"></i> ${escapeHtml(profile.availability || 'Availability not listed')} · ${escapeHtml(profile.preferred_format || 'Format flexible')}</p></section>`}`;
    bindCommunityActions(host);
  }

  function openCommunityProfile(userId) {
    const user = state.communityUsers.find(candidate => candidate.id === userId);
    if (!user) return;
    renderCommunityDrawer(user);
    $('#communityDrawer').hidden = false;
    $('#communityDrawerBackdrop').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeCommunityProfile() {
    if (!$('#communityDrawer')) return;
    $('#communityDrawer').hidden = true;
    $('#communityDrawerBackdrop').hidden = true;
    document.body.style.overflow = '';
  }

  async function changeCommunityFollow(userId, remove, button) {
    if (!state.user) {
      location.href = 'login.html';
      return;
    }
    loading(button, true, remove ? 'Updating' : 'Sending');
    try {
      const result = await api(`/api/community/users/${encodeURIComponent(userId)}/follow`, {
        method: remove ? 'DELETE' : 'POST'
      });
      toast(result.message);
      await loadCommunity(false);
      const drawer = $('#communityDrawer');
      if (drawer && !drawer.hidden) openCommunityProfile(userId);
      refreshNotificationBadge();
    } catch (error) {
      toast(error.message, 'error');
      loading(button, false);
    }
  }

  async function loadCommunity(setupFilters = true) {
    try {
      const result = await api('/api/community');
      state.communityUsers = result.users;
      if ($('#communityTotal')) {
        $('#communityTotal').textContent = result.stats.total;
        $('#communityPublic').textContent = result.stats.public;
        $('#communityPrivate').textContent = result.stats.private;
        $('#communityCountries').textContent = result.stats.countries;
      }
      if (setupFilters) {
        const countries = [...new Set(result.users.map(user => user.profile.country).filter(value => value &&
          value !== 'Private'))].sort();
        const select = $('#communityCountryFilter');
        if (select) select.innerHTML = '<option value="all">All countries</option>' + countries.map(country =>
          `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`).join('');
      }
      renderCommunityUsers();
    } catch (error) {
      const host = $('#communityUserGrid');
      if (host) host.innerHTML =
        `<div class="community-loading"><i class="bx bx-error-circle"></i>${escapeHtml(error.message)}</div>`;
    }
  }

  function setupCommunityPage() {
    if (!$('#communityUserGrid')) return;
    loadCommunity().then(() => {
      const requested = new URLSearchParams(location.search).get('user');
      if (requested) openCommunityProfile(requested);
    });
    ['communitySearch', 'communityVisibilityFilter', 'communityCountryFilter', 'communitySort'].forEach(id => {
      const element = document.getElementById(id);
      element?.addEventListener(id === 'communitySearch' ? 'input' : 'change', renderCommunityUsers);
    });
    $('#communityClear')?.addEventListener('click', () => {
      $('#communitySearch').value = '';
      $('#communityVisibilityFilter').value = 'all';
      $('#communityCountryFilter').value = 'all';
      $('#communitySort').value = 'name';
      renderCommunityUsers();
    });
    $('#communityDrawerClose')?.addEventListener('click', closeCommunityProfile);
    $('#communityDrawerBackdrop')?.addEventListener('click', closeCommunityProfile);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeCommunityProfile();
      if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
        event.preventDefault();
        $('#communitySearch')?.focus();
      }
    });
  }

  function notificationIcon(type) {
    return type === 'follow_request' ? 'bx-user-plus' : type === 'follow_accepted' ? 'bx-user-check' :
      type === 'follow_declined' ? 'bx-user-x' : type === 'new_follower' ? 'bx-group' : 'bx-bell';
  }

  function renderNotificationCenter(result) {
    const requests = result.incoming_requests || [];
    const notifications = result.notifications || [];
    $('#followRequestCount').textContent = `${requests.length} pending`;
    $('#followRequestEmpty').hidden = requests.length > 0;
    const requestHost = $('#followRequestList');
    requestHost.innerHTML = requests.map(item => {
      const requester = item.requester;
      return `<article class="follow-request-card"><div class="follow-request-user">${avatarHtml(requester)}<div><h3>${escapeHtml(requester.profile.display_name)}</h3><p>@${escapeHtml(requester.username)} · ${escapeHtml(requester.profile.full_name || requester.profile.display_name)}</p></div></div><p>${escapeHtml(requester.profile.headline || 'This member would like permission to view your private profile.')}</p><div class="follow-request-actions"><button class="btn btn-primary btn-sm" type="button" data-follow-accept="${escapeHtml(item.id)}"><i class="bx bx-check"></i> Accept</button><button class="btn btn-danger btn-sm" type="button" data-follow-decline="${escapeHtml(item.id)}"><i class="bx bx-trash"></i> Delete</button><a class="btn btn-sm" href="community.html?user=${encodeURIComponent(requester.id)}" aria-label="View requester profile"><i class="bx bx-show"></i></a></div></article>`;
    }).join('');
    const feed = $('#notificationFeed');
    $('#notificationEmpty').hidden = notifications.length > 0;
    feed.innerHTML = notifications.map(item =>
      `<article class="notification-item ${item.read ? '' : 'unread'}">${item.actor ? avatarHtml(item.actor) : `<span class="notification-system-icon"><i class="bx ${notificationIcon(item.type)}"></i></span>`}<div class="notification-copy"><strong>${escapeHtml(item.type.replaceAll('_', ' '))}</strong><p>${escapeHtml(item.message)}</p><time>${escapeHtml(formatDate(item.created_at))}</time></div>${item.read ? '' : `<button class="notification-read-button" type="button" data-notification-read="${escapeHtml(item.id)}"><i class="bx bx-check"></i> Mark read</button>`}</article>`
      ).join('');
    $$('[data-follow-accept]', requestHost).forEach(button => button.addEventListener('click', () =>
      respondToFollowRequest(button.dataset.followAccept, true, button)));
    $$('[data-follow-decline]', requestHost).forEach(button => button.addEventListener('click', () =>
      respondToFollowRequest(button.dataset.followDecline, false, button)));
    $$('[data-notification-read]', feed).forEach(button => button.addEventListener('click', () => markOneNotification(
      button.dataset.notificationRead, button)));
  }

  async function loadNotificationCenter() {
    const result = await api('/api/notifications');
    state.notifications = result;
    renderNotificationCenter(result);
    refreshNotificationBadge();
  }

  async function respondToFollowRequest(requestId, accept, button) {
    loading(button, true, accept ? 'Accepting' : 'Deleting');
    try {
      const result = await api(
        `/api/notifications/follow-requests/${encodeURIComponent(requestId)}${accept ? '/accept' : ''}`, {
          method: accept ? 'POST' : 'DELETE'
        });
      toast(result.message);
      await loadNotificationCenter();
    } catch (error) {
      toast(error.message, 'error');
      loading(button, false);
    }
  }

  async function markOneNotification(notificationId, button) {
    loading(button, true, 'Saving');
    try {
      await api(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'PATCH'
      });
      await loadNotificationCenter();
    } catch (error) {
      toast(error.message, 'error');
      loading(button, false);
    }
  }

  function setupNotificationsPage() {
    const loadingPanel = $('#notificationLoading');
    if (!loadingPanel) return;
    loadingPanel.hidden = true;
    if (!state.user) {
      $('#notificationLocked').hidden = false;
      return;
    }
    $('#notificationPanel').hidden = false;
    loadNotificationCenter().catch(error => toast(error.message, 'error'));
    $('#notificationsReadAll')?.addEventListener('click', async () => {
      try {
        await api('/api/notifications/read-all', {
          method: 'POST'
        });
        await loadNotificationCenter();
        toast('All notifications marked as read.');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function addLiveMemberDirectory() {
    if (currentPage !== 'talent-directory.html' || !state.user) return;
    try {
      const result = await api('/api/members');
      const section = document.createElement('section');
      section.className = 'member-directory-section';
      section.innerHTML =
        `<div class="container"><div class="section-head"><span class="eyebrow">Registered community</span><h2>Live member profiles</h2><p>This directory is generated from saved member profiles. It is read-only for members and reflects profile changes across the platform.</p></div><div class="live-member-grid">${result.members.map(user => `<article class="live-member-card"><div class="live-member-head">${avatarHtml(user)}<div><h3>${escapeHtml(user.profile.display_name)} ${user.verified ? '<i class="bx bx-badge-check" title="Verified"></i>' : ''}</h3><p>${escapeHtml(user.profile.headline || user.profile.occupation || 'SwapLabs member')}</p></div></div><div class="member-skill-row"><span>Can teach</span><div class="member-tags">${list(user.profile.skills_to_teach).slice(0, 4).map(skill => `<span>${escapeHtml(skill)}</span>`).join('') || '<span>Not listed</span>'}</div></div><div class="member-skill-row"><span>Wants to learn</span><div class="member-tags">${list(user.profile.skills_to_learn).slice(0, 4).map(skill => `<span>${escapeHtml(skill)}</span>`).join('') || '<span>Not listed</span>'}</div></div></article>`).join('')}</div></div>`;
      $('main')?.appendChild(section);
    } catch (_error) {
      // Directory stays absent if the account loses access during the request.
    }
  }

  async function initialize() {
    setupPasswordToggles();
    try {
      const result = await api('/api/auth/me');
      state.user = result.authenticated ? result.user : null;
      state.csrf = result.csrf_token || state.csrf;
      if (state.user) window.SwapLabsPreferences?.apply(state.user.preferences || {});
    } catch (_error) {
      state.serverAvailable = false;
      showServerRequired();
    }
    if (state.user) {
      state.accessWatch = setInterval(async () => {
        if (document.hidden) return;
        try {
          const access = await api('/api/auth/me');
          if (!access.authenticated) {
            sessionStorage.setItem('swaplabs-access-notice', access.error ||
              'Your session ended. Sign in again to continue.');
            location.replace(`login.html${access.access_status === 'suspended' ? '?access=suspended' : ''}`);
          }
        } catch (_error) {
          /* A temporary server interruption should not erase the current page. */ }
      }, 4000);
    }
    renderAccountNavigation();
    document.querySelector('.member-context-bar')?.remove();
    refreshNotificationBadge();
    const page = $('[data-auth-page]')?.dataset.authPage;
    if (page === 'login') setupLoginPage();
    if (page === 'register') setupRegistrationPage();
    if (page === 'profile') setupProfilePage();
    if (page === 'admin') setupAdminPage();
    if (page === 'community') setupCommunityPage();
    if (page === 'notifications') setupNotificationsPage();
    addLiveMemberDirectory();
  }

  initialize();
})();
