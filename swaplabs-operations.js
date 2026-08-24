(() => {
  'use strict';

  const pageRoot = document.querySelector('[data-operations-page]');
  const adminRoot = document.querySelector('[data-auth-page="admin"]');
  if (!pageRoot && !adminRoot) return;

  const state = {
    csrf: '',
    user: null,
    inbox: null,
    activeConversationId: '',
    activeConversation: null,
    activeMessages: [],
    inboxPoll: null,
    chatPoll: null,
    typingTimer: null,
    typingSentAt: 0,
    calendar: null,
    calendarFilter: 'upcoming',
    calendarPoll: null,
    liveSessions: null,
    liveSessionFilter: 'upcoming',
    liveSessionSearch: '',
    liveSessionPoll: null,
    credits: null,
    operations: null,
    adminTab: 'reports'
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
  const escapeAttr = escapeHtml;
  const formatDate = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value || '') : new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(parsed);
  };
  const formatShortTime = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(parsed);
  };
  const formatDay = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric'
    }).format(parsed);
  };
  const relativeTime = value => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const seconds = Math.round((parsed.getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, {
      numeric: 'auto'
    });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
    return formatter.format(Math.round(hours / 24), 'day');
  };
  const initials = member => String(member?.display_name || member?.profile?.display_name || member?.username || 'SL')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const safeAvatar = member => {
    const value = String(member?.avatar_url || member?.profile?.avatar_url || '');
    return /^\/uploads\/usr_[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(value) ? value : '';
  };
  const avatarHtml = (member, bot = false) => {
    const source = safeAvatar(member);
    const color = ['blue', 'pink', 'purple', 'indigo'].includes(member?.profile_color || member?.profile
      ?.profile_color) ? (member?.profile_color || member?.profile?.profile_color) : 'indigo';
    return `<span class="ops-avatar ${bot ? 'bot' : escapeAttr(color)}">${source ? `<img src="${escapeAttr(source)}" alt="${escapeAttr(member?.display_name || member?.profile?.display_name || 'Member')} profile photo">` : bot ? '<i class="bx bx-bot"></i>' : escapeHtml(initials(member))}</span>`;
  };
  const meetingAvatarHtml = () =>
    '<span class="ops-avatar meeting"><i class="bx bx-calendar-event"></i></span>';

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (writeMethods.has(method) && !state.csrf) {
      const tokenResponse = await fetch('/api/auth/csrf', {
        credentials: 'same-origin'
      });
      if (!tokenResponse.ok) throw new Error('Could not establish a secure session.');
      state.csrf = (await tokenResponse.json()).csrf_token;
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
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {
        error: 'The server returned an unreadable response.'
      };
    }
    if (!response.ok) {
      const error = new Error(payload.error || 'Something went wrong.');
      error.status = response.status;
      throw error;
    }
    if (payload.csrf_token) state.csrf = payload.csrf_token;
    return payload;
  }

  function toast(message, type = 'success') {
    let element = $('.platform-toast.ops-toast');
    if (!element) {
      element = document.createElement('div');
      element.className = 'platform-toast ops-toast';
      document.body.appendChild(element);
    }
    element.className = `platform-toast ops-toast ${type}`;
    element.innerHTML =
      `<i class="bx ${type === 'error' ? 'bx-error-circle' : 'bx-check-circle'}"></i><span>${escapeHtml(message)}</span>`;
    requestAnimationFrame(() => element.classList.add('show'));
    clearTimeout(element.hideTimer);
    element.hideTimer = setTimeout(() => element.classList.remove('show'), 3800);
  }

  function setStatus(form, message, type = 'error') {
    const host = $('[data-ops-status]', form);
    if (!host) return;
    host.textContent = message;
    host.className = `ops-form-status show ${type}`;
  }

  function clearStatus(form) {
    const host = $('[data-ops-status]', form);
    if (!host) return;
    host.textContent = '';
    host.className = 'ops-form-status';
  }

  function setButtonLoading(button, active, label = 'Saving') {
    if (!button) return;
    if (active) {
      button.dataset.original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="bx bx-loader-alt bx-spin"></i> ${escapeHtml(label)}`;
    } else {
      button.disabled = false;
      if (button.dataset.original) button.innerHTML = button.dataset.original;
    }
  }

  function showAuthenticatedApp(appSelector) {
    $('#opsLoading')?.setAttribute('hidden', '');
    $('#opsAuthGate')?.setAttribute('hidden', '');
    $(appSelector)?.removeAttribute('hidden');
  }

  function showAuthGate() {
    $('#opsLoading')?.setAttribute('hidden', '');
    $('#opsAuthGate')?.removeAttribute('hidden');
  }

  /* Inbox */
  function conversationPreview(conversation) {
    const latest = conversation.latest_message;
    if (!latest) return 'No messages yet';
    if (latest.moderation_status === 'removed') return 'Message removed by moderation';
    if (latest.body) return latest.body;
    if (latest.attachment) return `Attachment: ${latest.attachment.name}`;
    return 'Conversation update';
  }

  function renderConversationList() {
    const host = $('#conversationList');
    if (!host || !state.inbox) return;
    const term = String($('#conversationSearch')?.value || '').trim().toLowerCase();
    const conversations = state.inbox.conversations.filter(item =>
      `${item.title} ${item.subtitle} ${conversationPreview(item)}`.toLowerCase().includes(term));
    host.innerHTML = conversations.length ? conversations.map(conversation => {
        const bot = conversation.kind === 'bot';
        const meeting = conversation.kind === 'meeting';
        const member = conversation.members?.[0];
        return `<button class="conversation-item ${meeting ? 'meeting' : ''} ${conversation.id === state.activeConversationId ? 'active' : ''}" type="button" data-conversation-id="${escapeAttr(conversation.id)}">
        ${meeting ? meetingAvatarHtml() : avatarHtml(bot ? {display_name:'SwapBot'} : member, bot)}
        <span class="conversation-copy"><strong>${meeting ? '<i class="bx bx-video meeting-thread-mark"></i>' : ''}${escapeHtml(conversation.title)}</strong><span>${escapeHtml(conversationPreview(conversation))}</span></span>
        <span class="conversation-meta"><time>${escapeHtml(conversation.latest_message ? relativeTime(conversation.latest_message.created_at) : '')}</time>${conversation.unread_count ? `<b class="conversation-badge">${conversation.unread_count > 99 ? '99+' : conversation.unread_count}</b>` : bot ? '<i class="bx bx-pin conversation-pin"></i>' : ''}</span>
      </button>`;
      }).join('') :
      '<div class="ops-empty"><i class="bx bx-search-alt"></i><h3>No matching conversations</h3><p>Try another name or message keyword.</p></div>';
    $('#inboxUnreadCount').textContent = String(state.inbox.unread_count || 0);
    $('#inboxConversationCount').textContent = String(state.inbox.conversations.length);
  }

  function renderInboxContacts() {
    const select = $('#newChatMember');
    if (!select || !state.inbox) return;
    const current = select.value;
    select.innerHTML = '<option value="">Start a conversation</option>' + state.inbox.contacts.map(member =>
      `<option value="${escapeAttr(member.id)}">${escapeHtml(member.display_name)} · @${escapeHtml(member.username)}</option>`
      ).join('');
    if (state.inbox.contacts.some(member => member.id === current)) select.value = current;
  }

  function renderFollowRequests() {
    const requests = state.inbox?.incoming_requests || [];
    $('#requestCount').textContent = `${requests.length} follow request${requests.length === 1 ? '' : 's'}`;
    const host = $('#followRequestStack');
    if (!host) return;
    host.innerHTML = requests.length ? requests.map(item => `<article class="follow-request-card">
      <div class="follow-request-person">${avatarHtml(item.requester)}<div><strong>${escapeHtml(item.requester.display_name)}</strong><span>@${escapeHtml(item.requester.username)}</span></div></div>
      <div class="follow-request-actions"><button type="button" data-follow-accept="${escapeAttr(item.id)}"><i class="bx bx-check"></i> Accept</button><button type="button" data-follow-decline="${escapeAttr(item.id)}"><i class="bx bx-x"></i> Delete</button></div>
    </article>`).join('') : '<p class="ops-muted">No pending profile requests.</p>';
  }

  async function loadInbox({
    selectFirst = false,
    quiet = false
  } = {}) {
    try {
      const result = await api('/api/inbox');
      state.inbox = result;
      renderInboxContacts();
      renderFollowRequests();
      renderConversationList();
      if ((selectFirst || !state.activeConversationId) && result.conversations.length) {
        const preferred = result.conversations.find(item => item.kind === 'bot') || result.conversations[0];
        await openConversation(preferred.id, true);
      }
    } catch (error) {
      if (!quiet) toast(error.message, 'error');
    }
  }

  function messageDayLabel(value) {
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium'
    }).format(date);
  }

  function meetingMessageCard(message) {
    const event = message.metadata?.event;
    if (!event) return '';
    const action = String(message.metadata?.calendar_action || 'updated');
    const actionLabels = {
      scheduled: 'Meeting scheduled',
      rescheduled: 'Time updated',
      updated: 'Meeting details updated',
      cancelled: 'Meeting cancelled'
    };
    const duration = Number(event.duration_minutes || Math.max(1,
      Math.round((new Date(event.ends_at) - new Date(event.starts_at)) / 60000)));
    const attendees = [event.host?.display_name, ...(event.participants || []).map(member => member.display_name)]
      .filter(Boolean);
    const meetingLocation = event.meeting_url ?
      `<a href="${escapeAttr(event.meeting_url)}" target="_blank" rel="noopener"><i class="bx bx-link-external"></i> Open meeting link</a>` :
      `<span><i class="bx bx-map"></i>${escapeHtml(event.location || 'Location not set')}</span>`;
    return `<article class="meeting-message-card ${action === 'cancelled' ? 'cancelled' : ''}">
      <div class="meeting-message-top"><span><i class="bx ${action === 'cancelled' ? 'bx-calendar-x' : action === 'rescheduled' ? 'bx-refresh' : 'bx-calendar-check'}"></i>${escapeHtml(actionLabels[action] || actionLabels.updated)}</span><time>${escapeHtml(formatShortTime(message.created_at))}</time></div>
      <h3>${escapeHtml(event.title || 'SwapLabs meeting')}</h3>
      ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
      <div class="meeting-message-facts"><span><i class="bx bx-calendar"></i><strong>${escapeHtml(formatDate(event.starts_at))}</strong></span><span><i class="bx bx-time-five"></i><strong>${duration} minutes</strong></span><span><i class="bx bx-globe"></i><strong>${escapeHtml(event.timezone || 'UTC')}</strong></span>${meetingLocation}</div>
      <div class="meeting-message-people"><i class="bx bx-group"></i><span><small>Everyone invited</small><strong>${escapeHtml(attendees.join(', ') || 'No attendees listed')}</strong></span></div>
      <div class="meeting-message-actions"><a href="calendar.html?event=${encodeURIComponent(event.id)}"><i class="bx bx-calendar-detail"></i> View calendar details</a>${action !== 'cancelled' ? `<a href="video-room.html?event=${encodeURIComponent(event.id)}"><i class="bx bx-video"></i> Open live room</a>` : ''}<a href="/api/calendar/events/${encodeURIComponent(event.id)}/ics"><i class="bx bx-download"></i> Download ICS</a></div>
    </article>`;
  }

  function messageHtml(message, conversation) {
    const mine = message.sender_id === state.user.id;
    const bot = message.sender_kind === 'bot';
    const system = message.sender_kind === 'system';
    const meetingUpdate = system && message.metadata?.type === 'calendar_event' && message.metadata?.event;
    const member = message.sender;
    const othersRead = (message.read_by || []).some(id => id !== state.user.id);
    const attachment = message.attachment ?
      `<a class="message-attachment" href="${escapeAttr(message.attachment.url)}"><i class="bx ${String(message.attachment.mime || '').startsWith('image/') ? 'bx-image' : message.attachment.mime === 'application/pdf' ? 'bxs-file-pdf' : 'bx-file'}"></i><span><strong>${escapeHtml(message.attachment.name)}</strong><small>${Math.max(1, Math.round(Number(message.attachment.size || 0) / 1024))} KB · Download protected file</small></span></a>` :
      '';
    return `<div class="message-row ${mine ? 'mine' : ''} ${bot ? 'bot' : ''} ${system ? 'system' : ''} ${meetingUpdate ? 'meeting-update' : ''} ${message.moderation_status === 'removed' ? 'removed' : ''}" data-message-id="${escapeAttr(message.id)}">
      ${!mine && !system ? avatarHtml(bot ? {display_name:'SwapBot'} : member, bot) : ''}
      <div class="message-bubble">${meetingUpdate ? meetingMessageCard(message) : `${!mine && !system ? `<span class="message-author">${escapeHtml(bot ? 'SwapBot' : member?.display_name || 'Member')}</span>` : ''}${message.body ? `<p>${escapeHtml(message.body)}</p>` : ''}${attachment}${!system ? `<span class="message-state">${escapeHtml(formatShortTime(message.created_at))}${mine ? ` · <i class="bx bx-check${othersRead ? '-double' : ''}"></i> ${othersRead ? 'Read' : 'Sent'}` : ''}</span>` : ''}`}</div>
    </div>`;
  }

  function renderMessages(scroll = false) {
    const host = $('#messageStream');
    if (!host || !state.activeConversation) return;
    let currentDay = '';
    const html = state.activeMessages.map(message => {
      const day = messageDayLabel(message.created_at);
      const divider = day !== currentDay ? `<div class="message-day"><span>${escapeHtml(day)}</span></div>` : '';
      currentDay = day;
      return divider + messageHtml(message, state.activeConversation);
    }).join('');
    const wasNearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 110;
    host.innerHTML = html ||
      '<div class="ops-empty"><i class="bx bx-message"></i><h3>No messages yet</h3><p>Write the first message in this conversation.</p></div>';
    if (scroll || wasNearBottom) host.scrollTop = host.scrollHeight;
    const typing = $('#typingLine');
    if (typing) {
      const names = state.activeConversation.typing_users || [];
      typing.hidden = names.length === 0;
      const label = $('em', typing);
      if (label && names.length) label.textContent = `${names.map(item => item.display_name).join(', ')} typing`;
    }
  }

  function renderConversationDetails() {
    const host = $('#detailsConversation');
    if (!host || !state.activeConversation) return;
    const conversation = state.activeConversation.conversation;
    if (conversation.kind === 'bot') {
      host.innerHTML =
        `<div class="details-profile">${avatarHtml({display_name:'SwapBot'}, true)}<h3>SwapBot</h3><p>Assistant and account update channel</p></div><div class="details-info"><div><span>Purpose</span><strong>Guidance and updates</strong></div><div><span>Access</span><strong>Private to you</strong></div><div><span>Messages</span><strong>${state.activeMessages.length}</strong></div></div><div class="ops-trust-note"><i class="bx bx-bot"></i><span>Ask about any SwapLabs page, scheduling, time credits, safety, profiles, workshops, or innovation features.</span></div>`;
      $('#chatSchedule').hidden = true;
      return;
    }
    if (conversation.kind === 'meeting') {
      const event = conversation.event;
      const attendees = [event?.host, ...(event?.participants || [])].filter(Boolean);
      $('#chatSchedule').hidden = false;
      $('#chatSchedule').href = event ? `calendar.html?event=${encodeURIComponent(event.id)}` : 'calendar.html';
      host.innerHTML = event ?
        `<div class="details-profile meeting-profile">${meetingAvatarHtml()}<h3>${escapeHtml(event.title)}</h3><p>${event.status === 'cancelled' ? 'Cancelled meeting' : 'Shared meeting thread'}</p></div>
        <div class="meeting-detail-summary"><span><i class="bx bx-calendar"></i><strong>${escapeHtml(formatDate(event.starts_at))}</strong></span><span><i class="bx bx-time-five"></i><strong>${Math.max(1,Math.round((new Date(event.ends_at)-new Date(event.starts_at))/60000))} minutes</strong></span><span><i class="bx bx-globe"></i><strong>${escapeHtml(event.timezone || 'UTC')}</strong></span><span><i class="bx bx-map"></i><strong>${escapeHtml(event.meeting_url ? 'Online meeting' : event.location || 'Location not set')}</strong></span></div>
        <div class="meeting-detail-members"><span>Members in this meeting</span><div>${attendees.map(member => `<span>${avatarHtml(member)}<strong>${escapeHtml(member.display_name)}</strong></span>`).join('')}</div></div>
        <div class="details-actions"><a class="details-action" href="calendar.html?event=${encodeURIComponent(event.id)}"><i class="bx bx-calendar-detail"></i> Calendar</a>${event.status !== 'cancelled' ? `<a class="details-action" href="video-room.html?event=${encodeURIComponent(event.id)}"><i class="bx bx-video"></i> Live room</a>` : ''}<a class="details-action" href="/api/calendar/events/${encodeURIComponent(event.id)}/ics"><i class="bx bx-download"></i> Export</a></div>
        <div class="ops-trust-note"><i class="bx bx-info-circle"></i><span>Scheduling, rescheduling, cancellation, room, and attendance updates stay visible to every meeting member in this thread.</span></div>` :
        '<p class="ops-muted">This meeting record is no longer available.</p>';
      return;
    }
    const member = conversation.members?.[0];
    if (!member) {
      host.innerHTML =
        '<p class="ops-muted">This member account is no longer available. The conversation remains as moderation and account history.</p>';
      return;
    }
    $('#chatSchedule').hidden = false;
    $('#chatSchedule').href =
      `calendar.html?participant=${encodeURIComponent(member.id)}&conversation=${encodeURIComponent(conversation.id)}`;
    host.innerHTML =
      `<div class="details-profile">${avatarHtml(member)}<h3>${escapeHtml(member.display_name)}</h3><p>@${escapeHtml(member.username)}${member.verified ? ' · Verified' : ''}</p></div>
      <div class="details-actions"><a class="details-action" href="community.html?user=${encodeURIComponent(member.id)}"><i class="bx bx-user"></i> Profile</a><a class="details-action" href="calendar.html?participant=${encodeURIComponent(member.id)}&conversation=${encodeURIComponent(conversation.id)}"><i class="bx bx-calendar-plus"></i> Schedule</a><button class="details-action" type="button" data-conversation-mute><i class="bx ${conversation.muted ? 'bx-volume-full' : 'bx-volume-mute'}"></i> ${conversation.muted ? 'Unmute' : 'Mute'}</button><button class="details-action danger" type="button" data-conversation-block><i class="bx ${conversation.blocked ? 'bx-lock-open-alt' : 'bx-block'}"></i> ${conversation.blocked ? 'Unblock' : 'Block'}</button></div>
      <button class="details-action danger" style="width:100%" type="button" data-conversation-report><i class="bx bx-flag"></i> Report conversation activity</button>
      <div class="details-info"><div><span>Message alerts</span><strong>${conversation.muted ? 'Muted' : 'On'}</strong></div><div><span>Connection</span><strong>${conversation.blocked ? 'Blocked' : 'Available'}</strong></div><div><span>Messages</span><strong>${state.activeMessages.length}</strong></div><div><span>Started</span><strong>${escapeHtml(formatDay(conversation.created_at))}</strong></div></div>`;
  }

  async function loadConversation(conversationId, {
    quiet = false,
    scroll = false
  } = {}) {
    try {
      const result = await api(`/api/inbox/conversations/${encodeURIComponent(conversationId)}`);
      if (state.activeConversationId !== conversationId) return;
      const oldLast = state.activeMessages.at(-1)?.id;
      state.activeConversation = result;
      state.activeConversation.typing_users = result.typing_users || [];
      state.activeMessages = result.messages || [];
      const heading = $('#chatHeading');
      if (heading) {
        const bot = result.conversation.kind === 'bot';
        const meeting = result.conversation.kind === 'meeting';
        const member = result.conversation.members?.[0];
        heading.innerHTML =
          `${meeting ? meetingAvatarHtml() : avatarHtml(bot ? {display_name:'SwapBot'} : member, bot)}<span class="chat-heading-copy"><strong>${escapeHtml(result.conversation.title)}</strong><span>${escapeHtml(result.conversation.subtitle || (bot ? 'Assistant and platform updates' : 'Private member conversation'))}</span></span>`;
      }
      renderMessages(scroll || oldLast !== state.activeMessages.at(-1)?.id);
      renderConversationDetails();
      if (result.conversation.unread_count) {
        await api(`/api/inbox/conversations/${encodeURIComponent(conversationId)}/read`, {
          method: 'POST'
        });
        const item = state.inbox?.conversations.find(entry => entry.id === conversationId);
        if (item) item.unread_count = 0;
        renderConversationList();
      }
    } catch (error) {
      if (!quiet) toast(error.message, 'error');
    }
  }

  async function openConversation(conversationId, initial = false) {
    state.activeConversationId = conversationId;
    $('#chatEmpty')?.setAttribute('hidden', '');
    $('#chatActive')?.removeAttribute('hidden');
    $('#detailsDefault')?.setAttribute('hidden', '');
    $('#detailsConversation')?.removeAttribute('hidden');
    if (!initial || window.innerWidth >= 760) $('#inboxWorkspace')?.classList.add('chat-open');
    renderConversationList();
    await loadConversation(conversationId, {
      scroll: true
    });
    if (!initial && window.innerWidth < 760) $('#inboxDetails')?.classList.remove('open');
  }

  async function sendTyping(typing) {
    if (!state.activeConversationId) return;
    try {
      await api(`/api/inbox/conversations/${encodeURIComponent(state.activeConversationId)}/typing`, {
        method: 'POST',
        body: {
          typing
        }
      });
    } catch (_error) {
      /* Polling will recover. */ }
  }

  function openReportModal() {
    const conversation = state.activeConversation?.conversation;
    const target = conversation?.members?.[0];
    if (!target) return;
    const select = $('#reportMessage');
    select.innerHTML = '<option value="">Entire conversation</option>' + state.activeMessages.filter(message =>
      message.sender_id === target.id).map(message =>
      `<option value="${escapeAttr(message.id)}">${escapeHtml(formatShortTime(message.created_at))} · ${escapeHtml((message.body || message.attachment?.name || 'Attachment').slice(0, 90))}</option>`
      ).join('');
    $('#reportModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeReportModal() {
    $('#reportModal').hidden = true;
    document.body.style.overflow = '';
    $('#reportForm')?.reset();
    clearStatus($('#reportForm'));
  }

  async function setupInbox() {
    showAuthenticatedApp('#inboxWorkspace');
    await loadInbox({
      selectFirst: true
    });
    const inboxParameters = new URLSearchParams(location.search);
    const requestedConversation = inboxParameters.get('conversation');
    const requestedMember = inboxParameters.get('member');
    if (requestedConversation && state.inbox?.conversations.some(conversation => conversation.id ===
        requestedConversation)) {
      await openConversation(requestedConversation);
      history.replaceState({}, '', 'notifications.html');
    } else if (requestedMember && state.inbox?.contacts.some(member => member.id === requestedMember)) {
      try {
        const result = await api('/api/inbox/conversations', {
          method: 'POST',
          body: {
            target_user_id: requestedMember
          }
        });
        await loadInbox();
        await openConversation(result.conversation.id);
        history.replaceState({}, '', 'notifications.html');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
    $('#conversationSearch')?.addEventListener('input', renderConversationList);
    $('#conversationList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-conversation-id]');
      if (button) openConversation(button.dataset.conversationId);
    });
    $('#inboxRefresh')?.addEventListener('click', () => loadInbox());
    $('#inboxComposeToggle')?.addEventListener('click', () => {
      const panel = $('#inboxNewChat');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $('#newChatMember')?.focus();
    });
    $('#newChatButton')?.addEventListener('click', async () => {
      const target = $('#newChatMember')?.value;
      if (!target) return toast('Choose a member first.', 'error');
      try {
        const result = await api('/api/inbox/conversations', {
          method: 'POST',
          body: {
            target_user_id: target
          }
        });
        $('#inboxNewChat').hidden = true;
        await loadInbox();
        await openConversation(result.conversation.id);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    $('#followRequestStack')?.addEventListener('click', async event => {
      const accept = event.target.closest('[data-follow-accept]');
      const decline = event.target.closest('[data-follow-decline]');
      const button = accept || decline;
      if (!button) return;
      setButtonLoading(button, true, accept ? 'Accepting' : 'Deleting');
      try {
        await api(
          `/api/notifications/follow-requests/${encodeURIComponent(accept ? accept.dataset.followAccept : decline.dataset.followDecline)}${accept ? '/accept' : ''}`, {
            method: accept ? 'POST' : 'DELETE'
          });
        await loadInbox();
        toast(accept ? 'Follow request accepted.' : 'Follow request deleted.');
      } catch (error) {
        toast(error.message, 'error');
        setButtonLoading(button, false);
      }
    });
    const body = $('#messageBody');
    body?.addEventListener('input', () => {
      body.style.height = 'auto';
      body.style.height = `${Math.min(body.scrollHeight, 110)}px`;
      const now = Date.now();
      if (now - state.typingSentAt > 1800) {
        state.typingSentAt = now;
        sendTyping(true);
      }
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => sendTyping(false), 1800);
    });
    body?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        $('#messageComposer')?.requestSubmit();
      }
    });
    $('#messageAttachment')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      const preview = $('#attachmentPreview');
      if (!preview) return;
      preview.hidden = !file;
      preview.innerHTML = file ?
        `<i class="bx bx-paperclip"></i> ${escapeHtml(file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB <button type="button" data-remove-attachment aria-label="Remove attachment"><i class="bx bx-x"></i></button>` :
        '';
    });
    $('#attachmentPreview')?.addEventListener('click', event => {
      if (!event.target.closest('[data-remove-attachment]')) return;
      $('#messageAttachment').value = '';
      $('#attachmentPreview').hidden = true;
      $('#attachmentPreview').innerHTML = '';
    });
    $('#messageComposer')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (!state.activeConversationId) return;
      const button = $('button[type="submit"]', event.currentTarget);
      const form = new FormData();
      const messageBody = String($('#messageBody').value || '').trim();
      const file = $('#messageAttachment').files?.[0];
      if (!messageBody && !file) return;
      form.append('body', messageBody);
      if (file) form.append('attachment', file);
      setButtonLoading(button, true, '');
      try {
        await api(`/api/inbox/conversations/${encodeURIComponent(state.activeConversationId)}/messages`, {
          method: 'POST',
          body: form
        });
        $('#messageBody').value = '';
        $('#messageBody').style.height = 'auto';
        $('#messageAttachment').value = '';
        $('#attachmentPreview').hidden = true;
        $('#attachmentPreview').innerHTML = '';
        await sendTyping(false);
        await loadConversation(state.activeConversationId, {
          scroll: true
        });
        await loadInbox({
          quiet: true
        });
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setButtonLoading(button, false);
      }
    });
    $('#detailsConversation')?.addEventListener('click', async event => {
      const conversation = state.activeConversation?.conversation;
      const member = conversation?.members?.[0];
      if (!conversation || !member) return;
      if (event.target.closest('[data-conversation-mute]')) {
        try {
          await api(`/api/inbox/conversations/${encodeURIComponent(conversation.id)}/mute`, {
            method: 'POST',
            body: {
              muted: !conversation.muted
            }
          });
          await loadConversation(conversation.id);
          toast(conversation.muted ? 'Conversation unmuted.' : 'Conversation muted.');
        } catch (error) {
          toast(error.message, 'error');
        }
      }
      if (event.target.closest('[data-conversation-block]')) {
        const blocked = conversation.blocked;
        if (!blocked && !window.confirm(
            `Block ${member.display_name}? Neither member will be able to send messages until you unblock them.`
            )) return;
        try {
          await api(`/api/inbox/users/${encodeURIComponent(member.id)}/block`, {
            method: blocked ? 'DELETE' : 'POST'
          });
          await loadConversation(conversation.id);
          toast(blocked ? 'Member unblocked.' : 'Member blocked.');
        } catch (error) {
          toast(error.message, 'error');
        }
      }
      if (event.target.closest('[data-conversation-report]')) openReportModal();
    });
    const closeDetails = () => $('#inboxDetails')?.classList.remove('open');
    $('#chatDetailsToggle')?.addEventListener('click', () => {
      $('#detailsDefault')?.setAttribute('hidden', '');
      $('#detailsConversation')?.removeAttribute('hidden');
      $('#inboxDetails')?.classList.toggle('open');
    });
    $('#inboxAccountTools')?.addEventListener('click', () => {
      $('#detailsConversation')?.setAttribute('hidden', '');
      $('#detailsDefault')?.removeAttribute('hidden');
      $('#inboxDetails')?.classList.add('open');
    });
    $('[data-chat-details-close]')?.addEventListener('click', closeDetails);
    $('#inboxDetailsBackdrop')?.addEventListener('click', closeDetails);
    $('#inboxBack')?.addEventListener('click', () => $('#inboxWorkspace')?.classList.remove('chat-open'));
    $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeReportModal));
    $('#reportForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(event.currentTarget);
      const conversation = state.activeConversation?.conversation;
      const member = conversation?.members?.[0];
      if (!conversation || !member) return;
      const fields = new FormData(event.currentTarget);
      const button = $('button[type="submit"]', event.currentTarget);
      setButtonLoading(button, true, 'Submitting');
      try {
        await api('/api/inbox/reports', {
          method: 'POST',
          body: {
            conversation_id: conversation.id,
            reported_user_id: member.id,
            category: fields.get('category'),
            message_id: fields.get('message_id'),
            details: fields.get('details')
          }
        });
        closeReportModal();
        toast('Report securely sent to the administration team.');
      } catch (error) {
        setStatus(event.currentTarget, error.message);
        setButtonLoading(button, false);
      }
    });
    state.inboxPoll = setInterval(() => {
      if (!document.hidden) loadInbox({
        quiet: true
      });
    }, 6000);
    state.chatPoll = setInterval(() => {
      if (!document.hidden && state.activeConversationId) loadConversation(state.activeConversationId, {
        quiet: true
      });
    }, 2600);
  }

  /* Calendar */
  const timezoneFallback = ['UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'America/Chicago', 'America/Los_Angeles',
    'America/New_York', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Singapore',
    'Asia/Tokyo', 'Australia/Sydney', 'Europe/Berlin', 'Europe/London', 'Europe/Madrid', 'Europe/Paris',
    'Pacific/Auckland'
  ];
  const timezones = (() => {
    try {
      return ['UTC', ...Intl.supportedValuesOf('timeZone').filter(zone => zone !== 'UTC')];
    } catch (_error) {
      return timezoneFallback;
    }
  })();
  const timezoneOptions = selected => timezones.map(zone =>
    `<option value="${escapeAttr(zone)}" ${zone === selected ? 'selected' : ''}>${escapeHtml(zone.replaceAll('_',' '))}</option>`
    ).join('');
  const inTimezoneInput = (value, zone) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const compactUtc = value => new Date(value).toISOString().replace(/[-:]/g, '').replace('.000', '');
  const googleCalendarUrl = event =>
    `https://calendar.google.com/calendar/render?${new URLSearchParams({action:'TEMPLATE',text:event.title,dates:`${compactUtc(event.starts_at)}/${compactUtc(event.ends_at)}`,details:event.description || '',location:event.meeting_url || event.location || ''})}`;
  const outlookCalendarUrl = event =>
    `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({path:'/calendar/action/compose',rru:'addevent',subject:event.title,startdt:new Date(event.starts_at).toISOString(),enddt:new Date(event.ends_at).toISOString(),body:event.description || '',location:event.meeting_url || event.location || ''})}`;

  function updateHeroClock(zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }).formatToParts(now);
    const lookup = type => dateParts.find(item => item.type === type)?.value || '';
    if ($('#calendarHeroMonth')) $('#calendarHeroMonth').textContent = lookup('month');
    if ($('#calendarHeroDay')) $('#calendarHeroDay').textContent = lookup('day');
    if ($('#calendarHeroWeekday')) $('#calendarHeroWeekday').textContent = lookup('weekday');
    if ($('#calendarHeroTime')) $('#calendarHeroTime').textContent = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit'
    }).format(now);
    if ($('#calendarHeroZone')) $('#calendarHeroZone').textContent = zone.replaceAll('_', ' ');
  }

  function renderCalendarStats() {
    const events = state.calendar?.events || [];
    const now = Date.now();
    const upcoming = events.filter(event => event.status === 'scheduled' && new Date(event.ends_at).getTime() >= now);
    $('#calendarUpcoming').textContent = String(upcoming.length);
    $('#calendarParticipants').textContent = String(new Set(upcoming.flatMap(event => event.participant_ids || []))
      .size);
    $('#calendarReminders').textContent = String(upcoming.reduce((sum, event) => sum + (event.reminders_minutes || [])
      .length, 0));
    const zone = state.calendar?.availability?.timezone || state.user?.profile?.timezone || 'UTC';
    $('#calendarTimezoneShort').textContent = zone.split('/').at(-1).replaceAll('_', ' ');
  }

  function filteredEvents() {
    const events = state.calendar?.events || [];
    const now = Date.now();
    if (state.calendarFilter === 'cancelled') return events.filter(event => event.status === 'cancelled');
    if (state.calendarFilter === 'upcoming') return events.filter(event => event.status === 'scheduled' && new Date(
      event.ends_at).getTime() >= now);
    return events;
  }

  function renderCalendarEvents() {
    const events = filteredEvents();
    const host = $('#calendarEventList');
    if (!host) return;
    const uniqueDates = [...new Set(events.slice(0, 12).map(event => new Date(event.starts_at).toDateString()))];
    $('#calendarDateRail').innerHTML = uniqueDates.length ? uniqueDates.map((date, index) => {
      const parsed = new Date(date);
      return `<div class="date-rail-item ${index === 0 ? 'active' : ''}"><span>${new Intl.DateTimeFormat(undefined,{weekday:'short'}).format(parsed)}</span><strong>${parsed.getDate()}</strong><small>${new Intl.DateTimeFormat(undefined,{month:'short'}).format(parsed)}</small></div>`;
    }).join('') : '<span class="ops-muted">No dates in this view.</span>';
    host.innerHTML = events.length ? events.map(event => {
        const start = new Date(event.starts_at);
        const status = event.status;
        const isHost = event.host_id === state.user.id;
        const participantCards = (event.participants || []).map(member =>
          `<span class="event-person-chip">${avatarHtml(member)}<span><strong>${escapeHtml(member.display_name)}</strong><small>@${escapeHtml(member.username)}</small></span></span>`
        ).join('');
        const inboxLink = event.conversation_id ?
          `<a class="btn btn-sm" href="notifications.html?conversation=${encodeURIComponent(event.conversation_id)}"><i class="bx bx-message-square-dots"></i> Open meeting thread</a>` : '';
        return `<article class="calendar-event-card ${escapeAttr(status)}" data-calendar-event-id="${escapeAttr(event.id)}">
        <div class="event-time"><strong>${escapeHtml(formatShortTime(event.starts_at))}</strong><span>${escapeHtml(formatDay(event.starts_at))}</span></div>
        <div class="event-main"><div class="event-title-line"><span class="event-role-pill ${isHost ? 'host' : 'invited'}"><i class="bx ${isHost ? 'bx-broadcast' : 'bx-user-check'}"></i>${isHost ? 'You host' : 'You are invited'}</span><h3>${escapeHtml(event.title)} ${status === 'cancelled' ? '<span class="ledger-type payment">Cancelled</span>' : ''}</h3></div><p>${escapeHtml(event.description || 'No session description was added.')}</p><div class="event-meta"><span><i class="bx bx-time"></i>${Math.round((new Date(event.ends_at)-start)/60000)} minutes</span><span><i class="bx bx-globe"></i>${escapeHtml(event.timezone)}</span><span><i class="bx bx-map"></i>${escapeHtml(event.meeting_url ? 'Online meeting' : event.location || 'Location not set')}</span><span><i class="bx bx-group"></i>${event.participants?.length || 0} invited</span></div>
        <div class="event-people-panel"><div class="event-host-summary"><span>Host</span><div>${avatarHtml(event.host)}<strong>${escapeHtml(event.host?.display_name || 'SwapLabs host')}</strong></div></div><div class="event-participant-summary"><span>Invited members</span><div class="event-person-chips">${participantCards || '<small>No additional members invited.</small>'}</div></div></div>
        ${event.meeting_url ? `<a class="event-meeting-link" href="${escapeAttr(event.meeting_url)}" target="_blank" rel="noopener"><i class="bx bx-link-external"></i><span><strong>External meeting link</strong><small>${escapeHtml(event.meeting_url)}</small></span></a>` : ''}
        <div class="event-video-action">${status !== 'cancelled' ? `<a class="btn btn-primary btn-sm" href="video-room.html?event=${encodeURIComponent(event.id)}"><i class="bx bx-video"></i> ${event.video_room_id ? 'Open live room' : 'Create live room'}</a>` : ''}${inboxLink}<span><i class="bx bx-shield-quarter"></i> Shared details and attendance enabled</span></div></div>
        <div class="event-actions">${event.viewer_can_edit && status !== 'cancelled' ? `<button class="ops-icon-button" type="button" data-event-edit="${escapeAttr(event.id)}" title="Reschedule or edit"><i class="bx bx-edit-alt"></i></button><button class="ops-icon-button" type="button" data-event-cancel="${escapeAttr(event.id)}" title="Cancel event"><i class="bx bx-x-circle"></i></button>` : ''}<button class="ops-icon-button" type="button" data-event-export="${escapeAttr(event.id)}" title="Export event"><i class="bx bx-export"></i></button><div class="event-export-menu" data-export-menu="${escapeAttr(event.id)}" hidden><a href="${escapeAttr(googleCalendarUrl(event))}" target="_blank" rel="noopener"><i class="bx bxl-google"></i> Google Calendar</a><a href="${escapeAttr(outlookCalendarUrl(event))}" target="_blank" rel="noopener"><i class="bx bxl-microsoft"></i> Outlook Calendar</a><a href="/api/calendar/events/${encodeURIComponent(event.id)}/ics"><i class="bx bx-download"></i> Download ICS</a></div></div>
      </article>`;
      }).join('') :
      '<div class="ops-empty"><i class="bx bx-calendar-x"></i><h3>No events in this view</h3><p>Schedule a member session or reserve a workshop place.</p></div>';
  }

  function addAvailabilitySlot(day, slot = {
    start: '09:00',
    end: '10:00'
  }) {
    const host = $(`.availability-slots[data-day="${day}"]`);
    if (!host || host.children.length >= 6) return;
    host.insertAdjacentHTML('beforeend',
      `<div class="availability-slot"><input type="time" value="${escapeAttr(slot.start)}" aria-label="${escapeAttr(day)} start time"><span>to</span><input type="time" value="${escapeAttr(slot.end)}" aria-label="${escapeAttr(day)} end time"><button type="button" data-remove-slot aria-label="Remove time range"><i class="bx bx-x"></i></button></div>`
      );
  }

  function renderAvailability() {
    const availability = state.calendar.availability;
    $('#availabilityTimezone').innerHTML = timezoneOptions(availability.timezone);
    $('#availabilityForm [name="buffer_minutes"]').value = String(availability.buffer_minutes ?? 15);
    const host = $('#availabilityWeek');
    host.innerHTML = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => {
      const slots = availability.weekly?.[day] || [];
      return `<div class="availability-day" data-availability-day="${day}"><label class="availability-day-name"><input type="checkbox" data-day-enabled="${day}" ${slots.length ? 'checked' : ''}><strong>${day[0].toUpperCase()+day.slice(1)}</strong></label><div class="availability-slots" data-day="${day}">${slots.map(slot => `<div class="availability-slot"><input type="time" value="${escapeAttr(slot.start)}" aria-label="${day} start time"><span>to</span><input type="time" value="${escapeAttr(slot.end)}" aria-label="${day} end time"><button type="button" data-remove-slot aria-label="Remove time range"><i class="bx bx-x"></i></button></div>`).join('')}</div><button class="availability-add" type="button" data-add-slot="${day}"><i class="bx bx-plus"></i> Add range</button></div>`;
    }).join('');
    $('#availabilityZoneLabel').textContent = availability.timezone.replaceAll('_', ' ');
    updateAvailabilityClock();
  }

  function updateAvailabilityClock() {
    const zone = $('#availabilityTimezone')?.value || state.calendar?.availability?.timezone || 'UTC';
    try {
      $('#availabilityClock').textContent = new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date());
      $('#availabilityZoneLabel').textContent = zone.replaceAll('_', ' ');
    } catch (_error) {
      /* Invalid zones cannot be selected. */ }
  }

  function resetCalendarForm() {
    const form = $('#calendarEventForm');
    if (!form) return;
    form.reset();
    form.elements.event_id.value = '';
    form.elements.conversation_id.value = new URLSearchParams(location.search).get('conversation') || '';
    $('#calendarFormTitle').textContent = 'Schedule a session';
    const zone = state.calendar?.availability?.timezone || state.user?.profile?.timezone || 'UTC';
    $('#calendarTimezone').value = zone;
    const start = new Date(Date.now() + 86400000);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    form.elements.starts_at.value = inTimezoneInput(start, zone);
    form.elements.ends_at.value = inTimezoneInput(end, zone);
    const participant = new URLSearchParams(location.search).get('participant');
    if (participant)[...form.elements.participant_ids.options].forEach(option => option.selected = option.value ===
      participant);
    $$('[name="reminder"]', form).forEach(input => input.checked = ['1440', '60'].includes(input.value));
    clearStatus(form);
  }

  function populateCalendarFormOptions() {
    const zone = state.calendar?.availability?.timezone || state.user?.profile?.timezone || 'UTC';
    $('#calendarTimezone').innerHTML = timezoneOptions(zone);
    $('#calendarParticipantsSelect').innerHTML = state.calendar.contacts.map(member =>
      `<option value="${escapeAttr(member.id)}">${escapeHtml(member.display_name)} · @${escapeHtml(member.username)}</option>`
      ).join('');
    resetCalendarForm();
  }

  function editCalendarEvent(eventId) {
    const event = state.calendar.events.find(item => item.id === eventId);
    const form = $('#calendarEventForm');
    if (!event || !form) return;
    form.elements.event_id.value = event.id;
    form.elements.title.value = event.title;
    form.elements.description.value = event.description || '';
    form.elements.location.value = event.location || '';
    form.elements.meeting_url.value = event.meeting_url || '';
    form.elements.timezone.value = event.timezone;
    form.elements.starts_at.value = inTimezoneInput(event.starts_at, event.timezone);
    form.elements.ends_at.value = inTimezoneInput(event.ends_at, event.timezone);
    form.elements.conversation_id.value = event.conversation_id || '';
    [...form.elements.participant_ids.options].forEach(option => option.selected = (event.participant_ids || [])
      .includes(option.value));
    $$('[name="reminder"]', form).forEach(input => input.checked = (event.reminders_minutes || []).includes(Number(
      input.value)));
    $('#calendarFormTitle').textContent = 'Reschedule or edit session';
    form.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  async function loadCalendar() {
    state.calendar = await api('/api/calendar');
    renderCalendarStats();
    populateCalendarFormOptions();
    renderCalendarEvents();
    renderAvailability();
  }

  async function syncCalendarEvents() {
    const result = await api('/api/calendar');
    if (!state.calendar) {
      state.calendar = result;
      renderCalendarStats();
      populateCalendarFormOptions();
      renderCalendarEvents();
      renderAvailability();
      return;
    }
    state.calendar.events = result.events;
    state.calendar.contacts = result.contacts;
    renderCalendarStats();
    renderCalendarEvents();
  }

  async function setupCalendar() {
    showAuthenticatedApp('#calendarApp');
    updateHeroClock(state.user.profile?.timezone || undefined);
    setInterval(() => updateHeroClock($('#availabilityTimezone')?.value || state.user.profile?.timezone), 30000);
    try {
      await loadCalendar();
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    const requestedEventId = new URLSearchParams(location.search).get('event');
    if (requestedEventId && state.calendar.events.some(item => item.id === requestedEventId)) {
      state.calendarFilter = 'all';
      $$('button', $('#calendarFilters')).forEach(item => item.classList.toggle('active', item.dataset
        .calendarFilter === 'all'));
      renderCalendarEvents();
      requestAnimationFrame(() => {
        const requestedCard = $(`[data-calendar-event-id="${CSS.escape(requestedEventId)}"]`);
        requestedCard?.classList.add('calendar-event-focus');
        requestedCard?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      })
    }
    $('#calendarFilters')?.addEventListener('click', event => {
      const button = event.target.closest('[data-calendar-filter]');
      if (!button) return;
      state.calendarFilter = button.dataset.calendarFilter;
      $$('button', $('#calendarFilters')).forEach(item => item.classList.toggle('active', item === button));
      renderCalendarEvents();
    });
    $('#calendarEventList')?.addEventListener('click', async event => {
      const edit = event.target.closest('[data-event-edit]'),
        cancel = event.target.closest('[data-event-cancel]'),
        exportButton = event.target.closest('[data-event-export]');
      if (edit) editCalendarEvent(edit.dataset.eventEdit);
      if (exportButton) {
        const menu = $(`[data-export-menu="${CSS.escape(exportButton.dataset.eventExport)}"]`);
        if (menu) menu.hidden = !menu.hidden;
      }
      if (cancel) {
        const item = state.calendar.events.find(entry => entry.id === cancel.dataset.eventCancel);
        if (!window.confirm(
            `Cancel ${item?.title || 'this session'}? Every member will see the cancellation in their meeting thread.`)) return;
        try {
          await api(`/api/calendar/events/${encodeURIComponent(cancel.dataset.eventCancel)}`, {
            method: 'DELETE'
          });
          await loadCalendar();
          toast('Session cancelled and participants notified.');
        } catch (error) {
          toast(error.message, 'error');
        }
      }
    });
    $('#calendarFormReset')?.addEventListener('click', resetCalendarForm);
    $('#calendarEventForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(event.currentTarget);
      const form = event.currentTarget;
      const button = $('button[type="submit"]', form);
      const id = form.elements.event_id.value;
      const payload = {
        title: form.elements.title.value,
        description: form.elements.description.value,
        starts_at: form.elements.starts_at.value,
        ends_at: form.elements.ends_at.value,
        timezone: form.elements.timezone.value,
        participant_ids: [...form.elements.participant_ids.selectedOptions].map(option => option.value),
        location: form.elements.location.value,
        meeting_url: form.elements.meeting_url.value,
        conversation_id: form.elements.conversation_id.value,
        reminders_minutes: $$('[name="reminder"]:checked', form).map(input => Number(input.value))
      };
      setButtonLoading(button, true, id ? 'Updating' : 'Scheduling');
      try {
        await api(id ? `/api/calendar/events/${encodeURIComponent(id)}` : '/api/calendar/events', {
          method: id ? 'PATCH' : 'POST',
          body: payload
        });
        await loadCalendar();
        setButtonLoading(button, false);
        setStatus(form, id ? 'Session rescheduled and participants notified.' :
          'Session scheduled and invitations sent.', 'success');
        toast(id ? 'Session updated.' : 'Session scheduled.');
      } catch (error) {
        setStatus(form, error.message);
        setButtonLoading(button, false);
      }
    });
    $('#availabilityWeek')?.addEventListener('click', event => {
      const add = event.target.closest('[data-add-slot]'),
        remove = event.target.closest('[data-remove-slot]');
      if (add) {
        addAvailabilitySlot(add.dataset.addSlot);
        $(`[data-day-enabled="${add.dataset.addSlot}"]`).checked = true;
      }
      if (remove) {
        const day = remove.closest('.availability-day');
        remove.closest('.availability-slot').remove();
        const slots = $$('.availability-slot', day);
        if (!slots.length) $('[data-day-enabled]', day).checked = false;
      }
    });
    $('#availabilityWeek')?.addEventListener('change', event => {
      const toggle = event.target.closest('[data-day-enabled]');
      if (!toggle) return;
      const day = toggle.dataset.dayEnabled;
      const slots = $(`.availability-slots[data-day="${day}"]`);
      if (toggle.checked && !slots.children.length) addAvailabilitySlot(day);
      if (!toggle.checked) slots.innerHTML = '';
    });
    $('#availabilityTimezone')?.addEventListener('change', updateAvailabilityClock);
    setInterval(updateAvailabilityClock, 1000);
    $('#availabilityForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(event.currentTarget);
      const weekly = {};
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
        weekly[day] = $$('.availability-slot', $(`[data-availability-day="${day}"]`)).map(row => ({
          start: $('input:first-child', row).value,
          end: $('input:nth-of-type(2)', row).value
        }));
      });
      const button = $('button[type="submit"]', event.currentTarget);
      setButtonLoading(button, true);
      try {
        const result = await api('/api/calendar/availability', {
          method: 'PATCH',
          body: {
            timezone: event.currentTarget.elements.timezone.value,
            buffer_minutes: Number(event.currentTarget.elements.buffer_minutes.value),
            weekly
          }
        });
        state.calendar.availability = result.availability;
        renderAvailability();
        setButtonLoading(button, false);
        setStatus(event.currentTarget, 'Weekly availability saved.', 'success');
        toast('Availability updated.');
      } catch (error) {
        setStatus(event.currentTarget, error.message);
        setButtonLoading(button, false);
      }
    });
    state.calendarPoll = setInterval(() => {
      if (!document.hidden) syncCalendarEvents().catch(() => {
        /* The next poll retries automatically. */ });
    }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncCalendarEvents().catch(() => {
        /* Keep the current agenda if offline. */ });
    });
  }

  /* Credit ledger */
  function creditEntrySearch(entry) {
    return `${entry.description} ${entry.type} ${entry.reference_id || ''} ${entry.counterparty?.display_name || ''} ${entry.counterparty?.username || ''}`
      .toLowerCase();
  }

  function typeLabel(type) {
    return String(type || '').replaceAll('_', ' ');
  }

  function renderCreditDisputes() {
    const host = $('#creditDisputeList'),
      disputes = state.credits?.disputes || [];
    host.innerHTML = disputes.map(item =>
      `<article class="dispute-card"><div class="dispute-card-head"><strong>${escapeHtml(item.reason)}</strong><span class="dispute-status ${escapeAttr(item.status)}">${escapeHtml(item.status)}</span></div><p>${escapeHtml(item.resolution==='pending'?'Administrator review pending':`Resolution: ${item.resolution}${item.refund_amount?` · ${item.refund_amount} credits`:''}`)}</p><p>${escapeHtml(formatDate(item.updated_at))}</p></article>`
      ).join('');
    $('#creditDisputeEmpty').hidden = disputes.length > 0;
  }

  function canDispute(entry) {
    return entry.type === 'payment' && Number(entry.amount) < 0 && !state.credits.disputes.some(item => item
      .ledger_entry_id === entry.id && ['open', 'reviewing'].includes(item.status));
  }

  function renderLedger() {
    const term = String($('#ledgerSearch')?.value || '').trim().toLowerCase(),
      type = $('#ledgerType')?.value || 'all';
    const entries = (state.credits?.entries || []).filter(entry => (type === 'all' || entry.type === type) &&
      creditEntrySearch(entry).includes(term));
    const rows = $('#ledgerRows'),
      mobile = $('#ledgerMobileList');
    const desktop = entry =>
      `<tr><td><div class="ledger-record"><strong>${escapeHtml(entry.description)}</strong><span>${escapeHtml(formatDate(entry.created_at))}<br>${escapeHtml(entry.reference_id||entry.id)}</span></div></td><td><span class="ledger-type ${escapeAttr(entry.type)}">${escapeHtml(typeLabel(entry.type))}</span></td><td><div class="ledger-party"><strong>${escapeHtml(entry.counterparty?.display_name||(entry.created_by==='system'?'SwapLabs system':entry.created_by||'Platform'))}</strong><span>${entry.counterparty?`@${escapeHtml(entry.counterparty.username)}`:escapeHtml(entry.reference_type||'platform')}</span></div></td><td><span class="ledger-amount ${Number(entry.amount)>0?'positive':Number(entry.amount)<0?'negative':''}">${Number(entry.amount)>0?'+':''}${Number(entry.amount)}</span></td><td><span class="ledger-balance">${Number(entry.balance_after)}</span></td><td>${canDispute(entry)?`<button class="ledger-dispute-button" type="button" data-credit-dispute="${escapeAttr(entry.id)}">Dispute</button>`:''}</td></tr>`;
    const card = entry =>
      `<article class="ledger-mobile-card"><div class="ledger-mobile-head"><span class="ledger-type ${escapeAttr(entry.type)}">${escapeHtml(typeLabel(entry.type))}</span><span class="ledger-amount ${Number(entry.amount)>0?'positive':Number(entry.amount)<0?'negative':''}">${Number(entry.amount)>0?'+':''}${Number(entry.amount)}</span></div><p><strong>${escapeHtml(entry.description)}</strong><br>${escapeHtml(formatDate(entry.created_at))}</p><div class="ledger-mobile-meta"><div><span>Member or source</span><strong>${escapeHtml(entry.counterparty?.display_name||'SwapLabs system')}</strong></div><div><span>Balance after</span><strong>${Number(entry.balance_after)} credits</strong></div></div>${canDispute(entry)?`<button class="ledger-dispute-button" type="button" data-credit-dispute="${escapeAttr(entry.id)}">Dispute payment</button>`:''}</article>`;
    rows.innerHTML = entries.map(desktop).join('');
    mobile.innerHTML = entries.map(card).join('');
    $('#ledgerEmpty').hidden = entries.length > 0;
  }

  function renderCredits() {
    const result = state.credits;
    $('#creditBalance').textContent = result.balance;
    $('#heroCreditBalance').textContent = result.balance;
    $('#creditEarned').textContent = result.stats.earned;
    $('#creditSpent').textContent = result.stats.spent;
    $('#creditDisputes').textContent = result.stats.open_disputes;
    const select = $('#creditRecipient'),
      current = select.value;
    select.innerHTML = '<option value="">Choose a member</option>' + result.contacts.map(member =>
      `<option value="${escapeAttr(member.id)}">${escapeHtml(member.display_name)} · @${escapeHtml(member.username)}</option>`
      ).join('');
    if (result.contacts.some(member => member.id === current)) select.value = current;
    renderLedger();
    renderCreditDisputes();
  }
  async function loadCredits() {
    state.credits = await api('/api/credits');
    renderCredits();
  }

  function openCreditDispute(entryId) {
    const entry = state.credits.entries.find(item => item.id === entryId);
    if (!entry) return;
    const form = $('#creditDisputeForm');
    form.elements.ledger_entry_id.value = entry.id;
    $('#creditDisputeContext').textContent =
      `Payment of ${Math.abs(entry.amount)} credits${entry.counterparty?` to ${entry.counterparty.display_name}`:''} on ${formatDate(entry.created_at)}. The original ledger entry remains unchanged during review.`;
    $('#creditDisputeModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeCreditDispute() {
    const modal = $('#creditDisputeModal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    $('#creditDisputeForm')?.reset();
    clearStatus($('#creditDisputeForm'));
  }
  async function setupCredits() {
    showAuthenticatedApp('#creditApp');
    try {
      await loadCredits();
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    $('#ledgerSearch')?.addEventListener('input', renderLedger);
    $('#ledgerType')?.addEventListener('change', renderLedger);
    $('#creditRefresh')?.addEventListener('click', () => loadCredits().catch(error => toast(error.message,
      'error')));
    $('#creditTransferForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(event.currentTarget);
      const fields = new FormData(event.currentTarget),
        button = $('button[type="submit"]', event.currentTarget);
      const amount = Number(fields.get('amount')),
        recipient = state.credits.contacts.find(item => item.id === fields.get('recipient_id'));
      if (!window.confirm(
          `Transfer ${amount} credit${amount===1?'':'s'} to ${recipient?.display_name||'this member'}?`))
        return;
      setButtonLoading(button, true, 'Transferring');
      try {
        await api('/api/credits/transfer', {
          method: 'POST',
          body: {
            recipient_id: fields.get('recipient_id'),
            amount,
            description: fields.get('description')
          }
        });
        event.currentTarget.reset();
        await loadCredits();
        setButtonLoading(button, false);
        setStatus(event.currentTarget, 'Payment recorded in both members’ ledgers.', 'success');
        toast('Credit payment complete.');
      } catch (error) {
        setStatus(event.currentTarget, error.message);
        setButtonLoading(button, false);
      }
    });
    const disputeClick = event => {
      const button = event.target.closest('[data-credit-dispute]');
      if (button) openCreditDispute(button.dataset.creditDispute);
    };
    $('#ledgerRows')?.addEventListener('click', disputeClick);
    $('#ledgerMobileList')?.addEventListener('click', disputeClick);
    $$('[data-close-credit-modal]').forEach(button => button.addEventListener('click', closeCreditDispute));
    $('#creditDisputeForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      clearStatus(event.currentTarget);
      const fields = new FormData(event.currentTarget),
        button = $('button[type="submit"]', event.currentTarget);
      setButtonLoading(button, true, 'Opening review');
      try {
        await api('/api/credits/disputes', {
          method: 'POST',
          body: {
            ledger_entry_id: fields.get('ledger_entry_id'),
            reason: fields.get('reason'),
            details: fields.get('details')
          }
        });
        setButtonLoading(button, false);
        closeCreditDispute();
        await loadCredits();
        toast('Dispute opened for administrator review.');
      } catch (error) {
        setStatus(event.currentTarget, error.message);
        setButtonLoading(button, false);
      }
    });
  }

  /* Live session hub */
  function filteredLiveSessions() {
    const now = Date.now();
    const query = state.liveSessionSearch.trim().toLowerCase();
    let events = (state.liveSessions?.events || []).filter(event => event.status === 'scheduled');
    if (state.liveSessionFilter === 'upcoming') {
      events = events.filter(event => new Date(event.ends_at).getTime() >= now);
    } else if (state.liveSessionFilter === 'rooms') {
      events = events.filter(event => event.video_room_id);
    } else if (state.liveSessionFilter === 'hosted') {
      events = events.filter(event => event.host_id === state.user.id);
    }
    if (query) {
      events = events.filter(event => [
        event.title,
        event.description,
        event.location,
        event.host?.display_name,
        ...(event.participants || []).map(member => `${member.display_name} ${member.username}`)
      ].join(' ').toLowerCase().includes(query));
    }
    return events.sort((first, second) => new Date(first.starts_at) - new Date(second.starts_at));
  }

  function renderLiveSessionHub() {
    const host = $('#liveSessionList');
    if (!host) return;
    const events = filteredLiveSessions();
    host.innerHTML = events.length ? events.map(event => {
      const startsAt = new Date(event.starts_at);
      const duration = Math.max(1, Math.round((new Date(event.ends_at) - startsAt) / 60000));
      const isHost = event.host_id === state.user.id;
      const roomParameter = event.video_room_id ?
        `room=${encodeURIComponent(event.video_room_id)}` : `event=${encodeURIComponent(event.id)}`;
      const roomLabel = event.video_room_id ? 'Open live room' : 'Prepare live room';
      const participantNames = (event.participants || []).map(member => member.display_name).join(', ');
      return `<article class="live-session-record">
        <div class="live-session-date"><span>${escapeHtml(new Intl.DateTimeFormat(undefined,{month:'short'}).format(startsAt))}</span><strong>${escapeHtml(String(startsAt.getDate()))}</strong><small>${escapeHtml(formatShortTime(event.starts_at))}</small></div>
        <div class="live-session-record-main"><div class="live-session-badges"><span><i class="bx ${isHost?'bx-broadcast':'bx-user-check'}"></i>${isHost?'You host':'You are invited'}</span><span class="${event.video_room_id?'room-open':''}"><i class="bx bx-video"></i>${event.video_room_id?'Room opened':'Room ready'}</span></div><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.description || 'No session description was added.')}</p><div class="live-session-record-meta"><span><i class="bx bx-time-five"></i>${duration} minutes</span><span><i class="bx bx-globe"></i>${escapeHtml(event.timezone || 'UTC')}</span><span><i class="bx bx-user"></i>${escapeHtml(event.host?.display_name || 'SwapLabs host')}</span><span><i class="bx bx-group"></i>${escapeHtml(participantNames || 'No additional participants')}</span></div></div>
        <div class="live-session-record-actions"><a class="btn btn-primary" href="video-room.html?${roomParameter}"><i class="bx bx-video-plus"></i>${roomLabel}</a><a class="btn btn-sm" href="calendar.html"><i class="bx bx-calendar"></i> Event details</a><small><i class="bx bx-shield-quarter"></i> Waiting room and attendance controls enabled</small></div>
      </article>`;
    }).join('') : `<div class="ops-empty live-session-empty"><i class="bx bx-video-off"></i><h3>No matching live sessions</h3><p>${state.liveSessionSearch ? 'Try a different search or filter.' : 'Create a calendar session or reserve a workshop. Your real room will appear here automatically.'}</p><div class="hero-actions"><a class="btn btn-primary" href="calendar.html"><i class="bx bx-calendar-plus"></i> Schedule session</a><a class="btn" href="workshops.html"><i class="bx bx-group"></i> Browse workshops</a></div></div>`;
  }

  async function loadLiveSessions() {
    state.liveSessions = await api('/api/calendar');
    renderLiveSessionHub();
  }

  async function setupLiveSessions() {
    showAuthenticatedApp('#liveSessionsApp');
    try {
      await loadLiveSessions();
    } catch (error) {
      $('#liveSessionList').innerHTML = `<div class="ops-empty"><i class="bx bx-error-circle"></i><h3>Sessions unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
      return;
    }
    $('#liveSessionSearch')?.addEventListener('input', event => {
      state.liveSessionSearch = event.currentTarget.value;
      renderLiveSessionHub();
    });
    $('#liveSessionFilter')?.addEventListener('change', event => {
      state.liveSessionFilter = event.currentTarget.value;
      renderLiveSessionHub();
    });
    $('#refreshLiveSessions')?.addEventListener('click', () => loadLiveSessions().catch(error => toast(error.message,
      'error')));
    state.liveSessionPoll = setInterval(() => {
      if (!document.hidden) loadLiveSessions().catch(() => {});
    }, 15000);
  }

  /* Administrator operations */
  function adminStatus(status) {
    return `<span class="dispute-status ${escapeAttr(status)}">${escapeHtml(status)}</span>`;
  }

  function adminEvidenceMessage(message, report) {
    const sender = message.sender?.display_name || message.sender_kind || 'Unknown sender';
    const reported = message.sender_id === report.reported_user_id;
    const selected = message.id === report.message_id;
    const copy = message.original_body || message.body || message.attachment?.name || 'Attachment';
    return `<article class="ops-evidence-message ${reported?'reported':''} ${selected?'selected':''}"><div class="ops-evidence-message-head"><span><strong>${escapeHtml(sender)}</strong><time>${escapeHtml(formatDate(message.created_at))}</time></span><span>${reported?'<b>Reported account</b>':''}${selected?'<b>Selected message</b>':''}</span></div><p>${escapeHtml(copy)}</p>${message.attachment?`<a href="${escapeAttr(message.attachment.url)}" target="_blank" rel="noopener"><i class="bx bx-paperclip"></i> ${escapeHtml(message.attachment.name)}</a>`:''}${message.sender_id?`<button class="ledger-dispute-button" type="button" data-admin-message="${escapeAttr(message.id)}" data-message-status="${message.moderation_status==='removed'?'visible':'removed'}">${message.moderation_status==='removed'?'Restore message':'Remove message'}</button>`:''}</article>`;
  }

  function adminReportSuspensionFields(report) {
    return `<div class="ops-report-suspension" data-report-suspension hidden><label><span>Length</span><input name="suspension_amount" type="number" min="1" max="365" value="1"></label><label><span>Unit</span><select name="suspension_unit"><option value="hours">Hours</option><option value="days" selected>Days</option><option value="weeks">Weeks</option><option value="minutes">Minutes</option></select></label><label class="wide"><span>Reason shown to the member</span><input name="suspension_reason" maxlength="1000" value="${escapeAttr(report.reported_user?.suspension_reason||'')}" placeholder="Explain the timed suspension"></label></div>`;
  }

  function reportSuspensionMinutes(fields) {
    const factor = {
      minutes: 1,
      hours: 60,
      days: 1440,
      weeks: 10080
    } [fields.get('suspension_unit')] || 1440;
    return Math.round(Math.max(1, Number(fields.get('suspension_amount') || 1)) * factor);
  }

  function setReportSuspensionVisibility(form) {
    const host = $('[data-report-suspension]', form);
    if (host) host.hidden = form.elements.action.value !== 'suspended';
  }

  function renderAdminReports() {
    const reports = state.operations.reports || [];
    if (!reports.length)
    return '<div class="ops-empty"><i class="bx bx-check-shield"></i><h3>No message reports</h3><p>New member safety reports will appear here with complete conversation evidence.</p></div>';
    return reports.map((report, index) => {
      const activity = report.conversation_activity || report.evidence || [];
      const conversationTitle = report.conversation?.title || report.conversation?.id ||
        'Conversation unavailable';
      return `<details class="ops-admin-record ops-message-report" ${(index===0&&['open','reviewing'].includes(report.status))?'open':''}><summary><span class="ops-admin-record-icon"><i class="bx bx-flag"></i></span><span><strong>${escapeHtml(report.category.replaceAll('_',' '))}: ${escapeHtml(report.reported_user?.profile?.display_name||'Former member')}</strong><span>Reported by ${escapeHtml(report.reporter?.display_name||'Former member')} · ${escapeHtml(formatDate(report.created_at))} · ${activity.length} messages</span></span>${adminStatus(report.status)}</summary><div class="ops-admin-record-body"><div class="ops-report-context"><div><span>Conversation</span><strong>${escapeHtml(conversationTitle)}</strong></div><div><span>Reported account</span><strong>${escapeHtml(report.reported_user?.profile?.display_name||'Former member')}</strong></div><div><span>Evidence captured</span><strong>${escapeHtml(formatDate(report.evidence_captured_at||report.created_at))}</strong></div></div><p class="ops-member-statement"><i class="bx bx-message-square-detail"></i><span><strong>Member statement</strong>${escapeHtml(report.details)}</span></p><div class="ops-evidence-heading"><div><strong>Full reported conversation activity</strong><span>Authorized administrators can review both sides of the conversation and moderate individual messages.</span></div><span>${activity.length} records</span></div><div class="ops-admin-evidence">${activity.length?activity.map(message=>adminEvidenceMessage(message,report)).join(''):'<p>No message evidence remains.</p>'}</div><form class="ops-admin-controls" data-admin-report-form="${escapeAttr(report.id)}"><select name="status" aria-label="Report status"><option ${report.status==='open'?'selected':''}>open</option><option ${report.status==='reviewing'?'selected':''}>reviewing</option><option ${report.status==='resolved'?'selected':''}>resolved</option><option ${report.status==='dismissed'?'selected':''}>dismissed</option></select><select name="action" aria-label="Moderation action"><option value="pending">No action yet</option><option value="dismissed">Dismiss report</option><option value="warning">Warning</option><option value="restricted">Restrict messaging</option><option value="suspended">Timed suspension</option><option value="restored">Restore account</option></select>${adminReportSuspensionFields(report)}<textarea name="admin_notes" placeholder="Private moderation notes">${escapeHtml(report.admin_notes||'')}</textarea><button class="btn btn-primary btn-sm" type="submit">Save review</button></form></div></details>`;
    }).join('');
  }

  function renderAdminDisputes() {
    const disputes = state.operations.disputes || [];
    return disputes.length ? disputes.map(item =>
        `<details class="ops-admin-record"><summary><span class="ops-admin-record-icon"><i class="bx bx-wallet"></i></span><span><strong>${escapeHtml(item.reason)} · ${Math.abs(item.ledger_entry?.amount||0)} credits</strong><span>${escapeHtml(item.user?.profile?.display_name||'Former member')} and ${escapeHtml(item.counterparty?.profile?.display_name||'Former member')} · ${escapeHtml(formatDate(item.created_at))}</span></span>${adminStatus(item.status)}</summary><div class="ops-admin-record-body"><p class="ops-muted">${escapeHtml(item.details)}</p><form class="ops-admin-controls" data-admin-dispute-form="${escapeAttr(item.id)}"><select name="resolution"><option value="approved">Approve full refund</option><option value="partial">Approve partial refund</option><option value="denied">Deny dispute</option></select><input name="refund_amount" type="number" min="0" max="${Math.abs(item.ledger_entry?.amount||0)}" value="${Math.abs(item.ledger_entry?.amount||0)}"><input value="Maximum ${Math.abs(item.ledger_entry?.amount||0)} credits" disabled><textarea name="admin_notes" required placeholder="Decision evidence and internal rationale">${escapeHtml(item.admin_notes||'')}</textarea><button class="btn btn-primary btn-sm" type="submit" ${['resolved','dismissed'].includes(item.status)?'disabled':''}>Resolve dispute</button></form></div></details>`
        ).join('') :
      '<div class="ops-empty"><i class="bx bx-check-circle"></i><h3>No credit disputes</h3><p>Outgoing-payment disputes will appear here for an administrator decision.</p></div>';
  }

  function renderAdminActivity() {
    return `<div class="ops-admin-table-wrap"><table class="ops-admin-table"><thead><tr><th>Account</th><th>Status</th><th>Messages</th><th>Reports received</th><th>Open reports</th><th>Events</th><th>Ledger records</th><th>Last message</th></tr></thead><tbody>${state.operations.activity.map(item=>`<tr><td><strong>${escapeHtml(item.user.profile.display_name)}</strong><br>@${escapeHtml(item.user.username)}</td><td>${escapeHtml(item.user.status)}${item.user.messaging_restricted?' · messaging restricted':''}</td><td>${item.messages_sent}</td><td>${item.reports_received}</td><td>${item.open_reports}</td><td>${item.calendar_events}</td><td>${item.ledger_entries}</td><td>${escapeHtml(item.last_message_at?formatDate(item.last_message_at):'Never')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderAdminEvents() {
    return `<div class="ops-admin-table-wrap"><table class="ops-admin-table"><thead><tr><th>Event</th><th>Status</th><th>Starts</th><th>Timezone</th><th>Host</th><th>Participants</th><th>Reschedules</th></tr></thead><tbody>${state.operations.events.map(item=>`<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(formatDate(item.starts_at))}</td><td>${escapeHtml(item.timezone)}</td><td>${escapeHtml(item.host?.display_name||'Former member')}</td><td>${item.participant_ids?.length||0}</td><td>${item.reschedule_history?.length||0}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderAdminLedger() {
    return `<div class="ops-admin-table-wrap"><table class="ops-admin-table"><thead><tr><th>ID</th><th>User</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Reference</th><th>Created by</th><th>Time</th></tr></thead><tbody>${state.operations.ledger.map(item=>`<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.user_id)}</td><td>${escapeHtml(typeLabel(item.type))}</td><td>${Number(item.amount)>0?'+':''}${Number(item.amount)}</td><td>${Number(item.balance_after)}</td><td>${escapeHtml(item.reference_id||item.reference_type)}</td><td>${escapeHtml(item.created_by)}</td><td>${escapeHtml(formatDate(item.created_at))}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderAdminOperations() {
    const host = $('#opsAdminView');
    if (!host) return;
    const views = {
      reports: renderAdminReports,
      disputes: renderAdminDisputes,
      activity: renderAdminActivity,
      events: renderAdminEvents,
      ledger: renderAdminLedger
    };
    host.innerHTML = views[state.adminTab]();
    if (state.adminTab === 'reports') $$('[data-admin-report-form]', host).forEach(form => {
      const report = state.operations.reports.find(item => item.id === form.dataset.adminReportForm);
      if (report && form.elements.action) form.elements.action.value = report.action || 'pending';
      setReportSuspensionVisibility(form);
    });
    $$('[data-admin-tab]').forEach(button => button.classList.toggle('active', button.dataset.adminTab === state
      .adminTab));
  }
  async function loadAdminOperations() {
    state.operations = await api('/api/admin/operations');
    const stats = state.operations.stats;
    [
      ['opsStatConversations', stats.conversations],
      ['opsStatMessages', stats.messages],
      ['opsStatReports', stats.open_reports],
      ['opsStatEvents', stats.scheduled_events],
      ['opsStatLedger', stats.ledger_entries],
      ['opsStatDisputes', stats.open_disputes]
    ].forEach(([id, value]) => {
      if ($(`#${id}`)) $(`#${id}`).textContent = value;
    });
    renderAdminOperations();
  }
  async function setupAdminOperations() {
    const container = $('#adminDashboard .container');
    if (!container || $('#opsAdminPanel')) return;
    container.insertAdjacentHTML('afterbegin',
      `<section class="ops-admin-panel" id="opsAdminPanel"><div class="ops-admin-header"><div><span class="ops-overline">Trust, communication, and exchange</span><h2>Operations moderation</h2><p>Review reported chats with complete activity evidence, moderate content, apply timed suspensions, resolve credit disputes, and inspect calendars and immutable ledger records.</p></div><button class="btn btn-sm" id="opsAdminRefresh" type="button"><i class="bx bx-refresh"></i> Refresh operations</button></div><div class="ops-admin-stats"><article><i class="bx bx-conversation"></i><strong id="opsStatConversations">0</strong><span>Direct conversations</span></article><article><i class="bx bx-message-dots"></i><strong id="opsStatMessages">0</strong><span>Messages and updates</span></article><article><i class="bx bx-flag"></i><strong id="opsStatReports">0</strong><span>Open reports</span></article><article><i class="bx bx-calendar"></i><strong id="opsStatEvents">0</strong><span>Scheduled events</span></article><article><i class="bx bx-list-check"></i><strong id="opsStatLedger">0</strong><span>Ledger records</span></article><article><i class="bx bx-error-circle"></i><strong id="opsStatDisputes">0</strong><span>Open disputes</span></article></div><div class="ops-admin-tabs"><button class="active" data-admin-tab="reports" type="button">Reported chats</button><button data-admin-tab="disputes" type="button">Credit disputes</button><button data-admin-tab="activity" type="button">Member activity</button><button data-admin-tab="events" type="button">Calendar events</button><button data-admin-tab="ledger" type="button">Immutable ledger</button></div><div class="ops-admin-view" id="opsAdminView"><div class="ops-loading"><i class="bx bx-loader-alt bx-spin"></i><span>Loading operations data</span></div></div></section>`
      );
    try {
      await loadAdminOperations();
    } catch (error) {
      $('#opsAdminView').innerHTML =
        `<div class="ops-empty"><i class="bx bx-error-circle"></i><h3>Operations data unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
    $('#opsAdminRefresh')?.addEventListener('click', () => loadAdminOperations().catch(error => toast(error.message,
      'error')));
    $('#opsAdminPanel')?.addEventListener('click', async event => {
      const tab = event.target.closest('[data-admin-tab]');
      if (tab) {
        state.adminTab = tab.dataset.adminTab;
        renderAdminOperations();
        return;
      }
      const moderation = event.target.closest('[data-admin-message]');
      if (moderation) {
        const removing = moderation.dataset.messageStatus === 'removed';
        const reason = removing ? window.prompt('Why should this message be removed?',
          'Community safety review') : '';
        if (removing && !reason) return;
        try {
          await api(`/api/admin/messages/${encodeURIComponent(moderation.dataset.adminMessage)}/moderate`, {
            method: 'PATCH',
            body: {
              status: moderation.dataset.messageStatus,
              reason
            }
          });
          await loadAdminOperations();
          toast(removing ? 'Message removed while evidence was preserved.' : 'Message restored.');
        } catch (error) {
          toast(error.message, 'error');
        }
      }
    });
    $('#opsAdminPanel')?.addEventListener('change', event => {
      const form = event.target.closest('[data-admin-report-form]');
      if (form && event.target.name === 'action') setReportSuspensionVisibility(form);
    });
    $('#opsAdminPanel')?.addEventListener('submit', async event => {
      const reportForm = event.target.closest('[data-admin-report-form]'),
        disputeForm = event.target.closest('[data-admin-dispute-form]');
      if (!reportForm && !disputeForm) return;
      event.preventDefault();
      const fields = new FormData(event.target),
        button = $('button[type="submit"]', event.target);
      setButtonLoading(button, true);
      try {
        if (reportForm) {
          const body = {
            status: fields.get('status'),
            action: fields.get('action'),
            admin_notes: fields.get('admin_notes')
          };
          if (body.action === 'suspended') {
            body.suspension_minutes = reportSuspensionMinutes(fields);
            body.suspension_reason = fields.get('suspension_reason');
          }
          await api(`/api/admin/message-reports/${encodeURIComponent(reportForm.dataset.adminReportForm)}`, {
            method: 'PATCH',
            body
          });
          toast('Moderation decision saved.');
        } else {
          await api(
          `/api/admin/credit-disputes/${encodeURIComponent(disputeForm.dataset.adminDisputeForm)}`, {
            method: 'PATCH',
            body: {
              resolution: fields.get('resolution'),
              refund_amount: Number(fields.get('refund_amount')),
              admin_notes: fields.get('admin_notes')
            }
          });
          toast('Credit dispute resolved with permanent ledger records.');
        }
        await loadAdminOperations();
      } catch (error) {
        toast(error.message, 'error');
        setButtonLoading(button, false);
      }
    });
  }

  async function initialize() {
    try {
      const auth = await api('/api/auth/me');
      state.csrf = auth.csrf_token || '';
      state.user = auth.authenticated ? auth.user : null;
    } catch (_error) {
      document.querySelectorAll('[data-server-required]').forEach(element => element.classList.add('show'));
      $('#opsLoading')?.setAttribute('hidden', '');
      return;
    }
    if (pageRoot && !state.user) {
      showAuthGate();
      return;
    }
    const page = pageRoot?.dataset.operationsPage;
    if (page === 'inbox') await setupInbox();
    if (page === 'calendar') await setupCalendar();
    if (page === 'credits') await setupCredits();
    if (page === 'live-sessions') await setupLiveSessions();
    if (adminRoot && state.user?.role === 'admin') await setupAdminOperations();
  }

  initialize();
})();
