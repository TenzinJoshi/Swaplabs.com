(() => {
  const current = location.pathname.split('/').pop() || 'swaplabs.html';
  const categoryPages = {
    platform: ['swaplabs.html', 'browse-skills.html', 'how-it-works.html', 'pricing.html', 'skill-matching.html'],
    learning: ['learning-paths.html', 'skill-assessments.html', 'live-sessions.html', 'courses.html',
      'resources.html', 'workshops.html', 'certifications.html'
    ],
    community: ['forums.html', 'groups.html', 'leaderboards.html', 'community-challenges.html', 'blog.html',
      'events.html', 'mentors.html', 'success-stories.html'
    ],
    professional: ['become-a-mentor.html', 'talent-directory.html', 'projects.html', 'partner-with-us.html'],
    company: ['about.html', 'careers.html', 'privacy.html', 'terms.html'],
    support: ['faq.html', 'help-center.html', 'contact.html', 'report.html']
  };
  const category = Object.entries(categoryPages).find(([, files]) => files.includes(current))?.[0] || 'platform';
  const data = {
    platform: {
      label: 'Connected platform ecosystem',
      headline: 'Every feature supports the next useful action.',
      intro: 'Discovery becomes more valuable when matching, planning, live practice, evidence, community, and support are designed as one connected experience.',
      number: '32',
      numberLabel: 'connected platform destinations',
      cards: [
        ['bx-search-alt', 'Discover with context',
          'Search skills, people, sessions, paths, courses, and projects using goals rather than keywords alone.'
        ],
        ['bx-git-compare', 'Personalize decisions',
          'Use level, availability, format, style, reputation, language, and location to improve relevance.'
        ],
        ['bx-video', 'Practice with people',
          'Move from browsing into live sessions, mentoring, workshops, groups, and project collaboration.'
        ],
        ['bx-time-five', 'Exchange time fairly',
          'Earn time credits by teaching and spend them anywhere across the community.'
        ],
        ['bx-badge-check', 'Build useful evidence',
          'Connect assessments, projects, reviews, certifications, and contributions to one profile.'
        ],
        ['bx-support', 'Resolve problems clearly',
          'Use help, policies, contact routes, and confidential reporting when support is needed.'
        ]
      ],
      stages: [
        ['Discover', 'Define the skill, outcome, and level you need.'],
        ['Compare', 'Review people, formats, evidence, and timing.'],
        ['Prepare', 'Agree on goals, scope, and session expectations.'],
        ['Practice', 'Meet, build, discuss, and apply the skill.'],
        ['Continue', 'Review progress and choose the next action.']
      ],
      quote: 'SwapLabs gave me one place to discover a teacher, understand my level, plan a path, and actually keep going after the first session.',
      person: 'Mina Patel',
      role: 'Community learner and mentor',
      outcomes: [
        ['18', 'sessions completed'],
        ['4', 'skills exchanged'],
        ['92%', 'path completion']
      ],
      voices: [
        ['The match explanation helped me choose based on learning style, not just rating.', 'Ravi',
          'Frontend learner'
        ],
        ['Time credits made it possible to teach locally and learn remotely.', 'Elena', 'Language mentor'],
        ['My profile finally shows projects, reviews, and verified progress together.', 'Noah',
          'Product designer']
      ]
    },
    learning: {
      label: 'A richer learning system',
      headline: 'Combine structure, practice, feedback, and evidence.',
      intro: 'Effective learning rarely comes from one format. SwapLabs connects diagnostics, paths, courses, resources, live practice, workshops, projects, and certification.',
      number: '7',
      numberLabel: 'connected learning formats',
      cards: [
        ['bx-check-square', 'Diagnose the starting point',
          'Use short assessments to identify current understanding and missing foundations.'
        ],
        ['bx-map-alt', 'Follow an adaptable path',
          'Organize beginner, intermediate, and advanced milestones around a real outcome.'
        ],
        ['bx-book-open', 'Study structured material',
          'Use courses and resources for concepts, examples, references, and guided exercises.'
        ],
        ['bx-video', 'Practice live',
          'Join sessions, workshops, office hours, and conversation rooms with experienced members.'
        ],
        ['bx-briefcase-alt-2', 'Create practical work',
          'Use projects and challenges to apply skills in realistic contexts.'
        ],
        ['bx-badge-check', 'Verify achievement',
          'Combine assessment, evidence, peer interaction, and mentor review into credible certifications.'
        ]
      ],
      stages: [
        ['Assess', 'Estimate the current level and identify gaps.'],
        ['Plan', 'Choose milestones, formats, and a realistic schedule.'],
        ['Understand', 'Study examples, concepts, tools, and references.'],
        ['Apply', 'Practice live and produce concrete work.'],
        ['Demonstrate', 'Review evidence and verify the achieved level.']
      ],
      quote: 'The path stopped me from collecting random tutorials. Every course, workshop, and mentor session now contributes to one clear goal.',
      person: 'Aarav Singh',
      role: 'Data storytelling learner',
      outcomes: [
        ['24h', 'focused practice'],
        ['9', 'completed milestones'],
        ['1', 'verified badge']
      ],
      voices: [
        ['The assessment placed me exactly where I needed to start.', 'Lena', 'Python learner'],
        ['Workshops gave me feedback while I still had time to change the work.', 'Marco', 'Photography learner'],
        ['Certification felt credible because it included a real project and mentor review.', 'Sofia',
          'Data analyst'
        ]
      ]
    },
    community: {
      label: 'Community infrastructure',
      headline: 'Belonging grows through repeated, useful contribution.',
      intro: 'Healthy communities need more than profiles. Discussions, groups, events, challenges, recognition, mentoring, and shared stories create reasons to return and help.',
      number: '—',
      numberLabel: 'members learning together',
      metricKey: 'active_members',
      cards: [
        ['bx-conversation', 'Discuss with context',
          'Ask clear questions, preserve useful answers, and build a searchable knowledge commons.'
        ],
        ['bx-group', 'Practice in groups',
          'Create recurring spaces organized around subjects, locations, goals, and professional interests.'
        ],
        ['bx-calendar-event', 'Meet at shared moments',
          'Use events, clinics, circles, and festivals to discover people and begin collaboration.'
        ],
        ['bx-target-lock', 'Build through challenges',
          'Work toward monthly prompts with teams, milestones, critique, and visible outcomes.'
        ],
        ['bx-trophy', 'Recognize contribution',
          'Celebrate helpfulness, reliability, teaching, resources, moderation, and project work.'
        ],
        ['bx-user-check', 'Learn from mentors',
          'Connect with experienced facilitators who help members make better decisions independently.'
        ]
      ],
      stages: [
        ['Join', 'Choose a group, discussion, event, or challenge.'],
        ['Introduce', 'Share what you teach, learn, and hope to contribute.'],
        ['Participate', 'Ask, answer, attend, review, or create.'],
        ['Collaborate', 'Form repeated partnerships and shared work.'],
        ['Contribute', 'Support newer members and strengthen the community.']
      ],
      quote: 'I joined for one photography question and stayed because the group turned into a weekly practice community where everyone contributes.',
      person: 'Camille Ross',
      role: 'Community host',
      outcomes: [
        ['46', 'group sessions'],
        ['312', 'helpful replies'],
        ['88%', 'repeat members']
      ],
      voices: [
        ['The forum helped me solve a problem and understand why the solution worked.', 'Theo', 'Developer'],
        ['Our group has enough rhythm to keep me practicing every week.', 'Maya', 'Language learner'],
        ['The challenge gave our team a real deadline and a shared reason to finish.', 'Iris',
          'Community designer'
        ]
      ]
    },
    professional: {
      label: 'Professional opportunity layer',
      headline: 'Turn demonstrated skills into trusted collaboration.',
      intro: 'Mentoring, talent profiles, projects, and partnerships connect learning evidence with practical contribution and professional opportunity.',
      number: '9.4k',
      numberLabel: 'visible professional profiles',
      cards: [
        ['bx-user-voice', 'Develop as a mentor',
          'Use teaching frameworks, reviews, resources, courses, and office hours to guide learners responsibly.'
        ],
        ['bx-id-card', 'Show evidence clearly',
          'Present verified skills, project roles, certifications, ratings, and availability with member-controlled visibility.'
        ],
        ['bx-briefcase-alt-2', 'Join real projects',
          'Apply capabilities to clear briefs, collaborate across disciplines, and document individual contributions.'
        ],
        ['bx-buildings', 'Create partner programs',
          'Support schools, teams, nonprofits, libraries, and communities with structured peer learning.'
        ],
        ['bx-badge-check', 'Verify practical ability',
          'Use assessment, work samples, reviews, and completed participation to strengthen trust.'
        ],
        ['bx-network-chart', 'Build lasting connections',
          'Move from a single exchange into mentoring, collaboration, referrals, and long-term communities.'
        ]
      ],
      stages: [
        ['Prepare', 'Clarify skills, evidence, availability, and goals.'],
        ['Publish', 'Make the relevant profile or opportunity visible.'],
        ['Connect', 'Review fit, expectations, roles, and boundaries.'],
        ['Collaborate', 'Teach, build, review, or deliver together.'],
        ['Document', 'Record outcomes, evidence, feedback, and next opportunities.']
      ],
      quote: 'A community project gave me the evidence I needed, while mentoring helped me explain my decisions with much more confidence.',
      person: 'Dev Malik',
      role: 'Frontend mentor',
      outcomes: [
        ['6', 'project contributions'],
        ['21', 'mentor sessions'],
        ['3', 'professional referrals']
      ],
      voices: [
        ['Talent search based on verified skills is far more useful than scanning titles.', 'Aisha',
          'Program lead'
        ],
        ['The project brief made scope and individual credit clear from the start.', 'Jon', 'Researcher'],
        ['Our partnership created cross-team learning that formal training never reached.', 'Mei',
          'People operations'
        ]
      ]
    },
    company: {
      label: 'Responsible company foundations',
      headline: 'Trust depends on transparent decisions and usable policies.',
      intro: 'Mission, team practices, privacy, terms, governance, and accountability shape whether the platform can support a healthy learning community.',
      number: '—',
      numberLabel: 'countries in the community',
      metricKey: 'countries',
      cards: [
        ['bx-bulb', 'A clear mission',
          'Make practical learning accessible through equal time, mutual contribution, and human relationships.'
        ],
        ['bx-shield-quarter', 'Responsible trust systems',
          'Combine understandable rules, proportional enforcement, appeals, safety support, and careful moderation.'
        ],
        ['bx-lock-alt', 'Privacy by design',
          'Collect what the service needs and give members understandable control over visibility and use.'
        ],
        ['bx-group', 'A deliberate team culture',
          'Use documentation, focused collaboration, inclusive hiring, and direct accountability.'
        ],
        ['bx-file', 'Plain-language policies',
          'Explain rights, responsibilities, credits, content, sessions, and enforcement without unnecessary complexity.'
        ],
        ['bx-line-chart', 'Measured community impact',
          'Track learning, contribution, access, safety, satisfaction, and long-term participation.'
        ]
      ],
      stages: [
        ['Listen', 'Understand member needs, risks, and barriers.'],
        ['Define', 'Set principles, policy, ownership, and success criteria.'],
        ['Build', 'Create accessible tools and operational processes.'],
        ['Review', 'Measure outcomes, incidents, feedback, and unintended effects.'],
        ['Improve', 'Publish changes and update the system responsibly.']
      ],
      quote: 'The platform feels trustworthy because the product, policies, privacy choices, and support routes all tell the same clear story.',
      person: 'Leah Morgan',
      role: 'Community researcher',
      outcomes: [
        ['96%', 'policy clarity'],
        ['1 day', 'support response'],
        ['4.8', 'trust rating']
      ],
      voices: [
        ['Privacy controls are written like product choices, not legal traps.', 'Nadia', 'Community member'],
        ['The terms explain time credits and member responsibilities clearly.', 'Felix', 'Group organizer'],
        ['The mission is visible in how the platform recognizes every hour equally.', 'Sara', 'Learning partner']
      ]
    },
    support: {
      label: 'Support and safety system',
      headline: 'Good support turns uncertainty into a clear next step.',
      intro: 'Help content, FAQs, human contact, privacy guidance, and confidential reporting work together so members can resolve questions and concerns.',
      number: '96%',
      numberLabel: 'helpful resolution rating',
      cards: [
        ['bx-search-alt', 'Find the right guidance',
          'Search by the affected feature, workflow, account state, or issue rather than broad categories alone.'
        ],
        ['bx-list-check', 'Troubleshoot methodically',
          'Compare expected behavior, observed behavior, timing, references, and steps already attempted.'
        ],
        ['bx-envelope', 'Reach human support',
          'Route account, product, partnership, privacy, career, and general questions to the right team.'
        ],
        ['bx-flag', 'Report confidentially',
          'Use the dedicated route for harassment, unsafe behavior, fraud, disputes, or inappropriate content.'
        ],
        ['bx-time-five', 'Understand response timing',
          'Urgent safety concerns receive priority while standard questions follow clear service expectations.'
        ],
        ['bx-check-shield', 'Close the loop',
          'Receive a resolution summary, required action, policy context, and available follow-up or appeal route.'
        ]
      ],
      stages: [
        ['Identify', 'Choose the feature, issue, and urgency level.'],
        ['Search', 'Review the closest help or policy guidance.'],
        ['Document', 'Collect safe, relevant dates, references, and context.'],
        ['Contact', 'Use support, privacy, partnership, or reporting routes.'],
        ['Resolve', 'Follow the response and keep the confirmation.']
      ],
      quote: 'I found the right article, tried the documented steps, and sent a clear support request with exactly the context the team needed.',
      person: 'Daniel Wu',
      role: 'SwapLabs member',
      outcomes: [
        ['18m', 'average self-service'],
        ['1 day', 'human response'],
        ['94%', 'issues resolved']
      ],
      voices: [
        ['The help center explained the credit correction process without jargon.', 'Anya', 'Learner'],
        ['Reporting separated urgent safety concerns from standard account support.', 'Chris', 'Mentor'],
        ['The contact categories made it obvious where my partnership question belonged.', 'Priya',
          'School coordinator'
        ]
      ]
    }
  } [category];
  const title = current === 'swaplabs.html' ? 'SwapLabs Home' : (document.querySelector('.page-hero h1,.hero h1')
    ?.textContent.trim() || 'SwapLabs');
  const html =
    `<div class="more-content"><section class="more-section soft"><div class="container"><div class="more-heading"><span class="eyebrow">${data.label}</span><h2>${data.headline}</h2><p>${data.intro}</p></div><div class="ecosystem-shell"><div class="ecosystem-lead"><div><span class="tag" style="background:rgba(255,255,255,.12);color:#fff">${title}</span><h3>A larger view of how this page connects to the full SwapLabs experience.</h3><p>Use the surrounding tools to move from information into practice, evidence, collaboration, and continued progress.</p></div><div><div class="big-number"${data.metricKey?` data-platform-metric="${data.metricKey}"`:''}>${data.number}</div><small>${data.numberLabel}</small></div></div><div class="ecosystem-grid">${data.cards.map(([icon,heading,copy],i)=>`<article class="ecosystem-card"><i class="bx ${icon}"></i><h3>${heading}</h3><p>${copy}</p><a class="mini-link" href="${['browse-skills.html','learning-paths.html','live-sessions.html','groups.html','projects.html','help-center.html'][i]}">Explore this area <i class="bx bx-right-arrow-alt"></i></a></article>`).join('')}</div></div></div></section><section class="more-section"><div class="container"><div class="more-heading center"><span class="eyebrow">A complete journey</span><h2>From first interest to meaningful evidence.</h2><p>Each stage supports a different decision. Move at your own pace and return whenever your goal changes.</p></div><div class="timeline-big">${data.stages.map(([stage,copy],i)=>`<article class="timeline-stage"><span class="stage-dot"></span><span>PHASE 0${i+1}</span><h3>${stage}</h3><p>${copy}</p></article>`).join('')}</div></div></section><section class="more-section soft"><div class="container"><div class="more-heading"><span class="eyebrow">Member outcome</span><h2>What progress can look like in practice.</h2><p>Results depend on context and consistent effort, but member stories show how connected features create useful momentum.</p></div><div class="case-study-grid"><article class="story-panel"><i class="bx bxs-quote-left" style="font-size:1.8rem;color:var(--indigo)"></i><blockquote>${data.quote}</blockquote><div class="story-person"><span class="avatar">${data.person.split(' ').map(x=>x[0]).join('').slice(0,2)}</span><div><strong>${data.person}</strong><small>${data.role}</small></div></div></article><div class="outcome-stack">${data.outcomes.map(([value,label],i)=>`<div class="outcome-card ${i===2?'wide':''}"><strong>${value}</strong><span>${label}</span></div>`).join('')}<div class="outcome-card wide"><strong>One connected record</strong><span>Sessions, notes, evidence, feedback, contributions, and next steps stay together.</span></div></div></div></div></section><section class="more-section"><div class="container"><div class="more-heading"><span class="eyebrow">Personal learning planner</span><h2>See what a realistic rhythm can produce.</h2><p>Adjust the available hours and time horizon. The estimate updates immediately and helps keep plans achievable.</p></div><div class="planner-shell"><div class="planner-controls"><div class="range-row"><label>Hours available each week <output data-hours-output>3 hours</output></label><input type="range" min="1" max="12" value="3" data-hours-range><div class="range-caption"><span>1 hour</span><span>12 hours</span></div></div><div class="range-row"><label>Planning horizon <output data-weeks-output>8 weeks</output></label><input type="range" min="2" max="24" value="8" data-weeks-range><div class="range-caption"><span>2 weeks</span><span>24 weeks</span></div></div><div class="range-row"><label>Practice consistency <output data-consistency-output>75%</output></label><input type="range" min="40" max="100" step="5" value="75" data-consistency-range><div class="range-caption"><span>Flexible</span><span>Very consistent</span></div></div></div><div class="planner-results"><div class="planner-result primary"><strong data-total-hours>18 hours</strong><span>estimated focused learning time</span></div><div class="planner-result"><strong data-session-count>12</strong><span>possible 90-minute sessions</span></div><div class="planner-result"><strong data-milestone-count>3</strong><span>realistic milestones</span></div><a class="btn btn-primary" href="learning-paths.html" style="grid-column:1/-1">Build a learning path <i class="bx bx-right-arrow-alt"></i></a></div></div></div></section><section class="more-section soft"><div class="container"><div class="more-heading center"><span class="eyebrow">Member perspectives</span><h2>Why connected learning feels different.</h2><p>Members value the combination of structure, human context, contribution, and visible progress.</p></div><div class="voice-grid">${data.voices.map(([quote,name,role])=>`<article class="voice-card"><i class="bx bxs-quote-left"></i><p>${quote}</p><div class="story-person"><span class="avatar">${name.split(' ').map(x=>x[0]).join('').slice(0,2)}</span><div><strong>${name}</strong><small>${role}</small></div></div></article>`).join('')}</div></div></section></div>`;
  document.querySelector('.page-expansion')?.insertAdjacentHTML('beforeend', html);
  window.SwapLabsMetrics?.refresh();
  const hours = document.querySelector('[data-hours-range]'),
    weeks = document.querySelector('[data-weeks-range]'),
    consistency = document.querySelector('[data-consistency-range]');
  const calculate = () => {
    const h = Number(hours.value),
      w = Number(weeks.value),
      c = Number(consistency.value);
    const total = Math.round(h * w * c / 100);
    document.querySelector('[data-hours-output]').textContent = `${h} ${h===1?'hour':'hours'}`;
    document.querySelector('[data-weeks-output]').textContent = `${w} weeks`;
    document.querySelector('[data-consistency-output]').textContent = `${c}%`;
    document.querySelector('[data-total-hours]').textContent = `${total} hours`;
    document.querySelector('[data-session-count]').textContent = Math.max(1, Math.floor(total / 1.5));
    document.querySelector('[data-milestone-count]').textContent = Math.max(1, Math.floor(total / 6))
  };
  [hours, weeks, consistency].forEach(input => input?.addEventListener('input', calculate));
  calculate();
})();
