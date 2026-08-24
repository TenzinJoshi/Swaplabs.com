(() => {
  'use strict';

  const uniqueSorted = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const displayNames = type => {
    try {
      return new Intl.DisplayNames([navigator.language || 'en'], {
        type
      });
    } catch (_error) {
      return null;
    }
  };

  const regionNames = displayNames('region');
  const countries = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      let name = '';
      try {
        name = regionNames?.of(code) || '';
      } catch (_error) {
        name = '';
      }
      if (name && name !== code && !/unknown region/i.test(name)) countries.push(name);
    }
  }
  countries.push('Kosovo', 'Other / self-described');

  const languageCodes =
    `aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu`
    .split(/\s+/);
  const languageNames = displayNames('language');
  const languages = languageCodes.map(code => {
    try {
      return languageNames?.of(code) || code;
    } catch (_error) {
      return code;
    }
  });
  languages.push(
    'American Sign Language', 'British Sign Language', 'Indian Sign Language', 'International Sign',
    'Auslan', 'New Zealand Sign Language', 'Other / self-described'
  );

  let timezones = [];
  try {
    timezones = Intl.supportedValuesOf('timeZone');
  } catch (_error) {
    timezones = [
      'UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'America/Anchorage', 'America/Chicago',
      'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/New_York',
      'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Seoul',
      'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Melbourne', 'Australia/Sydney',
      'Europe/Berlin', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Pacific/Auckland'
    ];
  }
  timezones = ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'Europe/Kyiv', ...timezones, 'Other / custom timezone'];

  const occupations =
    `Accountant|Actor|Actuary|Administrative Assistant|Aerospace Engineer|Agricultural Scientist|Animator|Anthropologist|App Developer|Architect|Archivist|Art Director|Artist|Astronomer|Attorney|Audio Engineer|Auditor|Author|Baker|Banker|Barber|Bartender|Biochemist|Biologist|Biomedical Engineer|Bookkeeper|Brand Strategist|Business Analyst|Business Owner|Carpenter|Chef|Chemist|Civil Engineer|Clinical Researcher|Coach|Community Manager|Compliance Officer|Composer|Construction Manager|Consultant|Content Creator|Content Designer|Copy Editor|Copywriter|Counsellor|Customer Success Manager|Cybersecurity Analyst|Dancer|Data Analyst|Data Engineer|Data Scientist|Database Administrator|Dentist|Dietitian|Digital Marketer|Director|Doctor|Economist|Editor|Educator|Electrical Engineer|Entrepreneur|Environmental Scientist|Event Planner|Executive Assistant|Fashion Designer|Film Director|Financial Adviser|Financial Analyst|Fitness Trainer|Florist|Founder|Frontend Developer|Full-stack Developer|Game Designer|Geologist|Graphic Designer|Hair Stylist|Historian|Human Resources Specialist|Illustrator|Industrial Designer|Information Architect|Insurance Specialist|Interior Designer|Interpreter|Journalist|Laboratory Technician|Landscape Architect|Language Coach|Lawyer|Librarian|Machine Learning Engineer|Marketing Manager|Mathematician|Mechanical Engineer|Medical Researcher|Mentor|Musician|Network Engineer|Nurse|Nutritionist|Occupational Therapist|Operations Manager|Optometrist|Photographer|Physical Therapist|Physician|Policy Analyst|Product Designer|Product Manager|Professor|Program Manager|Project Manager|Psychologist|Public Relations Specialist|Quality Assurance Engineer|Recruiter|Researcher|Sales Manager|School Teacher|Security Engineer|Social Media Manager|Social Worker|Software Engineer|Sound Designer|Statistician|Student|Supply Chain Manager|Systems Administrator|Technical Writer|Therapist|Translator|Tutor|UI Designer|UX Designer|UX Researcher|Veterinarian|Video Editor|Videographer|Visual Designer|Web Designer|Web Developer|Writer|Retired|Career Break|Volunteer|Other / self-described`
    .split('|');

  const professionalRoles =
    `Apprentice|Assistant|Associate|Coordinator|Contributor|Consultant|Contractor|Director|Educator|Executive|Expert|Facilitator|Founder|Freelancer|Head of Department|Independent Professional|Individual Contributor|Intern|Junior Specialist|Lead|Manager|Mentor|Owner|Partner|Principal|Professor|Research Fellow|Senior Specialist|Specialist|Student|Supervisor|Teacher|Team Lead|Trainee|Tutor|Vice President|Volunteer|Other / self-described`
    .split('|');

  const values = {
    countries: uniqueSorted(countries),
    languages: uniqueSorted(languages),
    timezones: uniqueSorted(timezones),
    occupations: uniqueSorted(occupations),
    roles: uniqueSorted(professionalRoles),
    pronouns: ['He / him', 'She / her', 'They / them', 'He / they', 'She / they', 'Any pronouns', 'Use my name',
      'Prefer not to say', 'Other / self-described'
    ],
    ages: Array.from({
      length: 108
    }, (_, index) => String(index + 13))
  };

  function addDatalist(input, key) {
    const options = values[key] || [];
    const id = `swaplabs-${key}-options`;
    let datalist = document.getElementById(id);
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = id;
      datalist.innerHTML = options.map(option =>
        `<option value="${String(option).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></option>`).join('');
      document.body.appendChild(datalist);
    }
    input.setAttribute('list', id);
    input.setAttribute('autocomplete', 'off');
  }

  function setupMultiPicker(input, key) {
    addDatalist(input, key);
    const menu = document.createElement('div');
    menu.className = 'option-suggestion-menu';
    input.parentElement.style.position = 'relative';
    input.insertAdjacentElement('afterend', menu);
    const close = () => menu.classList.remove('open');
    const update = () => {
      const parts = input.value.split(',');
      const query = parts.at(-1).trim().toLowerCase();
      const selected = new Set(parts.slice(0, -1).map(item => item.trim().toLowerCase()));
      const matches = (values[key] || []).filter(option => !selected.has(option.toLowerCase()) && (!query || option
        .toLowerCase().includes(query))).slice(0, 10);
      menu.innerHTML = matches.map(option =>
        `<button type="button" data-option-value="${String(option).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${String(option).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</button>`
        ).join('');
      menu.classList.toggle('open', matches.length > 0);
      menu.querySelectorAll('[data-option-value]').forEach(button => button.addEventListener('mousedown', event => {
        event.preventDefault();
        const prefix = parts.slice(0, -1).map(item => item.trim()).filter(Boolean);
        input.value = [...prefix, button.dataset.optionValue].join(', ') + ', ';
        input.dispatchEvent(new Event('input', {
          bubbles: true
        }));
        input.focus();
      }));
    };
    input.addEventListener('focus', update);
    input.addEventListener('input', update);
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  function initialize(root = document) {
    root.querySelectorAll('[data-option-list]').forEach(input => addDatalist(input, input.dataset.optionList));
    root.querySelectorAll('[data-multi-options]').forEach(input => setupMultiPicker(input, input.dataset
      .multiOptions));
    root.querySelectorAll('[data-age-select]').forEach(select => {
      const current = select.value;
      select.innerHTML = '<option value="">Select age</option>' + values.ages.map(age =>
        `<option value="${age}">${age}</option>`).join('');
      if (current) select.value = current;
    });
  }

  window.SwapLabsOptions = {
    values,
    initialize
  };
  initialize();
})();
