(() => {
  const current = location.pathname.split('/').pop() || 'swaplabs.html';
  const configs = {
    'swaplabs.html': {
      cat: 'platform',
      name: 'The complete SwapLabs experience',
      intro: 'Move from curiosity to confident practice through matching, structured learning, live collaboration, community support, and professional opportunities.',
      topics: [
        ['A connected learning profile',
          'Keep skills, goals, evidence, sessions, resources, projects, and achievements in one evolving profile.'
        ],
        ['A fair exchange economy',
          'Use time credits to separate whom you teach from whom you learn with, making more matches possible.'
        ],
        ['A platform that rewards contribution',
          'Helpful answers, reliable sessions, mentoring, resources, and project work all strengthen community reputation.'
        ]
      ],
      steps: ['Complete your teaching and learning profile', 'Save one learning path and assessment',
        'Book or request your first session'
      ]
    },
    'browse-skills.html': {
      cat: 'platform',
      name: 'Explore the full skill marketplace',
      intro: 'Go beyond a simple subject search with evidence, teaching style, availability, session format, level, language, and location context.',
      topics: [
        ['Search by real learning intent',
          'Combine topics with goals such as portfolio feedback, conversation practice, project review, or beginner foundations.'
        ],
        ['Compare useful trust signals',
          'Review verification, completed sessions, learner feedback, mentor status, and demonstrated work.'
        ],
        ['Save a focused shortlist',
          'Keep promising skills and teachers together before deciding whom to contact.'
        ]
      ],
      steps: ['Search for one specific learning outcome', 'Compare at least three teacher profiles',
        'Send a clear and respectful swap request'
      ]
    },
    'how-it-works.html': {
      cat: 'platform',
      name: 'Understand every stage of an exchange',
      intro: 'See how profiles, matching, communication, scheduling, session confirmation, reviews, and time credits work together.',
      topics: [
        ['Prepare before requesting',
          'A useful request explains what you can offer, what you hope to learn, and the time you can realistically commit.'
        ],
        ['Agree on one session outcome',
          'Small, specific outcomes create better first sessions than broad promises to teach an entire subject.'
        ],
        ['Close the loop properly',
          'Confirm time, exchange feedback, save useful notes, and agree on the next step before leaving.'
        ]
      ],
      steps: ['Write one teachable outcome for your strongest skill', 'Choose a realistic first learning goal',
        'Review the session and time-credit process'
      ]
    },
    'pricing.html': {
      cat: 'platform',
      name: 'Choose the right level of platform support',
      intro: 'Compare the free community experience with advanced matching, structured learning, group, and organizational tools.',
      topics: [
        ['Community remains useful for free',
          'Core profiles, browsing, requests, time credits, events, and community participation stay accessible.'
        ],
        ['Plus supports active learning',
          'Unlimited requests, advanced filters, notes, paths, and small-group features help regular members.'
        ],
        ['Teams supports shared programs',
          'Private spaces, administration, reporting, onboarding, and program support serve organizations.'
        ]
      ],
      steps: ['Estimate how often you expect to use SwapLabs', 'Compare individual and organizational features',
        'Choose monthly or annual billing'
      ]
    },
    'faq.html': {
      cat: 'support',
      name: 'Find precise answers quickly',
      intro: 'Use clear guidance for accounts, matching, time credits, sessions, community conduct, privacy, safety, and support.',
      topics: [
        ['Account and profile guidance',
          'Understand verification, visibility, skill listings, settings, and account management.'
        ],
        ['Sessions and credits guidance',
          'Learn how booking, confirmation, cancellations, disputes, and balances work.'
        ],
        ['Safety and community guidance',
          'Review conduct rules, reporting routes, local meeting advice, and privacy controls.'
        ]
      ],
      steps: ['Search the FAQ using a specific keyword', 'Open the most relevant support article',
        'Contact support if the answer does not resolve the issue'
      ]
    },
    'skill-matching.html': {
      cat: 'platform',
      name: 'Improve the quality of every recommendation',
      intro: 'Personalize matching with complementary skills, availability, location, language, format, learning style, and trust preferences.',
      topics: [
        ['Tune the inputs that matter',
          'Decide whether timing, format, location, experience, or teaching style should have the strongest influence.'
        ],
        ['Understand match explanations',
          'Each recommendation should explain the overlap and the factors that may require discussion.'
        ],
        ['Improve results over time',
          'Saving, dismissing, messaging, and reviewing matches helps the recommendation system become more relevant.'
        ]
      ],
      steps: ['Add at least two teaching skills', 'Set schedule and format preferences',
        'Review and save three compatible members'
      ]
    },
    'learning-paths.html': {
      cat: 'learning',
      name: 'Build progression into your learning plan',
      intro: 'Combine milestones, assessments, sessions, resources, workshops, projects, and certifications into an adaptable roadmap.',
      topics: [
        ['Start at the right level',
          'Assessment evidence helps skip material you already understand and identify missing foundations.'
        ],
        ['Mix learning formats',
          'Paths work best when reading, practice, feedback, live sessions, and projects reinforce one another.'
        ],
        ['Review milestones regularly',
          'Update the plan as goals, available time, and demonstrated skill change.']
      ],
      steps: ['Choose one outcome worth reaching', 'Complete the recommended starting assessment',
        'Schedule the first milestone activity'
      ]
    },
    'skill-assessments.html': {
      cat: 'learning',
      name: 'Use assessment as a planning tool',
      intro: 'Short diagnostics reveal current strengths, practical gaps, and the most suitable next activity without turning learning into a high-stakes test.',
      topics: [
        ['Measure concepts and application',
          'Strong assessments include knowledge questions, decisions, and small practical tasks.'
        ],
        ['Keep results contextual',
          'A score is combined with experience, projects, mentor feedback, and learner goals.'
        ],
        ['Retake when evidence changes',
          'Updated results should move the learning path forward and unlock new opportunities.'
        ]
      ],
      steps: ['Choose the skill you want to assess', 'Complete the questions without outside help',
        'Review the suggested level and next activities'
      ]
    },
    'live-sessions.html': {
      cat: 'learning',
      name: 'Prepare for better live learning',
      intro: 'Browse one-to-one sessions, groups, office hours, demonstrations, and practice rooms with clear expectations before joining.',
      topics: [
        ['Check the stated outcome',
          'Know what the host plans to cover and what participants should bring or prepare.'
        ],
        ['Protect interaction quality',
          'Seat limits and experience labels help keep sessions relevant and participatory.'
        ],
        ['Capture the next step',
          'Save notes, resources, questions, and follow-up practice before leaving the room.'
        ]
      ],
      steps: ['Filter sessions by topic and level', 'Review the host and session requirements',
        'Reserve one session that fits your schedule'
      ]
    },
    'forums.html': {
      cat: 'community',
      name: 'Turn questions into shared knowledge',
      intro: 'Create discussions that provide enough context for useful answers and preserve insights for future learners.',
      topics: [
        ['Ask specific questions',
          'Explain the goal, constraints, attempts, and the exact point where progress stopped.'
        ],
        ['Give actionable answers',
          'Use examples, reasoning, references, and respectful questions rather than unsupported opinions.'
        ],
        ['Maintain useful archives',
          'Mark solutions, update old threads, summarize conclusions, and report harmful content.'
        ]
      ],
      steps: ['Search for an existing discussion', 'Write a question with relevant context',
        'Acknowledge helpful answers and summarize the result'
      ]
    },
    'groups.html': {
      cat: 'community',
      name: 'Create a sustainable learning community',
      intro: 'Interest groups combine discussion, recurring sessions, resources, challenges, mentoring, and shared leadership.',
      topics: [
        ['A clear practice creates focus',
          'Strong groups explain what members do together, not merely the broad topic they like.'
        ],
        ['Shared hosting prevents burnout',
          'Co-hosts distribute moderation, programming, welcoming, and safety responsibilities.'
        ],
        ['Predictable rhythms build trust',
          'Regular prompts, rooms, reviews, and challenges help members return consistently.'
        ]
      ],
      steps: ['Join one group aligned with an active goal', 'Introduce yourself with what you teach and learn',
        'Attend or contribute to one group activity'
      ]
    },
    'leaderboards.html': {
      cat: 'community',
      name: 'Recognize helpful contribution fairly',
      intro: 'Leaderboards balance session quality, reliability, resources, mentoring, feedback, and community work instead of rewarding volume alone.',
      topics: [
        ['Multiple contribution paths',
          'Members can be recognized for teaching, answering, reviewing, organizing, mentoring, or creating resources.'
        ],
        ['Quality needs context',
          'Ratings are combined with reliability, helpful votes, completion, and moderation checks.'
        ],
        ['Healthy limits reduce gaming',
          'Caps, review windows, abuse detection, and transparent rules protect meaningful recognition.'
        ]
      ],
      steps: ['Review how points are calculated', 'Choose one contribution goal for this month',
        'Track quality and consistency instead of rank alone'
      ]
    },
    'community-challenges.html': {
      cat: 'community',
      name: 'Use a shared deadline to create momentum',
      intro: 'Monthly challenges turn broad interests into scoped collaboration with milestones, teams, feedback, and visible outcomes.',
      topics: [
        ['A useful brief sets boundaries',
          'The challenge defines the audience, expected artifact, timeline, constraints, and evaluation criteria.'
        ],
        ['Teams form around complementary skills',
          'Members join roles that match their goals while learning from adjacent disciplines.'
        ],
        ['Milestones make progress visible',
          'Weekly checkpoints create opportunities for feedback before final submission.'
        ]
      ],
      steps: ['Read the complete challenge brief', 'Choose an individual or team participation route',
        'Submit the first milestone before the deadline'
      ]
    },
    'blog.html': {
      cat: 'community',
      name: 'Explore deeper ideas about peer learning',
      intro: 'The journal combines practical guides, community reporting, product explanations, safety advice, and member stories.',
      topics: [
        ['Practical guides support action',
          'Articles include checklists, templates, examples, and next steps that connect back to platform tools.'
        ],
        ['Member stories preserve complexity',
          'Success stories explain the effort, support, setbacks, and tradeoffs behind meaningful outcomes.'
        ],
        ['Product writing builds transparency',
          'Platform decisions, matching, credits, moderation, and privacy are explained in accessible language.'
        ]
      ],
      steps: ['Choose a topic related to an active goal', 'Save one useful guide or template',
        'Discuss the idea with a group or mentor'
      ]
    },
    'events.html': {
      cat: 'community',
      name: 'Get more from community events',
      intro: 'Prepare for festivals, exchange nights, clinics, collaboration labs, and local meetups with clear schedules and participation guidance.',
      topics: [
        ['Choose the right event format',
          'Large festivals support discovery, while small clinics and workshops provide deeper interaction.'
        ],
        ['Plan your participation',
          'Review the agenda, accessibility details, preparation, time zone, and session capacity.'
        ],
        ['Follow up after the event',
          'Save contacts, resources, notes, and next sessions while the experience is still fresh.'
        ]
      ],
      steps: ['Review the agenda and host information', 'Reserve a place and add it to your calendar',
        'Prepare one question or contribution'
      ]
    },
    'mentors.html': {
      cat: 'community',
      name: 'Choose a mentor for the way you learn',
      intro: 'Compare expertise, teaching approach, availability, reviews, evidence, and boundaries before requesting guidance.',
      topics: [
        ['Experience is not enough',
          'Good mentors can explain, listen, scope, question, demonstrate, and adapt to the learner.'
        ],
        ['A clear request improves fit',
          'Share your goal, current level, work completed, and the kind of help you want.'
        ],
        ['Mentoring should build independence',
          'Strong sessions leave the learner with clearer decisions, practice, and self-correction tools.'
        ]
      ],
      steps: ['Review mentor skills and teaching style', 'Prepare one focused mentoring goal',
        'Request a realistic first session'
      ]
    },
    'success-stories.html': {
      cat: 'community',
      name: 'Learn from real member outcomes',
      intro: 'Study how people used exchanges, paths, groups, projects, and mentoring to make concrete progress.',
      topics: [
        ['Outcomes come from repeated practice',
          'Most meaningful stories involve multiple small sessions rather than one dramatic intervention.'
        ],
        ['Reciprocity creates motivation',
          'Teaching gives members confidence, accountability, and a stronger relationship to their own expertise.'
        ],
        ['Context matters',
          'Time, access, support, prior experience, and life constraints shape every learning journey.'
        ]
      ],
      steps: ['Read a story similar to your own goal', 'Identify the repeatable actions behind the outcome',
        'Adapt one action to your current learning plan'
      ]
    },
    'courses.html': {
      cat: 'learning',
      name: 'Choose a course that produces evidence',
      intro: 'Compare structured member-created courses by outcomes, modules, projects, interaction, mentor access, and learner reviews.',
      topics: [
        ['Outcomes should be concrete',
          'A strong course explains what learners will understand, make, practice, and demonstrate.'
        ],
        ['Projects turn knowledge into skill',
          'Courses include exercises and artifacts that reveal whether ideas can be applied.'
        ],
        ['Community improves completion',
          'Discussion, office hours, peer review, and accountability help learners continue.'
        ]
      ],
      steps: ['Compare the syllabus with your current level', 'Review project and mentor requirements',
        'Enroll and schedule the first module'
      ]
    },
    'resources.html': {
      cat: 'learning',
      name: 'Build a trusted personal learning library',
      intro: 'Organize guides, templates, tutorials, tools, checklists, and references around active goals and sessions.',
      topics: [
        ['Quality matters more than quantity',
          'Useful resources are clear, current, accessible, attributed, and connected to a real learning task.'
        ],
        ['Collections reduce repeated searching',
          'Group materials by path, project, workshop, session, or recurring practice.'
        ],
        ['Notes turn links into knowledge',
          'Record why a resource matters, what you learned, and when to revisit it.'
        ]
      ],
      steps: ['Save one resource for an active goal', 'Add a note explaining how you will use it',
        'Share or discuss it with a learning partner'
      ]
    },
    'workshops.html': {
      cat: 'learning',
      name: 'Prepare for focused group practice',
      intro: 'Workshops combine expert facilitation, practical exercises, small groups, shared artifacts, and follow-up resources.',
      topics: [
        ['Preparation protects workshop time',
          'Participants review prerequisites, tools, files, and access needs before the session.'
        ],
        ['Exercises should create evidence',
          'Every workshop produces a draft, decision, plan, prototype, or demonstrated practice.'
        ],
        ['Feedback makes practice useful',
          'Facilitators and peers respond to specific work while there is still time to improve it.'
        ]
      ],
      steps: ['Check prerequisites and accessibility details', 'Reserve a seat and prepare required materials',
        'Complete the exercise and save follow-up actions'
      ]
    },
    'certifications.html': {
      cat: 'learning',
      name: 'Build credible evidence of capability',
      intro: 'Certifications combine diagnostic knowledge, practical work, peer interaction, and mentor review instead of relying on a single quiz.',
      topics: [
        ['Knowledge creates a foundation',
          'Assessments confirm essential concepts, vocabulary, decisions, and safety awareness.'
        ],
        ['Work demonstrates application',
          'Projects show how members interpret a brief, make choices, and produce a usable result.'
        ],
        ['Human review adds context',
          'Mentors evaluate process, quality, explanation, and readiness for the claimed level.'
        ]
      ],
      steps: ['Review certification requirements', 'Collect existing evidence and identify gaps',
        'Schedule the next unfinished requirement'
      ]
    },
    'become-a-mentor.html': {
      cat: 'professional',
      name: 'Develop a responsible mentoring practice',
      intro: 'Prepare to guide learners through clear explanations, thoughtful questions, practical feedback, boundaries, and reliable follow-through.',
      topics: [
        ['Teaching requires more than expertise',
          'Mentors need communication, facilitation, inclusion, planning, and feedback skills.'
        ],
        ['Scope protects both people',
          'Clear goals, time limits, preparation, and boundaries prevent vague or unsustainable commitments.'
        ],
        ['Reflection improves quality',
          'Mentors review feedback, recurring questions, learner outcomes, and their own session patterns.'
        ]
      ],
      steps: ['Review mentor eligibility and responsibilities', 'Prepare evidence of your subject experience',
        'Submit the mentor interest form'
      ]
    },
    'talent-directory.html': {
      cat: 'professional',
      name: 'Search for capability with useful evidence',
      intro: 'Discover members through skills, verified achievements, project roles, availability, location, and collaboration preferences.',
      topics: [
        ['Skills provide better signals than titles',
          'Search by demonstrated capability and context rather than relying on broad job labels.'
        ],
        ['Evidence should be inspectable',
          'Certifications, projects, mentor reviews, and session history explain how expertise was demonstrated.'
        ],
        ['Visibility stays member controlled',
          'People choose whether they are discoverable for projects, mentoring, roles, or partnerships.'
        ]
      ],
      steps: ['Define the capability and context you need', 'Review evidence and availability filters',
        'Save a shortlist before making contact'
      ]
    },
    'projects.html': {
      cat: 'professional',
      name: 'Turn learning into collaborative evidence',
      intro: 'Projects connect clear briefs with complementary teammates, milestones, contribution records, feedback, and portfolio-ready outcomes.',
      topics: [
        ['A precise brief attracts better teams',
          'Define the audience, problem, outcome, constraints, timeline, roles, and completion criteria.'
        ],
        ['Roles should support growth and delivery',
          'Members need enough challenge to learn without taking responsibility beyond their readiness.'
        ],
        ['Contributions deserve clear credit',
          'Decision logs, milestone records, and role summaries make collaborative work visible and fair.'
        ]
      ],
      steps: ['Choose a project aligned with one growth goal', 'Review the brief, roles, timeline, and team',
        'Apply with relevant evidence and honest availability'
      ]
    },
    'partner-with-us.html': {
      cat: 'professional',
      name: 'Design a peer-learning program with measurable value',
      intro: 'Schools, companies, nonprofits, libraries, and local communities can combine skill mapping, exchange, workshops, groups, and reporting.',
      topics: [
        ['Start with a real organizational need',
          'Programs work best when connected to capability gaps, community goals, collaboration, or access.'
        ],
        ['Participation needs thoughtful design',
          'Time, incentives, privacy, manager support, facilitation, and accessibility shape adoption.'
        ],
        ['Measure learning and connection',
          'Track skills shared, hours exchanged, participation, repeat activity, outcomes, and cross-group relationships.'
        ]
      ],
      steps: ['Define the community and desired outcomes', 'Estimate participation, duration, and support needs',
        'Request a partnership conversation'
      ]
    },
    'about.html': {
      cat: 'company',
      name: 'Understand the purpose behind SwapLabs',
      intro: 'Explore the mission, equal-time model, platform principles, community commitments, and long-term view of practical learning.',
      topics: [
        ['Equal time changes who can participate',
          'Valuing each hour equally avoids pricing status and recognizes diverse practical knowledge.'
        ],
        ['Relationships create accountability',
          'Learning with another person adds context, feedback, commitment, and shared responsibility.'
        ],
        ['Technology should support human agency',
          'The platform helps people discover, prepare, communicate, track, and resolve without replacing the relationship.'
        ]
      ],
      steps: ['Read the platform principles', 'Review how time credits work',
        'Explore community impact and success stories'
      ]
    },
    'careers.html': {
      cat: 'company',
      name: 'Explore work with the SwapLabs team',
      intro: 'Understand open roles, collaboration practices, hiring stages, benefits, and the problems the team is trying to solve.',
      topics: [
        ['Mission and craft both matter',
          'Candidates are evaluated on role expertise, judgment, collaboration, and alignment with accessible learning.'
        ],
        ['The hiring process should be transparent',
          'Each role describes stages, expectations, decision timing, and whether practical exercises are required.'
        ],
        ['Remote work needs deliberate systems',
          'Documentation, focused meetings, asynchronous decisions, and quarterly collaboration support distributed teams.'
        ]
      ],
      steps: ['Review the role and expected outcomes', 'Prepare relevant examples and decisions',
        'Apply through the contact route'
      ]
    },
    'privacy.html': {
      cat: 'company',
      name: 'Understand how member information is handled',
      intro: 'Review information collection, use, visibility, sharing, retention, security, and member controls in plain language.',
      topics: [
        ['Collect only what supports the service',
          'Profiles, matching, sessions, credits, safety, support, and improvement require specific information.'
        ],
        ['Visibility should be understandable',
          'Members need clear controls for profiles, location, professional discovery, communication, and activity.'
        ],
        ['Rights require usable processes',
          'Access, correction, export, deletion, and objections should be available without unnecessary friction.'
        ]
      ],
      steps: ['Review profile visibility settings', 'Check communication and location preferences',
        'Contact privacy support with unresolved questions'
      ]
    },
    'terms.html': {
      cat: 'company',
      name: 'Know the rules that protect fair participation',
      intro: 'Understand eligibility, account security, community conduct, time credits, sessions, content, restrictions, and dispute handling.',
      topics: [
        ['Accounts require honest information',
          'Members are responsible for accurate profiles, secure access, and activity performed through their account.'
        ],
        ['Community conduct applies everywhere',
          'Harassment, discrimination, fraud, unsafe behavior, and manipulation are prohibited across platform spaces.'
        ],
        ['Time credits are not cash',
          'Credits record platform exchange time and may be corrected when sessions are disputed, reversed, or fraudulent.'
        ]
      ],
      steps: ['Review eligibility and conduct rules', 'Understand session and credit responsibilities',
        'Use support or reporting routes when needed'
      ]
    },
    'help-center.html': {
      cat: 'support',
      name: 'Resolve common questions efficiently',
      intro: 'Use topic-based help, searchable guidance, troubleshooting, policy explanations, and clear routes to human support.',
      topics: [
        ['Start with the specific workflow',
          'Account, match, session, credit, event, group, project, and safety issues each have dedicated guidance.'
        ],
        ['Troubleshoot with relevant details',
          'Dates, session references, expected behavior, and observed outcomes help support resolve issues faster.'
        ],
        ['Choose the correct contact route',
          'General support, privacy, partnerships, careers, and confidential reports follow different review paths.'
        ]
      ],
      steps: ['Search using the feature or issue name', 'Follow the recommended troubleshooting steps',
        'Contact the correct team if the issue remains'
      ]
    },
    'contact.html': {
      cat: 'support',
      name: 'Reach the right SwapLabs team',
      intro: 'Send clear questions about accounts, product, partnerships, press, careers, or general support with enough context for a useful reply.',
      topics: [
        ['Choose the correct subject', 'Routing a message accurately reduces delays and repeated clarification.'],
        ['Include the information that matters',
          'Explain the goal, relevant page or feature, dates, references, and what you already tried.'
        ],
        ['Protect sensitive information',
          'Never send passwords, full payment details, identity documents, or unnecessary private data.'
        ]
      ],
      steps: ['Choose the closest contact category', 'Write a concise message with relevant context',
        'Submit and keep the confirmation for reference'
      ]
    },
    'report.html': {
      cat: 'support',
      name: 'Report safety and conduct concerns responsibly',
      intro: 'Use confidential reporting for harassment, discrimination, unsafe behavior, fraud, impersonation, disputes, and inappropriate content.',
      topics: [
        ['Immediate danger needs local help',
          'SwapLabs reporting is not an emergency service; contact local emergency services when someone is at immediate risk.'
        ],
        ['Specific evidence supports review',
          'Dates, session IDs, profile names, messages, and a factual sequence help investigators understand what happened.'
        ],
        ['Outcomes depend on evidence and policy',
          'Actions may include guidance, credit correction, warnings, restrictions, suspension, or account removal.'
        ]
      ],
      steps: ['Choose the most accurate report category', 'Describe the sequence and relevant references',
        'Submit a safe contact method for follow-up'
      ]
    }
  };

  const categoryData = {
    platform: {
      metrics: [
        ['—', 'skills indexed', 'skills'],
        ['9 factors', 'used in matching'],
        ['96%', 'session satisfaction'],
        ['—', 'hours exchanged', 'hours_exchanged']
      ],
      related: [
        ['Skill Matching', 'skill-matching.html', 'bx-git-compare'],
        ['Learning Paths', 'learning-paths.html', 'bx-map-alt'],
        ['Live Sessions', 'live-sessions.html', 'bx-video'],
        ['Pricing', 'pricing.html', 'bx-purchase-tag']
      ]
    },
    community: {
      metrics: [
        ['—', 'active members', 'active_members'],
        ['684', 'active groups'],
        ['3.2k', 'monthly discussions'],
        ['91%', 'repeat participation']
      ],
      related: [
        ['Forums', 'forums.html', 'bx-conversation'],
        ['Groups', 'groups.html', 'bx-group'],
        ['Leaderboards', 'leaderboards.html', 'bx-trophy'],
        ['Challenges', 'community-challenges.html', 'bx-target-lock']
      ]
    },
    learning: {
      metrics: [
        ['326', 'member courses'],
        ['1,840', 'learning resources'],
        ['92', 'monthly workshops'],
        ['74', 'verified badges']
      ],
      related: [
        ['Courses', 'courses.html', 'bx-book-open'],
        ['Resources', 'resources.html', 'bx-library'],
        ['Workshops', 'workshops.html', 'bx-chalkboard'],
        ['Certifications', 'certifications.html', 'bx-badge-check']
      ]
    },
    professional: {
      metrics: [
        ['2.4k', 'active mentors'],
        ['6.8k', 'visible talent profiles'],
        ['184', 'open projects'],
        ['72', 'partner programs']
      ],
      related: [
        ['Become a Mentor', 'become-a-mentor.html', 'bx-user-voice'],
        ['Talent Directory', 'talent-directory.html', 'bx-id-card'],
        ['Projects', 'projects.html', 'bx-briefcase-alt-2'],
        ['Partner With Us', 'partner-with-us.html', 'bx-buildings']
      ]
    },
    company: {
      metrics: [
        ['—', 'countries represented', 'countries'],
        ['42', 'team members'],
        ['—', 'community members', 'active_members'],
        ['2026', 'current roadmap']
      ],
      related: [
        ['About', 'about.html', 'bx-info-circle'],
        ['Careers', 'careers.html', 'bx-briefcase'],
        ['Privacy', 'privacy.html', 'bx-lock-alt'],
        ['Terms', 'terms.html', 'bx-file']
      ]
    },
    support: {
      metrics: [
        ['1 day', 'average response'],
        ['24/7', 'report intake'],
        ['96%', 'helpful resolutions'],
        ['32', 'documented features']
      ],
      related: [
        ['Help Center', 'help-center.html', 'bx-support'],
        ['FAQ', 'faq.html', 'bx-help-circle'],
        ['Contact', 'contact.html', 'bx-envelope'],
        ['Report', 'report.html', 'bx-flag']
      ]
    }
  };
  const cfg = configs[current] || configs['swaplabs.html'];
  const category = categoryData[cfg.cat];
  const topicLinks = category.related;
  const questions = [
    [`How should I start with ${cfg.name.toLowerCase()}?`,
      `Begin with the first checklist item, keep the initial scope small, and use the relevant SwapLabs page tools to record the result.`
    ],
    ['Can I use this remotely?',
      'Yes. Most SwapLabs workflows support remote participation, while local options include additional location and safety guidance.'
    ],
    ['How is progress or quality reviewed?',
      'SwapLabs combines completed activity with evidence, two-way feedback, reliability, and context appropriate to the feature.'
    ],
    ['Where can I get help if something goes wrong?',
      'Use the Help Center for guidance, Contact for account or product support, and Report for safety, conduct, fraud, or dispute concerns.'
    ]
  ];
  const html =
    `<div class="page-expansion"><section class="expansion-stats"><div class="container expansion-stat-grid">${category.metrics.map(([value,label,key])=>`<div class="expansion-stat"><strong${key?` data-platform-metric="${key}"`:''}>${value}</strong><span>${label}</span></div>`).join('')}</div></section><section class="depth-section"><div class="container"><div class="depth-heading"><div><span class="eyebrow">Detailed platform guide</span><h2>${cfg.name}</h2></div><p>${cfg.intro}</p></div><div class="insight-grid">${cfg.topics.map(([title,desc],i)=>`<article class="insight-card"><span class="index">SECTION 0${i+1}</span><h3>${title}</h3><p>${desc}</p><a href="${topicLinks[i%topicLinks.length][1]}">Explore related tools <i class="bx bx-right-arrow-alt"></i></a></article>`).join('')}</div></div></section><section class="depth-section white"><div class="container"><div class="depth-heading"><div><span class="eyebrow">Interactive workspace</span><h2>Plan, track, and continue.</h2></div><p>Use this page-specific workspace to turn information into a concrete next action. Progress is stored on this device.</p></div><div class="workspace" data-workspace><div class="workspace-top"><h3>${cfg.name} workspace</h3><span><i class="bx bx-lock-alt"></i> Saved locally</span></div><div class="workspace-body"><nav class="workspace-tabs"> <button class="workspace-tab active" data-workspace-tab="plan"><i class="bx bx-list-check"></i>Action plan</button><button class="workspace-tab" data-workspace-tab="activity"><i class="bx bx-pulse"></i>Recent activity</button><button class="workspace-tab" data-workspace-tab="notes"><i class="bx bx-note"></i>My notes</button></nav><div class="workspace-panels"><section class="workspace-panel active" data-workspace-panel="plan"><h3>Your next three actions</h3><p>Complete these in any order. The progress indicator updates automatically.</p><div class="checklist">${cfg.steps.map((step,i)=>`<button class="check-item" data-check="${i}"><i class="bx bx-circle"></i><span><strong>${step}</strong><small>Mark complete when finished</small></span></button>`).join('')}</div><div class="workspace-progress"><div class="workspace-progress-head"><span>Completion</span><strong data-progress-label>0%</strong></div><div class="progress"><span data-progress-bar style="width:0%"></span></div></div></section><section class="workspace-panel" data-workspace-panel="activity"><h3>Community activity around this topic</h3><p>Examples of recent contributions, sessions, and resources.</p><div class="activity-feed">${cfg.topics.map(([title],i)=>`<div class="activity-entry"><i class="bx ${['bx-message-square-dots','bx-video','bx-bookmark'][i]}"></i><div><strong>${title}</strong><small>${['New community discussion','Member session completed','Resource collection updated'][i]}</small></div><time>${['12 min','38 min','2 hr'][i]}</time></div>`).join('')}</div></section><section class="workspace-panel note-box" data-workspace-panel="notes"><h3>Private working notes</h3><p>Capture questions, decisions, people to contact, and the next action you want to remember.</p><textarea data-page-notes placeholder="Write notes for this page"></textarea><div class="note-actions"><span class="note-state" data-note-state>Notes saved on this device</span><button class="btn btn-primary btn-sm" data-save-notes><i class="bx bx-save"></i>Save notes</button></div></section></div></div></div></div></section><section class="depth-section"><div class="container"><div class="depth-heading"><div><span class="eyebrow">Questions and context</span><h2>Go deeper before deciding.</h2></div><p>These answers explain how this part of SwapLabs connects with remote participation, progress evidence, and member support.</p></div><div class="question-grid">${questions.map(([q,a])=>`<article class="deep-faq"><button>${q}<i class="bx bx-plus"></i></button><p>${a}</p></article>`).join('')}</div></div></section><section class="depth-section white"><div class="container"><div class="depth-heading"><div><span class="eyebrow">Continue exploring</span><h2>Connected tools and pages.</h2></div><p>SwapLabs features work together. Move between discovery, practice, evidence, community, and support without losing context.</p></div><div class="related-strip">${topicLinks.map(([label,href,icon])=>`<a class="related-card" href="${href}"><i class="bx ${icon}"></i><strong>${label}</strong><span>Open the complete page</span></a>`).join('')}</div></div></section></div><div class="toast-message" data-page-toast>Saved successfully</div>`;
  document.querySelector('[data-site-footer]')?.insertAdjacentHTML('beforebegin', html);
  window.SwapLabsMetrics?.refresh();

  const storageKey = `swaplabs-workspace-${current}`;
  let saved = {
    checks: [],
    notes: ''
  };
  try {
    saved = JSON.parse(localStorage.getItem(storageKey)) || saved
  } catch (e) {}
  const persist = () => localStorage.setItem(storageKey, JSON.stringify(saved));
  const updateProgress = () => {
    const total = cfg.steps.length,
      done = saved.checks.length,
      pct = Math.round(done / total * 100);
    document.querySelector('[data-progress-label]').textContent = `${pct}%`;
    document.querySelector('[data-progress-bar]').style.width = `${pct}%`;
    document.querySelectorAll('[data-check]').forEach(btn => {
      const complete = saved.checks.includes(Number(btn.dataset.check));
      btn.classList.toggle('done', complete);
      btn.querySelector('i').className = `bx ${complete?'bx-check-circle':'bx-circle'}`
    })
  };
  document.querySelectorAll('[data-workspace-tab]').forEach(tab => tab.addEventListener('click', () => {
    const root = tab.closest('[data-workspace]');
    root.querySelectorAll('[data-workspace-tab]').forEach(x => x.classList.remove('active'));
    root.querySelectorAll('[data-workspace-panel]').forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    root.querySelector(`[data-workspace-panel="${tab.dataset.workspaceTab}"]`).classList.add('active')
  }));
  document.querySelectorAll('[data-check]').forEach(btn => btn.addEventListener('click', () => {
    const id = Number(btn.dataset.check);
    saved.checks = saved.checks.includes(id) ? saved.checks.filter(x => x !== id) : [...saved.checks, id];
    persist();
    updateProgress()
  }));
  const notes = document.querySelector('[data-page-notes]');
  notes.value = saved.notes || '';
  document.querySelector('[data-save-notes]')?.addEventListener('click', () => {
    saved.notes = notes.value;
    persist();
    const state = document.querySelector('[data-note-state]');
    state.classList.add('show');
    const toast = document.querySelector('[data-page-toast]');
    toast.classList.add('show');
    setTimeout(() => {
      state.classList.remove('show');
      toast.classList.remove('show')
    }, 1800)
  });
  document.querySelectorAll('.deep-faq button').forEach(btn => btn.addEventListener('click', () => btn.parentElement
    .classList.toggle('open')));
  updateProgress();
})();
