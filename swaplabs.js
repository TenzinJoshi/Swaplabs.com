(() => {
  const preferenceDefaults = {
    theme: 'light',
    font_scale: 'default',
    content_density: 'comfortable',
    navigation_style: 'expanded',
    default_landing: 'dashboard',
    high_contrast: false,
    reduced_motion: false,
    link_underlines: false,
    focus_mode: false,
    show_ai_assistant: true,
    auto_play_testimonials: true
  };
  const preferenceKey = 'swaplabs-ui-preferences';
  const readStoredPreferences = () => {
    try {
      return {
        ...preferenceDefaults,
        ...JSON.parse(localStorage.getItem(preferenceKey) || '{}')
      };
    } catch (_error) {
      return {
        ...preferenceDefaults
      };
    }
  };
  const applyPreferences = (incoming = {}, persist = true) => {
    const preferences = {
      ...readStoredPreferences(),
      ...incoming
    };
    const root = document.documentElement;
    root.dataset.theme = preferences.theme === 'dark' ? 'dark' : 'light';
    root.dataset.fontScale = ['small', 'default', 'large', 'extra-large'].includes(preferences.font_scale) ?
      preferences.font_scale : 'default';
    root.dataset.density = preferences.content_density === 'compact' ? 'compact' : 'comfortable';
    root.dataset.navigation = preferences.navigation_style === 'compact' ? 'compact' : 'expanded';
    root.classList.toggle('pref-high-contrast', Boolean(preferences.high_contrast));
    root.classList.toggle('pref-reduced-motion', Boolean(preferences.reduced_motion));
    root.classList.toggle('pref-link-underlines', Boolean(preferences.link_underlines));
    root.classList.toggle('pref-focus-mode', Boolean(preferences.focus_mode));
    root.classList.toggle('pref-hide-assistant', preferences.show_ai_assistant === false);
    root.classList.toggle('pref-pause-testimonials', preferences.auto_play_testimonials === false);
    root.style.colorScheme = root.dataset.theme;
    if (persist) localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    window.dispatchEvent(new CustomEvent('swaplabs:preferences-applied', {
      detail: preferences
    }));
    return preferences;
  };
  window.SwapLabsPreferences = {
    defaults: preferenceDefaults,
    read: readStoredPreferences,
    apply: applyPreferences
  };
  applyPreferences(readStoredPreferences(), false);
  window.addEventListener('storage', event => {
    if (event.key === preferenceKey) applyPreferences(readStoredPreferences(), false);
  });
  document.head.insertAdjacentHTML('beforeend',
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css"><style>.grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}@media(max-width:650px){.grid-2{grid-template-columns:1fr}}</style>'
    );

  const pages = {
    platform: [
      ['Browse skills', 'browse-skills.html'],
      ['Skill matching', 'skill-matching.html'],
      ['Learning paths', 'learning-paths.html'],
      ['Skill assessments', 'skill-assessments.html'],
      ['Live sessions', 'live-sessions.html'],
      ['Skills & innovation', 'skill-innovation.html'],
      ['How it works', 'how-it-works.html'],
      ['Pricing', 'pricing.html'],
      ['FAQ', 'faq.html']
    ],
    community: [
      ['Member community', 'community.html'],
      ['Discussion forums', 'forums.html'],
      ['Groups', 'groups.html'],
      ['Leaderboards', 'leaderboards.html'],
      ['Community challenges', 'community-challenges.html'],
      ['Blog', 'blog.html'],
      ['Events', 'events.html'],
      ['Mentors', 'mentors.html'],
      ['Success stories', 'success-stories.html']
    ],
    learning: [
      ['Courses', 'courses.html'],
      ['Resources', 'resources.html'],
      ['Workshops', 'workshops.html'],
      ['Certifications', 'certifications.html']
    ],
    professional: [
      ['Become a mentor', 'become-a-mentor.html'],
      ['Talent directory', 'talent-directory.html'],
      ['Projects', 'projects.html'],
      ['Partner with us', 'partner-with-us.html']
    ],
    company: [
      ['About', 'about.html'],
      ['Careers', 'careers.html'],
      ['Privacy', 'privacy.html'],
      ['Terms', 'terms.html']
    ],
    support: [
      ['Help center', 'help-center.html'],
      ['Contact us', 'contact.html'],
      ['Complaints', 'complaint.html'],
      ['Feedback', 'feedback.html'],
      ['Report', 'report.html']
    ],
    account: [
      ['Dashboard', 'dashboard.html'],
      ['Log in', 'login.html'],
      ['Create account', 'register.html'],
      ['My profile', 'profile.html'],
      ['Inbox', 'notifications.html'],
      ['Calendar', 'calendar.html'],
      ['Credit ledger', 'credits.html'],
      ['Administration', 'admin.html']
    ]
  };
  const current = location.pathname.split('/').pop() || 'swaplabs.html';
  const active = href => current === href ? 'active' : '';
  const iconMap = {
    'Browse skills': 'bx-search-alt',
    'Skill matching': 'bx-git-compare',
    'Learning paths': 'bx-map-alt',
    'Skill assessments': 'bx-check-square',
    'Live sessions': 'bx-video',
    'Member community': 'bx-user-find',
    'Discussion forums': 'bx-conversation',
    'Groups': 'bx-group',
    'Leaderboards': 'bx-trophy',
    'Community challenges': 'bx-target-lock',
    'Courses': 'bx-book-open',
    'Resources': 'bx-library',
    'Workshops': 'bx-chalkboard',
    'Certifications': 'bx-badge-check',
    'Skills & innovation': 'bx-rocket',
    'Become a mentor': 'bx-user-voice',
    'Talent directory': 'bx-id-card',
    'Projects': 'bx-briefcase-alt-2',
    'Partner with us': 'bx-buildings',
    'Blog': 'bx-news',
    'Events': 'bx-calendar-event',
    'Mentors': 'bx-user-check',
    'Success stories': 'bx-line-chart',
    'How it works': 'bx-list-check',
    'Pricing': 'bx-purchase-tag',
    'FAQ': 'bx-help-circle',
    'About': 'bx-info-circle',
    'Careers': 'bx-briefcase',
    'Privacy': 'bx-lock-alt',
    'Terms': 'bx-file',
    'Help center': 'bx-support',
    'Contact us': 'bx-envelope',
    'Complaints': 'bx-message-square-error',
    'Feedback': 'bx-message-square-dots',
    'Report': 'bx-flag',
    'Dashboard': 'bx-grid-alt',
    'Log in': 'bx-log-in',
    'Create account': 'bx-user-plus',
    'My profile': 'bx-user-circle',
    'Inbox': 'bx-message-square-dots',
    'Calendar': 'bx-calendar',
    'Credit ledger': 'bx-wallet',
    'Administration': 'bx-shield-quarter'
  };
  const categoryMeta = {
    platform: ['Platform', 'bx-grid-alt', 'Find skills, matches, paths, assessments, and live learning.'],
    community: ['Community', 'bx-group', 'Meet members, join conversations, and contribute together.'],
    learning: ['Learning', 'bx-book-open', 'Explore courses, resources, workshops, and credentials.'],
    account: ['Account', 'bx-user-circle', 'Manage your profile, messages, calendar, credits, and access.'],
    professional: ['Professional', 'bx-briefcase-alt-2',
      'Mentor, find talent, build projects, and partner with us.'],
    company: ['Company', 'bx-buildings', 'Learn about SwapLabs, careers, privacy, and terms.'],
    support: ['Support', 'bx-support', 'Get help, contact the team, or send feedback and reports.']
  };
  const categoryOrder = ['platform', 'community', 'learning', 'account', 'professional', 'company', 'support'];
  const directoryPanels = categoryOrder.map((key, index) => {
    const [label, icon, description] = categoryMeta[key];
    const items = pages[key];
    return `<section class="nav-directory-panel ${index===0?'active':''}" data-directory-panel="${key}" aria-label="${label}"><div class="nav-directory-panel-head"><span class="nav-directory-panel-icon"><i class="bx ${icon}"></i></span><div><span>${items.length} destinations</span><h2>${label}</h2><p>${description}</p></div></div><div class="nav-directory-links">${items.map(([itemLabel,href])=>`<a class="${active(href)}" href="${href}"><i class="bx ${iconMap[itemLabel]||'bx-right-arrow-alt'}"></i><span><strong>${itemLabel}</strong><small>Open ${itemLabel.toLowerCase()}</small></span><i class="bx bx-chevron-right"></i></a>`).join('')}</div></section>`;
  }).join('');
  const directoryTabs = categoryOrder.map((key, index) => {
    const [label, icon] = categoryMeta[key];
    return `<button class="nav-directory-tab ${index===0?'active':''}" type="button" role="tab" aria-selected="${index===0}" data-directory-category="${key}"><i class="bx ${icon}"></i><span>${label}</span><i class="bx bx-chevron-right"></i></button>`
  }).join('');
  const header = document.querySelector('[data-site-header]');
  if (header) header.innerHTML =
    `<header class="site-header"><div class="container nav"><a class="brand" href="swaplabs.html"><img src="logo.jpg" alt="SwapLabs logo"><span>SwapLabs</span></a><nav class="nav-links" id="navLinks"><a class="${active('browse-skills.html')}" href="browse-skills.html">Skills</a><a class="${active('workshops.html')}" href="workshops.html">Workshops</a><a class="${active('community.html')}" href="community.html">Community</a><a class="${active('skill-innovation.html')}" href="skill-innovation.html">Innovation</a></nav><div class="nav-actions"><div class="nav-directory" data-nav-directory><button class="directory-menu-button" id="directoryMenuBtn" type="button" aria-label="Open complete website menu" aria-expanded="false" aria-controls="siteDirectoryMenu"><i class="bx bx-menu-alt-right"></i><span>Explore</span><i class="bx bx-chevron-down"></i></button><div class="nav-directory-menu" id="siteDirectoryMenu" aria-hidden="true"><div class="nav-directory-menu-top"><div><span class="eyebrow">Complete SwapLabs directory</span><strong>Where would you like to go?</strong></div><button class="nav-directory-close" type="button" data-directory-close aria-label="Close website menu"><i class="bx bx-x"></i></button></div><div class="nav-directory-body"><div class="nav-directory-tabs" role="tablist" aria-label="Website sections">${directoryTabs}</div><div class="nav-directory-content">${directoryPanels}</div></div><div class="nav-directory-foot"><span><i class="bx bx-command"></i> Hover, focus, or tap a section to see every page.</span><a href="profile.html#preferences"><i class="bx bx-cog"></i> Website settings</a></div></div></div><div class="auth-nav" data-auth-nav><a class="btn" href="login.html"><i class="bx bx-log-in"></i> Log in</a><a class="btn btn-primary" href="register.html">Create account</a></div></div></div><button class="nav-directory-backdrop" type="button" data-directory-close aria-label="Close website menu"></button></header>`;

  const directoryItems = [...pages.platform.slice(1, 6), ...pages.community.slice(0, 4), ...pages.learning, ...pages
    .professional
  ];
  const directory =
    `<section class="feature-directory"><div class="container"><div class="directory-head"><div><span class="eyebrow">Explore the complete platform</span><h2>More ways to learn, contribute, and build.</h2></div><a class="btn" href="help-center.html">View help center</a></div><div class="directory-grid">${directoryItems.map(([label,href])=>`<a class="directory-link" href="${href}"><i class="bx ${iconMap[label]}"></i><div><strong>${label}</strong><span>Open platform page</span></div></a>`).join('')}</div></div></section>`;
  const col = (title, icon, items) =>
    `<section class="footer-col"><h4><span class="footer-col-icon"><i class="bx ${icon}"></i></span><span>${title}</span></h4><div class="footer-link-list">${items.map(([label,href]) => `<a href="${href}"><span>${label}</span><i class="bx bx-chevron-right"></i></a>`).join('')}</div></section>`;
  const footer = document.querySelector('[data-site-footer]');
  if (footer) footer.innerHTML = `${directory}
    <section class="cta-band footer-cta"><div class="container footer-cta-shell"><div class="footer-cta-copy"><span class="footer-cta-kicker"><i class="bx bx-transfer-alt"></i> Your next exchange starts here</span><h2>Build your next skill with another person.</h2><p>Move from an explainable match to a useful conversation, a shared calendar, and visible progress.</p><div class="footer-cta-proof"><span><i class="bx bx-check-shield"></i> Trusted profiles</span><span><i class="bx bx-time-five"></i> Fair time credits</span><span><i class="bx bx-line-chart"></i> Progress that stays connected</span></div></div><div class="footer-cta-actions"><a class="btn btn-primary" href="skill-matching.html">Find a skill match <i class="bx bx-right-arrow-alt"></i></a><a class="footer-cta-link" href="how-it-works.html">See how the exchange works <i class="bx bx-chevron-right"></i></a></div></div></section>
    <footer class="site-footer"><div class="footer-aurora footer-aurora-one"></div><div class="footer-aurora footer-aurora-two"></div><div class="container">
      <div class="large-footer-intro"><div class="footer-intro-copy"><a class="brand" href="swaplabs.html"><img src="logo.jpg" alt="SwapLabs logo"><span>SwapLabs</span></a><span class="footer-intro-label"><i class="bx bx-network-chart"></i> The people-powered learning network</span><h2>Learn Anything. Teach Everything.</h2><p class="muted">SwapLabs combines human skill exchange, structured learning, community collaboration, and professional opportunities in one connected platform.</p><div class="footer-meta live-footer-metrics"><span><i class="bx bx-group"></i><strong data-platform-metric="active_members">—</strong><small>active members</small></span><span><i class="bx bx-bulb"></i><strong data-platform-metric="skills">—</strong><small>listed skills</small></span><span><i class="bx bx-world"></i><strong data-platform-metric="countries">—</strong><small>countries</small></span><span><i class="bx bx-time"></i><strong data-platform-metric="hours_exchanged">—</strong><small>hours exchanged</small></span></div></div>
      <form class="footer-newsletter" data-demo-form><span class="footer-newsletter-icon"><i class="bx bx-envelope-open"></i></span><div class="footer-newsletter-copy"><span>Useful, occasional updates</span><h3>Keep the next opportunity within reach.</h3><p>Receive selected workshops, challenges, mentor openings, and platform improvements.</p></div><div class="footer-newsletter-controls"><label class="sr-only" for="footerUpdateEmail">Email for platform updates</label><input id="footerUpdateEmail" type="email" required placeholder="you@example.com"><button class="btn btn-primary">Subscribe <i class="bx bx-send"></i></button></div><small class="footer-newsletter-privacy"><i class="bx bx-lock-alt"></i> No advertising lists. Unsubscribe whenever you choose.</small><div class="form-status">Subscription saved. Your next update will arrive here.</div></form></div>
      <div class="footer-grid"><div class="footer-brand"><span class="footer-brand-label"><i class="bx bx-infinite"></i> Learn Anything. Teach Everything.</span><p>People-powered learning through fair, practical exchange. Teach, learn, collaborate, and contribute at your own pace.</p><div class="footer-meta"><span>Remote friendly</span><span>Time-credit powered</span><span>Community reviewed</span></div><a class="footer-system-link" href="help-center.html"><span><i class="bx bx-radio-circle-marked"></i><strong>Platform guide available</strong><small>Help, safety, and account support</small></span><i class="bx bx-right-arrow-alt"></i></a></div>${col('Platform','bx-grid-alt',pages.platform)}${col('Community','bx-group',pages.community)}${col('Learning','bx-book-open',pages.learning)}${col('Professional','bx-briefcase-alt-2',pages.professional)}${col('Company','bx-buildings',pages.company)}${col('Support','bx-support',pages.support)}${col('Account','bx-user-circle',pages.account)}</div>
      <div class="footer-bottom"><span class="footer-copyright">Copyright 2026 SwapLabs. All rights reserved.</span><span class="footer-live-note"><i class="bx bx-pulse"></i> Live community counts update from real platform data.</span><nav class="footer-legal" aria-label="Footer legal links"><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="report.html">Report</a></nav></div>
    </div></footer>`;

  const formatPlatformMetric = value => Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 1
  });
  const refreshPlatformMetrics = async () => {
    try {
      const response = await fetch('/api/platform/metrics', {
        credentials: 'same-origin'
      });
      if (!response.ok) return null;
      const result = await response.json();
      Object.entries(result.metrics || {}).forEach(([key, value]) => document.querySelectorAll(
        `[data-platform-metric="${key}"]`).forEach(element => {
        element.textContent = formatPlatformMetric(value)
      }));
      window.SwapLabsSkillNames = Array.isArray(result.skill_names) ? result.skill_names : [];
      window.dispatchEvent(new CustomEvent('swaplabs:metrics-updated', {
        detail: {
          ...(result.metrics || {}),
          skill_names: window.SwapLabsSkillNames
        }
      }));
      return result.metrics || {};
    } catch (_error) {
      return null
    }
  };
  window.SwapLabsMetrics = {
    refresh: refreshPlatformMetrics
  };
  refreshPlatformMetrics();
  if (document.querySelector('[data-live-skill-typewriter]')) {
    setInterval(refreshPlatformMetrics, 30000)
  }

  const directoryRoot = document.querySelector('[data-nav-directory]');
  const directoryButton = document.getElementById('directoryMenuBtn');
  const directoryMenu = document.getElementById('siteDirectoryMenu');
  const setDirectoryCategory = key => {
    document.querySelectorAll('[data-directory-category]').forEach(button => {
      const activeCategory = button.dataset.directoryCategory === key;
      button.classList.toggle('active', activeCategory);
      button.setAttribute('aria-selected', String(activeCategory))
    });
    document.querySelectorAll('[data-directory-panel]').forEach(panel => panel.classList.toggle('active', panel
      .dataset.directoryPanel === key));
  };
  const setDirectoryOpen = open => {
    directoryRoot?.classList.toggle('open', open);
    document.querySelector('.site-header')?.classList.toggle('directory-open', open);
    directoryButton?.setAttribute('aria-expanded', String(open));
    directoryButton?.setAttribute('aria-label', open ? 'Close complete website menu' :
    'Open complete website menu');
    directoryMenu?.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('directory-menu-open', open);
  };
  directoryButton?.addEventListener('click', () => setDirectoryOpen(!directoryRoot?.classList.contains('open')));
  document.querySelectorAll('[data-directory-category]').forEach(button => {
    ['mouseenter', 'focus', 'click'].forEach(type => button.addEventListener(type, () => setDirectoryCategory(
      button.dataset.directoryCategory)));
  });
  document.querySelectorAll('[data-directory-close]').forEach(button => button.addEventListener('click', () =>
    setDirectoryOpen(false)));
  directoryMenu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setDirectoryOpen(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && directoryRoot?.classList.contains('open')) {
      setDirectoryOpen(false);
      directoryButton?.focus()
    }
  });

  document.querySelectorAll('.icon-box').forEach((box, index) => {
    if (!box.querySelector('i')) box.innerHTML =
      `<i class="bx ${['bx-bulb','bx-book','bx-group','bx-shield'][index%4]}"></i>`;
  });

  const knowledge = [{
      title: 'Member dashboard',
      page: 'dashboard.html',
      keys: 'dashboard home portal upcoming session recommended match credit balance pending request recent message progress next action',
      answer: 'After login, the Dashboard brings together your upcoming sessions, explainable match recommendations, credit balance, pending requests, recent messages, learning-goal progress, and the most useful next action.'
    },
    {
      title: 'Browse skills',
      page: 'browse-skills.html',
      keys: 'browse search find skill teacher category level python design language',
      answer: 'Browse Skills lets you search active teachers by topic, category, and experience level, then request an exchange.'
    },
    {
      title: 'Skill matching',
      page: 'skill-matching.html',
      keys: 'match matching recommendation compatible personalized teach learn algorithm why score reliability proficiency timezone overlap style empty',
      answer: 'Skill Matching ranks real members across nine visible factors: skill fit, learning goal, teaching style, session format, timezone-aware availability, language, proficiency, session history, and reliability. Open “Why this match?” to inspect every point.'
    },
    {
      title: 'Learning paths',
      page: 'learning-paths.html',
      keys: 'path roadmap beginner intermediate advanced progress milestone',
      answer: 'Learning Paths organize a goal into beginner, intermediate, and advanced milestones with recommended sessions, courses, resources, and assessments.'
    },
    {
      title: 'Skill assessments',
      page: 'skill-assessments.html',
      keys: 'assessment test quiz level beginner intermediate advanced score',
      answer: 'Skill Assessments are short diagnostic quizzes that estimate your current level and recommend the right starting point.'
    },
    {
      title: 'Live sessions',
      page: 'live-sessions.html',
      keys: 'live session video one on one group join schedule room',
      answer: 'Live Sessions lists one-to-one and group learning rooms. You can filter by topic, level, format, and start time, then reserve a place.'
    },
    {
      title: 'How it works',
      page: 'how-it-works.html',
      keys: 'how works start profile exchange steps process',
      answer: 'Create a profile, list what you teach and want to learn, review matches, agree on a session, meet, confirm the time, and leave feedback.'
    },
    {
      title: 'Pricing',
      page: 'pricing.html',
      keys: 'price pricing cost free plan plus teams subscription pay',
      answer: 'The Community plan is free. Plus adds advanced tools for active learners, while Teams supports private organizational communities.'
    },
    {
      title: 'Time-credit ledger',
      page: 'credits.html',
      keys: 'time credit wallet ledger hour earned teach spend balance payment refund correction dispute transfer',
      answer: 'The immutable Credit Ledger records every earning, member payment, refund, correction, and dispute. You can transfer credits and challenge an outgoing payment without altering its original record.'
    },
    {
      title: 'FAQ',
      page: 'faq.html',
      keys: 'faq question answer common help',
      answer: 'The FAQ covers cost, time credits, matching, local sessions, missed sessions, verification, and private groups.'
    },
    {
      title: 'Member login',
      page: 'login.html',
      keys: 'login log in sign in username email password account access',
      answer: 'Members can log in with either their username or email address plus their password. Administrator access uses a separate private ID and password.'
    },
    {
      title: 'Registration',
      page: 'register.html',
      keys: 'register registration sign up create account join member details',
      answer: 'Registration creates a member account and collects identity, location, languages, professional details, teaching skills, learning goals, availability, privacy preferences, and a secure password.'
    },
    {
      title: 'My profile',
      page: 'profile.html',
      keys: 'profile panel edit change name age country dob birthday personal customize settings',
      answer: 'The Profile panel lets you update your name, age, date of birth, country, city, languages, work details, bio, skills, goals, availability, privacy settings, profile accent, and password. Saved changes appear across SwapLabs.'
    },
    {
      title: 'Administration',
      page: 'admin.html',
      keys: 'admin administrator panel annotate suspend delete verify credit manage account moderation',
      answer: 'The protected Administration panel lets the administrator review complete account records, add private annotations, verify profiles, adjust time credits, suspend or reactivate access, delete member accounts, and review the audit log.'
    },
    {
      title: 'Inbox and messaging',
      page: 'notifications.html',
      keys: 'notification message messaging chat conversation attachment typing read mute block report follow request accept decline delete unread alert inbox bot swapbot',
      answer: 'The Inbox combines SwapBot account updates with private member conversations, attachments, typing and read states, mute controls, blocking, reporting, follow requests, and session scheduling.'
    },
    {
      title: 'Calendar and availability',
      page: 'calendar.html',
      keys: 'calendar availability timezone reminder schedule reschedule cancel google outlook ics export appointment meeting',
      answer: 'The Calendar stores sessions and workshop registrations, converts times across IANA timezones, sends SwapBot reminders, supports rescheduling and cancellation, and exports to Google Calendar, Outlook, or ICS.'
    },
    {
      title: 'Member community',
      page: 'community.html',
      keys: 'community people members users search profile follow private public real accounts directory',
      answer: 'The Member Community shows every active SwapLabs account. Search by name, username, country, language, occupation, role, or skill. Public profiles are fully visible, while private profiles reveal more only after an accepted follow request.'
    },
    {
      title: 'Discussion forums',
      page: 'forums.html',
      keys: 'forum discussion question advice reply post knowledge',
      answer: 'Discussion Forums are organized spaces for questions, advice, feedback, resource sharing, and detailed community conversations.'
    },
    {
      title: 'Groups',
      page: 'groups.html',
      keys: 'group club tribe community coding photography music design join',
      answer: 'Groups are interest-based communities for subjects such as coding, photography, music, design, languages, wellness, and local learning.'
    },
    {
      title: 'Leaderboards',
      page: 'leaderboards.html',
      keys: 'leaderboard ranking points helpful contribution rating top member',
      answer: 'Leaderboards recognize helpfulness, completed sessions, ratings, mentoring, resources, and community contributions.'
    },
    {
      title: 'Community challenges',
      page: 'community-challenges.html',
      keys: 'challenge monthly collaborate goal entry team streak',
      answer: 'Community Challenges are monthly collaborative prompts with milestones, teams, progress updates, and contribution badges.'
    },
    {
      title: 'Blog',
      page: 'blog.html',
      keys: 'blog journal article story guide news',
      answer: 'The SwapLabs Blog publishes practical learning guides, community stories, product updates, and safety advice.'
    },
    {
      title: 'Events',
      page: 'events.html',
      keys: 'event festival meetup calendar rsvp community night',
      answer: 'Events include virtual festivals, community nights, collaboration labs, and mentor clinics. Use the Events page to RSVP.'
    },
    {
      title: 'Mentors',
      page: 'mentors.html',
      keys: 'mentor teacher coach expert experienced top',
      answer: 'The Mentors directory highlights experienced, highly rated teachers across technology, design, languages, data, photography, and wellness.'
    },
    {
      title: 'Success stories',
      page: 'success-stories.html',
      keys: 'success story outcome result member transformation',
      answer: 'Success Stories shares real examples of career changes, creative growth, and local communities built through skill exchange.'
    },
    {
      title: 'Courses',
      page: 'courses.html',
      keys: 'course curriculum module lesson enroll structured cohort',
      answer: 'Courses are structured member-created programs with lessons, projects, discussions, progress tracking, and optional mentor feedback.'
    },
    {
      title: 'Resources',
      page: 'resources.html',
      keys: 'resource tutorial guide template tool material download library',
      answer: 'Resources collects tutorials, guides, templates, checklists, recommended tools, and member-curated learning materials.'
    },
    {
      title: 'Workshops',
      page: 'workshops.html',
      keys: 'workshop masterclass hands on instructor upcoming seat register reserve cancel',
      answer: 'Workshops are focused live learning experiences with practical exercises, transparent seat availability, searchable schedules, member hosts, and saved registrations.'
    },
    {
      title: 'Skills and innovation',
      page: 'skill-innovation.html',
      keys: 'innovation idea invention funding student young minds pitch support like comment save follow founder',
      answer: 'The Skills and Innovation Lab helps students and young creators publish world-changing ideas, explain funding needs, find collaborators, receive comments, earn community support, and follow idea owners.'
    },
    {
      title: 'Certifications',
      page: 'certifications.html',
      keys: 'certificate certification badge achievement credential verify exam',
      answer: 'Certifications combine assessments, completed work, mentor review, and verified badges that can appear on a member profile.'
    },
    {
      title: 'Become a mentor',
      page: 'become-a-mentor.html',
      keys: 'become mentor apply teach coach requirements mentor application',
      answer: 'The Become a Mentor page explains eligibility, review criteria, responsibilities, benefits, and the mentor application process.'
    },
    {
      title: 'Talent directory',
      page: 'talent-directory.html',
      keys: 'talent directory hire find person professional expert portfolio',
      answer: 'The Talent Directory helps teams and collaborators find members by skill, availability, location, experience, and verified achievements.'
    },
    {
      title: 'Projects',
      page: 'projects.html',
      keys: 'project collaborate teammate team apply portfolio build opportunity',
      answer: 'Projects lets members form teams, apply skills to real briefs, recruit collaborators, and produce portfolio-ready outcomes.'
    },
    {
      title: 'Partner with us',
      page: 'partner-with-us.html',
      keys: 'partner school organization company community partnership team education',
      answer: 'Partner With Us supports schools, companies, nonprofits, and communities that want private skill exchange, workshops, or learning programs.'
    },
    {
      title: 'About',
      page: 'about.html',
      keys: 'about mission values company swaplabs',
      answer: 'SwapLabs is built around equal time, useful trust, and human progress. Its mission is to make practical learning more accessible.'
    },
    {
      title: 'Careers',
      page: 'careers.html',
      keys: 'career job role hiring work team vacancy apply',
      answer: 'The Careers page lists open roles across product, engineering, trust and safety, and community programs.'
    },
    {
      title: 'Privacy',
      page: 'privacy.html',
      keys: 'privacy data information collect delete export control',
      answer: 'The Privacy page explains information collection, use, sharing, retention, and member rights such as access, correction, export, and deletion.'
    },
    {
      title: 'Terms',
      page: 'terms.html',
      keys: 'terms rules policy eligibility conduct account legal',
      answer: 'The Terms page describes account eligibility, community conduct, time credits, session responsibility, content, suspension, and termination.'
    },
    {
      title: 'Help center',
      page: 'help-center.html',
      keys: 'help support article guide problem account assistance',
      answer: 'The Help Center organizes guidance for getting started, credits, trust and safety, matching, events, groups, and account support.'
    },
    {
      title: 'Contact us',
      page: 'contact.html',
      keys: 'contact email message support press partnership question response',
      answer: 'Use Contact Us for general questions, account support, workshops, partnerships, press, careers, accessibility, or education programs. Every message receives a reference number.'
    },
    {
      title: 'Complaints',
      page: 'complaint.html',
      keys: 'complaint complain resolution service issue appeal dissatisfaction account billing workshop member',
      answer: 'The Complaints page records formal service, account, workshop, billing, accessibility, or moderation concerns and asks what resolution would help. Safety emergencies belong on the Report page.'
    },
    {
      title: 'Feedback and testimonials',
      page: 'feedback.html',
      keys: 'feedback testimonial review rating homepage belt quote experience suggestion',
      answer: 'Use Feedback to rate your experience and share a testimonial. With publication permission, your words are added to the rotating testimonial belt on the SwapLabs homepage.'
    },
    {
      title: 'Report',
      page: 'report.html',
      keys: 'report safety harassment fraud impersonation dispute no show inappropriate',
      answer: 'Use the confidential Report page for harassment, unsafe behavior, fraud, impersonation, missed sessions, credit disputes, or inappropriate content.'
    }
  ];
  const normalize = text => text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const distance = (a, b) => {
    const row = Array.from({
      length: b.length + 1
    }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const old = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = old
      }
    }
    return row[b.length]
  };
  const fuzzyWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && distance(a, b) <= 2) || (Math.min(a
    .length, b.length) >= 3 && distance(a, b) <= 1);
  const lookup = query => {
    const clean = normalize(query),
      words = clean.split(' ').filter(Boolean);
    if (words.some(w => fuzzyWord(w, 'hello') || fuzzyWord(w, 'hi'))) return {
      title: 'Welcome to SwapLabs',
      page: 'swaplabs.html',
      answer: 'Hello. I can answer questions about every SwapLabs page, feature, policy, learning option, community tool, and professional program.'
    };
    let best = null,
      bestScore = 0;
    knowledge.forEach(item => {
      const keyWords = normalize(item.keys + ' ' + item.title).split(' ');
      let score = 0;
      keyWords.forEach(key => {
        if (clean.includes(key)) score += 3;
        else if (words.some(word => fuzzyWord(word, key))) score += 1
      });
      if (score > bestScore) {
        best = item;
        bestScore = score
      }
    });
    return bestScore >= 2 ? best : {
      title: 'SwapLabs overview',
      page: 'swaplabs.html',
      answer: 'SwapLabs includes skill matching, learning paths, assessments, live sessions, forums, groups, leaderboards, challenges, courses, resources, workshops, certifications, mentors, talent, projects, partnerships, events, pricing, support, and safety tools. Ask about any one of these topics.'
    };
  };

  if (current !== 'notifications.html') {
    document.body.insertAdjacentHTML('beforeend',
      `<button class="swapbot-launch" id="chatLaunch" aria-label="Open SwapBot"><span class="swapbot-launch-icon"><i class="bx bx-bot"></i><i class="swapbot-online"></i></span><span>Ask SwapBot</span></button><aside class="swapbot-panel" id="chatPanel" aria-label="SwapBot assistant"><div class="swapbot-head"><div class="swapbot-title"><span class="swapbot-avatar"><i class="bx bx-bot"></i></span><div><strong>SwapBot</strong><span><i></i> Online website guide</span></div></div><button class="swapbot-close" id="chatClose" aria-label="Close chat"><i class="bx bx-x"></i></button></div><div class="swapbot-messages" id="chatMessages"><div class="swapbot-message"><span class="swapbot-message-label">SwapBot</span>Ask me about any SwapLabs page or feature. Spelling does not need to be perfect.</div></div><div class="swapbot-suggestions"><button data-chat-prompt="How does matching work?"><i class="bx bx-git-compare"></i> Matching</button><button data-chat-prompt="What courses are available?"><i class="bx bx-book-open"></i> Courses</button><button data-chat-prompt="How do time credits work?"><i class="bx bx-wallet"></i> Credits</button></div><form class="swapbot-form" id="chatForm"><input id="chatInput" placeholder="Ask a question" autocomplete="off"><button aria-label="Send"><i class="bx bx-send"></i></button></form><div class="swapbot-foot"><i class="bx bx-shield-quarter"></i> Answers use the complete SwapLabs site guide</div></aside>`
      );
    const panel = document.getElementById('chatPanel'),
      box = document.getElementById('chatMessages'),
      input = document.getElementById('chatInput');
    document.getElementById('chatLaunch').addEventListener('click', () => {
      panel.classList.toggle('open');
      document.getElementById('chatLaunch').classList.toggle('active', panel.classList.contains('open'));
      if (panel.classList.contains('open')) input.focus()
    });
    document.getElementById('chatClose').addEventListener('click', () => {
      panel.classList.remove('open');
      document.getElementById('chatLaunch').classList.remove('active')
    });
    const addUser = text => {
      const msg = document.createElement('div');
      msg.className = 'swapbot-message user';
      msg.textContent = text;
      box.appendChild(msg);
      box.scrollTop = box.scrollHeight
    };
    const typeBot = result => {
      const waiting = document.createElement('div');
      waiting.className = 'swapbot-message';
      waiting.innerHTML = '<div class="swapbot-typing"><span></span><span></span><span></span></div>';
      box.appendChild(waiting);
      box.scrollTop = box.scrollHeight;
      setTimeout(() => {
        waiting.innerHTML = '<span class="swapbot-message-label">SwapBot</span>';
        let i = 0;
        const timer = setInterval(() => {
          waiting.append(result.answer[i++] || '');
          box.scrollTop = box.scrollHeight;
          if (i > result.answer.length) {
            clearInterval(timer);
            const link = document.createElement('a');
            link.href = result.page;
            link.innerHTML = `Open ${result.title} <i class="bx bx-right-arrow-alt"></i>`;
            waiting.appendChild(document.createElement('br'));
            waiting.appendChild(link)
          }
        }, 9)
      }, 420)
    };
    const sendChat = text => {
      text = text.trim();
      if (!text) return;
      addUser(text);
      input.value = '';
      typeBot(lookup(text))
    };
    document.getElementById('chatForm').addEventListener('submit', e => {
      e.preventDefault();
      sendChat(input.value)
    });
    document.querySelectorAll('[data-chat-prompt]').forEach(button => button.addEventListener('click', () => sendChat(
      button.dataset.chatPrompt)));
  }

  document.getElementById('matchForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    sessionStorage.setItem('swaplabs-match-seed', JSON.stringify({
      teach_skills: values.get('teach_skills'),
      learn_skills: values.get('learn_skills'),
      session_format: values.get('session_format')
    }));
    document.getElementById('matchResult')?.classList.add('show');
    setTimeout(() => {
      location.href = 'skill-matching.html'
    }, 260)
  });
  document.querySelectorAll('.faq-q').forEach(q => q.addEventListener('click', () => q.parentElement.classList.toggle(
    'open')));
  document.querySelectorAll('[data-demo-form]').forEach(form => form.addEventListener('submit', e => {
    e.preventDefault();
    form.querySelector('.form-status')?.classList.add('show');
    if (!form.classList.contains('footer-newsletter')) form.reset()
  }));
  document.querySelectorAll('[data-rsvp]').forEach(btn => btn.addEventListener('click', () => {
    const going = btn.dataset.going === 'true';
    btn.dataset.going = String(!going);
    btn.innerHTML = !going ? '<i class="bx bx-check"></i> Going' : 'RSVP'
  }));
  document.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => {
    const label = btn.textContent.trim().toLowerCase();
    const done = label.includes('join') ? 'Joined' : label.includes('enroll') ? 'Enrolled' : label.includes(
        'apply') ? 'Applied' : label.includes('schedule') ? 'Scheduled' : label.includes('new topic') ?
      'Topic draft opened' : 'Saved';
    btn.innerHTML = `<i class="bx bx-check"></i> ${done}`;
    btn.disabled = true
  }));
  document.querySelectorAll('[data-price-toggle]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-price-toggle]').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    const annual = btn.dataset.priceToggle === 'annual';
    document.querySelectorAll('[data-monthly]').forEach(x => x.textContent = annual ? x.dataset.annual : x
      .dataset.monthly)
  }));
  document.querySelectorAll('[data-choice]').forEach(choice => choice.addEventListener('click', () => {
    choice.parentElement.querySelectorAll('[data-choice]').forEach(x => x.classList.remove('selected'));
    choice.classList.add('selected')
  }));

  const skillSearch = document.getElementById('skillSearch'),
    skillCategory = document.getElementById('skillCategory');
  const filterSkills = () => {
    const term = normalize(skillSearch?.value || ''),
      cat = skillCategory?.value || 'all';
    let visible = 0;
    document.querySelectorAll('.skill-card').forEach(card => {
      const show = normalize(card.textContent).includes(term) && (cat === 'all' || card.dataset.category ===
        cat);
      card.style.display = show ? 'flex' : 'none';
      if (show) visible++
    });
    document.getElementById('skillEmpty')?.classList.toggle('show', !visible)
  };
  skillSearch?.addEventListener('input', filterSkills);
  skillCategory?.addEventListener('change', filterSkills);
  document.getElementById('skillReset')?.addEventListener('click', () => {
    skillSearch.value = '';
    skillCategory.value = 'all';
    filterSkills()
  });

  const liveSkillTarget = document.querySelector('[data-live-skill-typewriter]');
  if (liveSkillTarget) {
    let skillPhrases = ['skills from members'];
    let skillPhraseIndex = 0;
    let skillCharacterIndex = 0;
    let deletingSkill = false;
    let skillTypewriterStarted = false;
    const reducedSkillMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.classList.contains('pref-reduced-motion');

    const updateSkillPhrases = values => {
      const next = [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim())
        .filter(Boolean))];
      if (!next.length) return;
      if (next.join('\u0000') === skillPhrases.join('\u0000')) return;
      skillPhrases = next;
      skillPhraseIndex = 0;
      skillCharacterIndex = 0;
      deletingSkill = false;
      if (reducedSkillMotion) liveSkillTarget.textContent = skillPhrases[0]
    };

    const typeLiveSkill = () => {
      const phrase = skillPhrases[skillPhraseIndex] || 'skills from members';
      liveSkillTarget.textContent = deletingSkill ?
        phrase.slice(0, Math.max(0, skillCharacterIndex--)) :
        phrase.slice(0, skillCharacterIndex++);
      let delay = deletingSkill ? 34 : 64;
      if (!deletingSkill && skillCharacterIndex > phrase.length) {
        deletingSkill = true;
        delay = 1650
      } else if (deletingSkill && skillCharacterIndex < 0) {
        deletingSkill = false;
        skillPhraseIndex = (skillPhraseIndex + 1) % skillPhrases.length;
        skillCharacterIndex = 0;
        delay = 320
      }
      setTimeout(typeLiveSkill, delay)
    };

    window.addEventListener('swaplabs:metrics-updated', event => {
      updateSkillPhrases(event.detail?.skill_names);
      if (!reducedSkillMotion && !skillTypewriterStarted) {
        skillTypewriterStarted = true;
        typeLiveSkill()
      }
    });
    updateSkillPhrases(window.SwapLabsSkillNames);
    if (reducedSkillMotion) {
      liveSkillTarget.textContent = skillPhrases[0]
    } else if (!skillTypewriterStarted) {
      skillTypewriterStarted = true;
      typeLiveSkill()
    }
  }

  const typeTarget = document.querySelector('.hero .gradient-text');
  if (typeTarget && !typeTarget.hasAttribute('data-static-motto')) {
    const phrases = ['Inspires You', 'Excites You', 'You Are Passionate About', 'Sparks Your Curiosity', 'Drives You',
      'You Enjoy', 'Fascinates You'
    ];
    typeTarget.innerHTML =
      '<span class="typewriter-static">Learn What</span> <span data-typewriter></span><span class="typewriter-cursor" aria-hidden="true"></span>';
    const output = typeTarget.querySelector('[data-typewriter]');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains(
        'pref-reduced-motion')) {
      output.textContent = phrases[0]
    } else {
      let phraseIndex = 0,
        charIndex = 0,
        deleting = false;
      const type = () => {
        const phrase = phrases[phraseIndex];
        output.textContent = deleting ? phrase.slice(0, charIndex--) : phrase.slice(0, charIndex++);
        let delay = deleting ? 34 : 62;
        if (!deleting && charIndex > phrase.length) {
          deleting = true;
          delay = 1500
        } else if (deleting && charIndex < 0) {
          deleting = false;
          phraseIndex = (phraseIndex + 1) % phrases.length;
          charIndex = 0;
          delay = 280
        }
        setTimeout(type, delay)
      };
      type();
    }
  }

  const isUtilityPage = pages.account.some(([, href]) => href === current) || ['community.html', 'workshops.html',
    'contact.html', 'complaint.html', 'feedback.html', 'skill-innovation.html', 'calendar.html', 'credits.html'
  ].includes(current);
  if (!isUtilityPage) {
    const contentScript = document.createElement('script');
    contentScript.src = 'swaplabs-content.js';
    contentScript.onload = () => {
      const moreScript = document.createElement('script');
      moreScript.src = 'swaplabs-more-content.js';
      document.body.appendChild(moreScript)
    };
    document.body.appendChild(contentScript);
  }
  const loadAuth = () => {
    const authScript = document.createElement('script');
    authScript.src = 'swaplabs-auth.js';
    document.body.appendChild(authScript)
  };
  const optionsScript = document.createElement('script');
  optionsScript.src = 'swaplabs-options.js';
  optionsScript.onload = loadAuth;
  optionsScript.onerror = loadAuth;
  document.body.appendChild(optionsScript);
  const platformScript = document.createElement('script');
  platformScript.src = 'swaplabs-platform.js';
  document.body.appendChild(platformScript);
  const operationsScript = document.createElement('script');
  operationsScript.src = 'swaplabs-operations.js';
  document.body.appendChild(operationsScript);
})();
