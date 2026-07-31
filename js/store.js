/* ============================================================================
   store.js — data layer
   Single source of truth, persisted to localStorage. Everything the glasses
   view and the caregiver dashboard share passes through here.
   ==========================================================================*/

const KEY = 'ingat.v1';

const EV = {
  PROMPT_FULL:  'prompt_full',
  PROMPT_CUE:   'prompt_partial',
  PROMPT_CHIME: 'prompt_chime',
  UNAIDED:      'retrieval_unaided',
  ASSISTED:     'retrieval_assisted',
  MISSED:       'retrieval_missed',
  TELL_AGAIN:   'tell_again',
  UNKNOWN:      'unknown_face',
  MED_PROMPT:   'med_prompt',
  MED_OK:       'med_confirmed',
  WEAR_ON:      'wear_on',
  WEAR_OFF:     'wear_off',
  IDLE_OFF:     'idle_poweroff',
  CAM_OFF:      'camera_disabled',
  CAM_ON:       'camera_enabled',
  ENROL:        'person_enrolled',
  STAGE_UP:     'cue_stage_advanced',
  STAGE_DOWN:   'cue_stage_regressed',
  BRIEFING:     'morning_briefing',
  APPT_REMIND:  'appointment_reminder',
  PLACE:        'place_prompt',
  REMINISCE:    'reminiscence_moment',
  CONSENT:      'consent_recorded',
  ASSENT:       'assent_changed',
  EXPORT:       'data_exported',
  ERASE:        'data_erased',
  FACT_HEARD:   'fact_proposed',
  FACT_KEPT:    'fact_confirmed',
  FACT_DROPPED: 'fact_discarded',
  FACT_RECALL:  'fact_recalled',
  FACT_MISSED:  'fact_not_recalled',
  OBJ_ASK:      'object_asked',
  OBJ_TOLD:     'object_answered',
  OBJ_SEEN:     'object_placed',
  THREAD_HELD:  'thread_reminded',
  PLAN_ITEM:    'plan_item_due',
  PLAN_DONE:    'plan_item_done',
  TAG_RING:     'tag_rang',
  TAG_FOUND:    'tag_located',
  GEO_LEFT:     'left_safe_zone',
  GEO_BACK:     'returned_safe_zone',
  GEO_HOME:     'way_home_given',
};

/* --------------------------------------------------------------- seed data */
function seedWeeks() {
  // 10 weeks of history. Gentle plateau, then a deliberate inflection at
  // week 8 so the escalation logic has something real to fire on.
  // Flagged seeded:true — the UI labels these openly. Never claim them as live.
  const v = [79, 78, 78, 77, 77, 76, 75, 74, 68, 63];
  return v.map((cti, i) => ({ week: i + 1, cti, seeded: true }));
}

/** Appointments seeded relative to today so the calendar is never empty. */
function seedAppointments() {
  const day = (n, h, m) => {
    const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  return [
    { id: 'a1', title: 'Memory clinic review', when: day(2, 10, 30), place: 'Tan Tock Seng, Clinic 3B',
      withWhom: 'Dr Rahim', remind: [1440, 60], notes: 'Mei Ling is taking leave to bring him.' },
    { id: 'a2', title: 'Mei Ling visiting', when: day(0, 18, 0), place: 'Home',
      withWhom: 'Mei Ling', remind: [120], notes: 'She is bringing kaya toast.' },
    { id: 'a3', title: 'Active Ageing Centre — mahjong', when: day(4, 14, 0), place: 'Blk 122 void deck',
      withWhom: '', remind: [60], notes: '' },
  ];
}

/* Movement history, seeded the same way the CTI weeks are: openly, and
   labelled as seeded wherever it is shown. Without it the two rhythm panels
   would read "not enough data" on a fresh machine, which makes a working
   feature look broken. The shape is deliberately ordinary — up around seven,
   out mid-morning, quiet after nine — because the point of the panel is to
   show what normal looks like before it changes. */
function seedActivity(epochMin, days) {
  const per = 24 * 60 / epochMin;
  const now = Math.floor(Date.now() / 60000 / epochMin);
  // Deterministic pseudo-noise. No Math.random: the demo must look identical
  // every time it is opened, or two people comparing screens see two products.
  const noise = k => (((k * 1103515245 + 12345) % 2147483648) + 2147483648)
                     % 2147483648 / 2147483648;
  const rows = [];
  for (let t = now - days * per + 1; t <= now; t++) {
    const d = new Date(t * epochMin * 60000);
    const dayKey = Math.floor(t / per);
    const h = d.getHours() + d.getMinutes() / 60;
    // The daily profile is not identical from day to day — he wakes anywhere
    // in a 90-minute window and does not nap every afternoon. That is what
    // keeps interdaily stability near the 0.6-0.7 seen in real cohorts rather
    // than the 0.99 a copy-pasted day would give.
    const wake = 6.6 + noise(dayKey) * 1.5;
    const naps = noise(dayKey + 700) > 0.45;
    // Some days he is out all day, some days he barely leaves the flat. This
    // day-level swing is what pulls interdaily stability down to the 0.6-0.8
    // real cohorts show; without it a seeded week reads an impossible 0.95+.
    const busy = 0.45 + noise(dayKey + 1300) * 0.85;
    let v = 0.02;                                                  // asleep
    if (h >= wake && h < wake + 2)      v = 0.55;                  // breakfast
    else if (h >= wake + 2 && h < 12)   v = 0.95;                  // the morning out
    else if (h >= 12 && h < 14)         v = naps ? 0.12 : 0.55;    // lunch, maybe a nap
    else if (h >= 14 && h < 19)         v = 0.85;                  // afternoon
    else if (h >= 19 && h < 22)         v = 0.35;                  // evening, sitting
    // One broken night in the week. Real actigraphy is never flat overnight,
    // and a seed with no night-time restlessness produces an IV no human has.
    if (h >= wake) v *= busy;                                      // daytime only
    if (dayKey % 5 === 2 && h >= 2 && h < 3.5) v = 0.45;
    v *= 0.35 + noise(t) * 1.3;                                    // ×0.35-1.65
    // No `n`. The sample count only matters while an epoch is still open, and
    // carrying it on two thousand historical rows costs 16 KB to say nothing.
    rows.push({ t, v: +v.toFixed(3), seeded: true });
  }
  return rows;
}

/** Derived daily life-space. Never a route — see the note on state.lifespace. */
function seedLifespace(days) {
  const rows = [];
  for (let n = days; n >= 1; n--) {
    const d = new Date(Date.now() - n * 86400000);
    const day = Fmt.dayKey(d.getTime());
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    // The last week is deliberately smaller than the month before it, so the
    // panel demonstrates the thing it exists to detect — the same reason the
    // seeded CTI history has an inflection at week 8 instead of a flat line.
    const recent = n <= 7;
    // Recent beats weekend, or a single Saturday inside the contracted week
    // would put the furthest-from-home figure straight back to normal.
    const maxM = recent ? 900 : weekend ? 3400 : 2400;
    const cells = recent ? ['1.352,103.819', '1.353,103.820']
                         : ['1.352,103.819', '1.353,103.820', '1.357,103.824', '1.361,103.828'];
    rows.push({ day, maxM, sumM: maxM * 0.45 * 6, fixes: 6, cells,
                awayMin: recent ? 35 : weekend ? 190 : 145, seeded: true });
  }
  return rows;
}

/** A fresh retrieval ladder. Shared by faces, facts and object locations. */
function newCue() {
  return { stage: 0, wins: 0, losses: 0, intervalH: 4, lastTrial: null };
}

/* ---------------------------------------------------------------------------
   One demo person, so the Memory Vault has a history to show.

   The vault's whole argument is that it COMPOUNDS — that after three months of
   visits it knows things nobody typed in. That argument cannot be made by an
   empty page, and it cannot be made in the ninety seconds a judge spends on
   the stand either. So Mei Ling arrives with eleven weeks behind her.

   She has NO face descriptor. She cannot be recognised, she will never trigger
   a prompt, and enrolling a real person still requires a real photograph. She
   exists to be read, and every screen that shows her says she is a sample.
   --------------------------------------------------------------------------- */
function seedVaultPerson() {
  const day = n => Date.now() - n * 86400000;
  const S = (n, hour, min, topics, summary, facts = []) => ({
    id: 's' + n, ts: new Date(new Date(day(n)).setHours(hour, 0, 0, 0)).getTime(),
    day: Fmt.dayKey(day(n)),
    durationMin: min, people: ['seed-meiling'], names: ['Mei Ling'],
    topics, facts: facts.map((text, i) => ({ id: 'sf' + n + i, text })),
    summary, model: 'sample', fragments: Math.round(min * 4), seeded: true,
  });

  return {
    id: 'seed-meiling',
    name: 'Mei Ling',
    relation: 'Daughter',
    memory: 'She brings kaya toast on Sundays.',
    photo: null,
    descriptor: [],              // deliberately empty — she cannot be recognised
    seeded: true,
    cue: newCue(),
    trials: [],
    created: day(78),
    vault: {
      rotate: 0,
      notes: [
        { id: 'n-seed-1', text: 'She brings kaya toast on Sundays.',
          source: 'family', ts: day(78), pinned: true },
        { id: 'n-seed-2', text: 'She works at the hospital in Novena and finishes at six.',
          source: 'family', ts: day(78), pinned: true },
        { id: 'n-seed-3', text: 'Wei Jie passed his A levels',
          source: 'conversation', ts: day(6), pinned: false },
        { id: 'n-seed-4', text: 'The lift in her block has been broken for a week',
          source: 'conversation', ts: day(13), pinned: false },
        { id: 'n-seed-5', text: 'She is taking leave on the 12th for the clinic appointment',
          source: 'conversation', ts: day(20), pinned: false },
        { id: 'n-seed-6', text: 'Wei Jie has started driving lessons',
          source: 'conversation', ts: day(34), pinned: false },
      ],
      topics: [
        { word: 'Wei Jie', count: 19, lastTs: day(6) },
        { word: 'hospital', count: 11, lastTs: day(13) },
        { word: 'kaya toast', count: 9, lastTs: day(6) },
        { word: 'the lift', count: 7, lastTs: day(13) },
        { word: 'driving lessons', count: 5, lastTs: day(34) },
        { word: 'clinic', count: 4, lastTs: day(20) },
      ],
      visits: [6, 13, 20, 27, 34, 41, 48, 55, 62, 69, 76].map(n => ({
        ts: day(n), durationMs: (35 + (n % 4) * 9) * 60000, fragments: 90, seeded: true,
      })),
      sessions: [
        S(6, 15, 52, ['Wei Jie', 'exams', 'kaya toast'],
          'Mei Ling came over on Sunday afternoon with kaya toast. Most of it was about Wei Jie getting his A level results.',
          ['Wei Jie passed his A levels']),
        S(13, 16, 38, ['the lift', 'hospital', 'shopping'],
          'A shorter visit after her shift. She was mostly complaining about the lift in her block being out again.',
          ['The lift in her block has been broken for a week']),
        S(20, 15, 44, ['clinic', 'appointment', 'leave'],
          'They sorted out the clinic appointment together and she said she would take the morning off.',
          ['She is taking leave on the 12th for the clinic appointment']),
        S(27, 14, 61, ['kaya toast', 'the kampong', 'Punggol'],
          'A long Sunday. He told her about the kampong in Punggol again and she let him.', []),
        S(34, 16, 29, ['driving lessons', 'Wei Jie'],
          'Brief one. Wei Jie has started driving lessons and she is not enjoying being the passenger.',
          ['Wei Jie has started driving lessons']),
        S(41, 15, 47, ['hospital', 'her roster', 'kaya toast'], 'Sunday as usual, mostly about her new roster.', []),
        S(48, 15, 55, ['Wei Jie', 'school'], 'They talked about Wei Jie finishing school.', []),
        S(55, 16, 33, ['shopping', 'market'], 'She took him to the market and they had lunch after.', []),
        S(62, 15, 50, ['the wedding', 'Siew Kim'],
          'He talked about the wedding in 1978 and she asked him about the nine tables.', []),
        S(69, 15, 41, ['hospital', 'work'], 'A quiet Sunday. She was tired after a long week.', []),
        S(76, 14, 58, ['kaya toast', 'Wei Jie'], 'The first visit the glasses were there for.', []),
      ],
    },
  };
}

/* Schema version. BUMP THIS whenever a new top-level collection is added,
   or migrate() will not run for anyone who already has a saved session and
   their new features will silently render empty. */
const SCHEMA = 6;

function seedState() {
  return {
    version: SCHEMA,
    created: Date.now(),
    patient: {
      name: 'Tan Ah Kow',
      age: 71,
      stage: 'mild',            // questionable | mild | moderate
      language: 'en-SG',
      support: 'standard',      // light | standard | high
      wakeHours: 9,             // unsupervised weekday window, 9am-6pm
      speechRate: 0.82,         // presbycusis profile: 18% slower
    },
    people: [seedVaultPerson()],
    meds: [
      { id: 'm1', name: 'Donepezil', desc: 'the white pill, with water', time: '13:00' },
      { id: 'm2', name: 'Amlodipine', desc: 'the small yellow pill', time: '08:00' },
    ],
    places: [
      { id: 'p1', label: 'Lift lobby', say: 'This is the lift lobby. Your flat is on the seventh floor, unit 12.' },
      { id: 'p2', label: 'Coffee shop', say: 'This is the coffee shop downstairs. You come here for kopi in the morning.' },
    ],
    appointments: seedAppointments(),
    lifeStory: [
      { id: 'l1', kind: 'work',  label: 'Textile factory, Chinatown', detail: 'You cut cloth there for thirty-one years.' },
      { id: 'l2', kind: 'home',  label: 'Kampong in Punggol',        detail: 'You grew up there before the flats were built.' },
      { id: 'l3', kind: 'song',  label: '月亮代表我的心',              detail: 'You and Siew Kim danced to it at your wedding.' },
      { id: 'l4', kind: 'event', label: 'Wedding, 1978',             detail: 'Nine tables at a coffee shop in Geylang.' },
    ],
    voices: {},               // personId -> recorded audio dataURL

    /* ---- Episodic memory. FACTS, never transcripts. -----------------
       What was said is held in volatile memory only and discarded; what
       survives is one short fact a human confirmed. See js/memory.js. */
    facts: [
      { id: 'f1', text: 'Your grandson passed his exams', personId: null,
        who: 'Mei Ling', ts: Date.now() - 86400000 * 2, source: 'seed',
        status: 'kept', cue: newCue(), trials: [] },
    ],

    /* ---- Things he puts down and cannot find ------------------------
       Objects carry a cue ladder too: where a thing lives is exactly the
       kind of fact spaced retrieval is good at re-teaching. */
    objects: [
      { id: 'o1', name: 'wallet', home: 'the drawer by the door', lastSeen: null, tagged: true, cue: newCue(), trials: [] },
      { id: 'o2', name: 'keys', home: 'the hook by the door', lastSeen: null, tagged: true, cue: newCue(), trials: [] },
      { id: 'o3', name: 'walking stick', home: 'beside the sofa', lastSeen: null, tagged: false, cue: newCue(), trials: [] },
      { id: 'o4', name: 'spectacles case', home: 'the bedside table', lastSeen: null, tagged: false, cue: newCue(), trials: [] },
    ],

    /* ---- The day, written by the family --------------------------------
       Not a to-do list. A shape for the day, spoken at the right moment.
       Each item is one thing, at one time, in his own words. */
    plan: [
      { id: 'pl1', time: '07:30', title: 'Breakfast', detail: 'Porridge is in the pot. Fatimah made it.', kind: 'meal', done: null },
      { id: 'pl2', time: '09:30', title: 'Walk downstairs', detail: 'One round of the void deck, then sit for a while.', kind: 'move', done: null },
      { id: 'pl3', time: '12:30', title: 'Lunch', detail: 'There is rice and soup in the fridge.', kind: 'meal', done: null },
      { id: 'pl4', time: '16:00', title: 'Water the plants', detail: 'The ones on the corridor, not the balcony.', kind: 'task', done: null },
      { id: 'pl5', time: '19:00', title: 'Mei Ling calls', detail: 'She rings most evenings after her dinner.', kind: 'social', done: null },
    ],

    /* ---- Bluetooth tags on the things he loses ---------------------- */
    tags: [],                 // { id, name, deviceId, deviceName, paired, lastSeen, rssi }

    /* ---- Actigraphy. One number per five minutes, nothing else. -----
       This is what standard rest-activity research runs on: an activity
       count per epoch. From it come IS, IV and RA, which are the validated
       measures. Seven days at five-minute epochs is ~2,000 numbers. */
    // Seeded, and labelled as seeded on the dashboard. Live samples from the
    // accelerometer append to this and are indistinguishable in shape but
    // carry no `seeded` flag, so the UI can always tell them apart.
    activity: seedActivity(Store.EPOCH_MIN, Store.ACTIVITY_DAYS),

    /* ---- Life-space, WITHOUT a location trail ------------------------
       Life-space mobility predicts cognitive decline, and GPS-derived area
       and distance-from-home separate mild AD from controls. But storing a
       track of everywhere someone went is exactly the surveillance this
       product refuses to be. So we keep only DERIVED numbers per day, plus
       coarse ~110m grid cells to count distinct places. The route is never
       reconstructable. */
    lifespace: seedLifespace(35),   // { day, maxM, sumM, cells:[], awayMin, fixes }

    /* ---- Geofence. A safe zone, not a map with a dot on it. --------- */
    zones: [],                // { id, label, lat, lng, radiusM }
    geo: { inZone: null, lastFix: null, lastEvent: null },

    events: [],
    audit: [],                // append-only, PDPA accountability
    weeks: seedWeeks(),
    wear: { sessionStart: null, todayMs: 0, lastSeen: null },
    fired: { day: null, keys: [] },   // scheduler dedupe, reset each day

    /* ---- PDPA / Mental Capacity Act record. See privacy.html. ---- */
    consent: {
      donor:  { name: '', signedTs: null, method: null, language: null },
      donee:  { name: '', relationship: '', lpaScope: '', signedTs: null },
      assent: { status: 'pending', lastAffirmedTs: null },
      reviewDueTs: null,
      retentionDays: 365,
      dpo: { name: '', email: '' },
      purposes: {
        recognition:  true,     // match enrolled faces, speak the prompt
        reminders:    true,     // medication, appointments, routine
        conversation: false,    // listen while an enrolled person is present
        location:     false,    // safe-zone alerts
        trajectory:   false,    // compute and share the Cognitive Trajectory Index
        research:     false,    // contribute de-identified data to the pilot
      },
    },

    settings: {
      demoSpeed: true,      // seconds instead of days between retrieval trials
      cameraEnabled: true,
      matchThreshold: 0.52,
      cooldownMs: 18000,
      scheduler: true,
    },
  };
}

/** Forward-migrate an older store rather than wiping the user's session. */
function migrate(s) {
  const fresh = seedState();
  if (!s.appointments) s.appointments = fresh.appointments;
  if (!s.lifeStory)    s.lifeStory    = fresh.lifeStory;
  if (!s.voices)       s.voices       = {};
  if (!s.audit)        s.audit        = [];
  if (!s.fired)        s.fired        = { day: null, keys: [] };
  if (!s.consent)      s.consent      = fresh.consent;
  if (!s.places)       s.places       = fresh.places;
  if (s.settings && s.settings.scheduler === undefined) s.settings.scheduler = true;

  // v3
  if (!s.facts)   s.facts   = fresh.facts;
  if (!s.objects) s.objects = fresh.objects;
  // Anything carrying a retrieval ladder must actually have one, or the
  // practice list throws on render.
  (s.facts || []).forEach(f => { if (!f.cue) f.cue = newCue(); if (!f.trials) f.trials = []; });
  (s.objects || []).forEach(o => { if (!o.cue) o.cue = newCue(); if (!o.trials) o.trials = []; });
  if (!s.zones)   s.zones   = [];
  if (!s.geo)     s.geo     = { inZone: null, lastFix: null, lastEvent: null };
  if (!s.plan)      s.plan      = fresh.plan;
  if (!s.tags)      s.tags      = [];
  // v5 — movement history. Seeded rather than empty, because an empty array
  // makes the two rhythm panels read "not enough data" forever on a machine
  // that has never had the accelerometer running. Stale seeded epochs are
  // dropped: they are indexed in absolute time, so a session left open for a
  // fortnight would otherwise show a week-old rhythm as if it were this week.
  const cutoff = Store.epochIndex() - Store.ACTIVITY_DAYS * 24 * 60 / Store.EPOCH_MIN;
  if (!s.activity || !s.activity.length
      || !s.activity.some(r => r.t >= cutoff)) s.activity = fresh.activity;
  if (!s.lifespace || !s.lifespace.length) s.lifespace = fresh.lifespace;

  // v6 — the sample vault person, but ONLY into an empty address book. If this
  // family has enrolled their own people, quietly inserting a daughter they do
  // not have would be worse than an empty demo page.
  if (!s.people || !s.people.length) s.people = fresh.people;
  (s.people || []).forEach(p => {
    if (p.vault && !p.vault.sessions) p.vault.sessions = [];
  });
  if (s.consent && s.consent.purposes) {
    const p = s.consent.purposes;
    if (p.conversation === undefined) p.conversation = false;
    if (p.location === undefined)     p.location = false;
  }

  s.version = fresh.version;
  return s;
}

/* ------------------------------------------------------------------- store */
const Store = {
  s: null,

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.s = raw ? JSON.parse(raw) : seedState();
    } catch (e) {
      console.warn('store: could not parse, reseeding', e);
      this.s = seedState();
    }
    if (!this.s.version) this.s = seedState();
    else if (this.s.version < SCHEMA) this.s = migrate(this.s);
    return this.s;
  },

  /* ==========================================================================
     STORAGE — why keeping every conversation is affordable

     A conversation record is about 390 bytes: who, when, how long, six topic
     words, the approved moments, and two sentences. The conversation itself is
     not in there, which is the point — the privacy decision and the storage
     decision are the same decision, and both were made once.

     For scale: one minute of 16 kHz mono audio is roughly 1.9 MB. A single
     recorded visit would cost more than five thousand of these records. A
     product that stored the audio would need a server, a bill, and a very
     different conversation with the family about what happens to it.

     Everything here is bounded. Nothing grows without a ceiling:

       activity    2,016 rows   7 days at one per five minutes
       lifespace      60 rows   one per day, ~40 coarse cells each
       events        800 rows
       audit         400 rows
       sessions      120 per person, and nothing older than a year
       notes          40 per person, pinned ones never dropped
       topics         25 per person
       visits         60 per person

     So the store cannot run away. What it CAN do is get fat on photographs and
     face descriptors, which is why the quota ladder below sheds those first.
     ========================================================================*/

  /** Bytes, by section. Real measurement, not an estimate. */
  usage() {
    // UTF-8 bytes. TextEncoder where it exists; otherwise count the string,
    // which is exact for the ASCII that all of this actually is.
    const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    const size = v => {
      const s = JSON.stringify(v) || '';
      return enc ? enc.encode(s).length : s.length;
    };
    const parts = {};
    Object.keys(this.s).forEach(k => { parts[k] = size(this.s[k]); });

    const people = this.s.people || [];
    const photos = people.reduce((n, p) => n + (p.photo ? size(p.photo) : 0), 0);
    const faces = people.reduce((n, p) => n + size(p.descriptor || []), 0);
    const sessions = people.reduce((n, p) =>
      n + ((p.vault && p.vault.sessions) || []).reduce((m, s) => m + size(s), 0), 0);
    const sessionCount = people.reduce((n, p) =>
      n + ((p.vault && p.vault.sessions) || []).length, 0);

    const total = size(this.s);
    return {
      total, parts,
      photos, faces, sessions, sessionCount,
      perSession: sessionCount ? Math.round(sessions / sessionCount) : 0,
      // The practical browser ceiling. Not a spec number — Chrome, Edge, Safari
      // and Firefox all land near 5 MB per origin for localStorage.
      budget: 5 * 1024 * 1024,
      percent: +(total / (5 * 1024 * 1024) * 100).toFixed(1),
    };
  },

  /** What can still be added before the ceiling, in things a person counts. */
  headroom() {
    const u = this.usage();
    const left = Math.max(0, u.budget - u.total);
    return {
      bytesLeft: left,
      conversations: Math.floor(left / 400),
      // A 420px enrolment thumbnail plus a 128-number descriptor.
      people: Math.floor(left / 26000),
    };
  },

  /* Shedding is not a transient condition — something was permanently deleted
     to make room, and the family is entitled to know which. So this is a
     sticky record, cleared only by a reset, not by the next successful save. */
  shed: null,          // { ts, dropped: [] }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch (e) {
      /* A quota ladder, shed in order of what is least painful to lose.
         Photographs are decoration — recognition runs on the descriptor, so
         dropping a photo costs a thumbnail and nothing else. The conversation
         history is the last thing to go, and it goes oldest-first, because it
         is the only thing here that cannot be recreated by asking someone. */
      console.warn('store: over quota, shedding', e);
      if (!this.shed) this.shed = { ts: Date.now(), dropped: [] };
      this.shed.ts = Date.now();
      const note = what => { if (!this.shed.dropped.includes(what)) this.shed.dropped.push(what); };

      const attempt = () => {
        try { localStorage.setItem(KEY, JSON.stringify(this.s)); return true; }
        catch (_) { return false; }
      };

      // 1. every photo but the four most recent
      note('older photographs');
      this.s.people.forEach((p, i) => { if (i < this.s.people.length - 4) p.photo = null; });
      if (attempt()) return this._broadcast();

      // 2. all photos
      note('all photographs');
      this.s.people.forEach(p => { p.photo = null; });
      if (attempt()) return this._broadcast();

      // 3. movement history — it rebuilds itself in a week
      note('this week of movement');
      this.s.activity = [];
      if (attempt()) return this._broadcast();

      // 4. the event log back to the last hundred
      note('most of the event log');
      this.s.events = this.s.events.slice(-100);
      if (attempt()) return this._broadcast();

      // 5. the oldest half of every conversation history. Last resort, and the
      // only one of these that cannot be recreated by asking somebody.
      note('the oldest half of the conversation history');
      this.s.people.forEach(p => {
        if (p.vault && p.vault.sessions && p.vault.sessions.length > 20) {
          p.vault.sessions = p.vault.sessions.slice(0, Math.ceil(p.vault.sessions.length / 2));
        }
      });
      attempt();
    }
    this._broadcast();
  },

  reset() {
    this.s = seedState();
    this.save();
  },

  /* ==========================================================================
     EDITING

     Everything here could be added and deleted, and almost nothing could be
     CHANGED. That is a data-loss trap wearing the clothes of a simple API: to
     fix a typo in his daughter's name, or to replace a blurry enrolment photo,
     you had to delete her — and deleting her destroyed her retrieval ladder,
     her trial history and her entire memory vault. Eleven weeks of
     conversations, gone, to correct a spelling.

     So: update in place, and keep the history.
     ========================================================================*/

  /** Generic patch for the simple collections. */
  update(collection, id, patch) {
    const list = this.s[collection];
    if (!Array.isArray(list)) return null;
    const item = list.find(x => x.id === id);
    if (!item) return null;
    Object.keys(patch).forEach(k => {
      if (patch[k] !== undefined) item[k] = patch[k];
    });
    this.audit(collection + '.update', item.label || item.name || item.title || id);
    this.save();
    return item;
  },

  updateMed(id, patch)         { return this.update('meds', id, patch); },
  updatePlace(id, patch)       { return this.update('places', id, patch); },
  updateObject(id, patch)      { return this.update('objects', id, patch); },
  updateStory(id, patch)       { return this.update('lifeStory', id, patch); },
  updateZone(id, patch)        { return this.update('zones', id, patch); },
  updateTag(id, patch)         { return this.update('tags', id, patch); },
  updateAppointment(id, patch) { return this.update('appointments', id, patch); },

  /**
   * Change a person without losing who they have been.
   *
   * The vault, the cue ladder and the trial history are deliberately NOT
   * touched. A new photograph of the same daughter is still the same daughter;
   * she does not go back to stage 0 and forget that they have talked ninety
   * times, and he is not made to start relearning her name because someone
   * took a better picture.
   *
   * Passing a new descriptor DOES replace the face vector, because that is the
   * one thing a re-enrolment is for. Pass `null` to leave it alone.
   */
  updatePerson(id, { name, relation, memory, photo, descriptor } = {}) {
    const p = this.person(id);
    if (!p) return null;
    const before = p.name;

    if (name !== undefined && name !== null && String(name).trim()) p.name = String(name).trim();
    if (relation !== undefined && relation !== null) p.relation = String(relation).trim();
    if (memory !== undefined && memory !== null) {
      p.memory = String(memory).trim();
      // The single memory string is also the first pinned note in the vault.
      // Leaving the two out of step is how a family edits something on one
      // screen and hears the old version out of the glasses that afternoon.
      if (typeof Vault !== 'undefined') {
        const v = Vault.of(p);
        const pinned = v.notes.find(n => n.pinned && n.source === 'family');
        if (pinned) pinned.text = p.memory;
        else if (p.memory) v.notes.unshift({ id: 'n' + this._id(''), text: p.memory,
                                             source: 'family', ts: Date.now(), pinned: true });
      }
    }
    if (photo !== undefined) p.photo = photo;          // null clears it deliberately
    if (descriptor && descriptor.length) {
      p.descriptor = Array.from(descriptor);
      p.refaced = Date.now();
      this.audit('person.reface', `${p.name}: new face descriptor, history kept`);
    }

    // The sample record stops being a sample the moment a human edits it.
    if (p.seeded) delete p.seeded;

    this.audit('person.update', before === p.name ? p.name : `${before} → ${p.name}`);
    this.save();
    return p;
  },

  /* ----------------------------------------------------------- people */
  addPerson({ name, relation, memory, photo, descriptor }) {
    const p = {
      id: 'x' + Math.random().toString(36).slice(2, 9),
      name, relation, memory,
      photo: photo || null,
      descriptor: Array.from(descriptor || []),
      cue: {
        stage: 0,             // 0 full prompt · 1 partial cue · 2 chime only
        wins: 0,              // consecutive unaided retrievals
        losses: 0,            // consecutive failures
        intervalH: 4,         // spaced-retrieval interval, hours
        lastTrial: null,
      },
      trials: [],
      created: Date.now(),
    };
    this.s.people.push(p);
    this.log(EV.ENROL, { personId: p.id, detail: name });
    this.save();
    return p;
  },

  removePerson(id) {
    this.s.people = this.s.people.filter(p => p.id !== id);
    this.save();
  },

  person(id) { return this.s.people.find(p => p.id === id); },

  /* ----------------------------------------------------------- events */
  log(type, extra = {}) {
    this.s.events.push({ ts: Date.now(), type, ...extra });
    if (this.s.events.length > 800) this.s.events = this.s.events.slice(-800);
    this.save();
  },

  eventsToday() {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    return this.s.events.filter(e => e.ts >= midnight.getTime());
  },

  /* ------------------------------------------------------------- wear */
  wearOn() {
    if (!this.s.wear.sessionStart) {
      this.s.wear.sessionStart = Date.now();
      this.log(EV.WEAR_ON);
    }
    this.s.wear.lastSeen = Date.now();
    this.save();
  },

  wearOff(idle = false) {
    if (this.s.wear.sessionStart) {
      this.s.wear.todayMs += Date.now() - this.s.wear.sessionStart;
      this.s.wear.sessionStart = null;
      this.log(idle ? EV.IDLE_OFF : EV.WEAR_OFF);
    }
    this.save();
  },

  wearMsToday() {
    const live = this.s.wear.sessionStart ? Date.now() - this.s.wear.sessionStart : 0;
    return this.s.wear.todayMs + live;
  },

  /* ------------------------------------------------------------ audit
     Append-only. The PDPA Accountability Obligation expects an organisation
     to be able to show what it did with personal data and why. This is that
     record, and privacy.html renders it for the family to read. */
  audit(action, detail, actor = 'caregiver') {
    this.s.audit.push({ ts: Date.now(), actor, action, detail });
    if (this.s.audit.length > 400) this.s.audit = this.s.audit.slice(-400);
    this.save();
  },

  /* ----------------------------------------------------- collections */
  _id(p) { return p + Math.random().toString(36).slice(2, 8); },

  addAppointment(a) {
    const rec = { id: this._id('a'), remind: [1440, 60], ...a };
    this.s.appointments.push(rec);
    this.audit('appointment.create', `${rec.title} — ${new Date(rec.when).toLocaleString('en-GB')}`);
    return rec;
  },
  removeAppointment(id) {
    const a = this.s.appointments.find(x => x.id === id);
    this.s.appointments = this.s.appointments.filter(x => x.id !== id);
    this.audit('appointment.delete', a ? a.title : id);
  },
  /** Upcoming, soonest first. */
  upcoming(limit = 20) {
    const now = Date.now();
    return this.s.appointments.filter(a => a.when >= now).sort((a, b) => a.when - b.when).slice(0, limit);
  },

  /* Every add* returns the thing it created. addPerson and addAppointment
     always did; the rest silently returned undefined, so any new UI that tried
     `const o = Store.addObject(...)` got undefined and failed one line later
     on a property access. Consistency here is not tidiness, it is the
     difference between an API you can use without reading it and one you
     cannot. */
  addPlace(p) {
    const rec = { id: this._id('p'), ...p };
    this.s.places.push(rec); this.audit('place.create', p.label); return rec;
  },
  removePlace(id) { this.s.places = this.s.places.filter(x => x.id !== id); this.audit('place.delete', id); },

  addStory(s2) {
    const rec = { id: this._id('l'), ...s2 };
    this.s.lifeStory.push(rec); this.audit('story.create', s2.label); return rec;
  },
  removeStory(id)  { this.s.lifeStory = this.s.lifeStory.filter(x => x.id !== id); this.audit('story.delete', id); },

  addMed(m) {
    const rec = { id: this._id('m'), ...m };
    this.s.meds.push(rec); this.audit('medication.create', m.name); return rec;
  },
  removeMed(id) { this.s.meds = this.s.meds.filter(x => x.id !== id); this.audit('medication.delete', id); },

  /* ---------------------------------------------------- episodic facts
     A fact only exists because a human confirmed it. Nothing that was
     merely heard is ever stored — see js/memory.js. */
  proposeFact({ text, who, personId, people }) {
    const f = { id: this._id('f'), text, who: who || '', personId: personId || null,
                people: people || (personId ? [personId] : []),
                ts: Date.now(), source: 'conversation', status: 'proposed',
                cue: newCue(), trials: [] };
    this.s.facts.push(f);
    this.log(EV.FACT_HEARD, { detail: text });
    this.save();
    return f;
  },
  confirmFact(id, text) {
    const f = this.s.facts.find(x => x.id === id);
    if (!f) return;
    if (text) f.text = text;
    f.status = 'kept';
    this.log(EV.FACT_KEPT, { detail: f.text });
    this.audit('fact.confirm', f.text);
    // A confirmed fact is also something now known about whoever was there.
    if (typeof Vault !== 'undefined') Vault.noteFromFact(f);
  },
  dropFact(id) {
    const f = this.s.facts.find(x => x.id === id);
    this.s.facts = this.s.facts.filter(x => x.id !== id);
    this.log(EV.FACT_DROPPED, { detail: f ? f.text : id });
    this.audit('fact.discard', f ? f.text : id);
  },
  keptFacts() { return this.s.facts.filter(f => f.status === 'kept'); },
  proposedFacts() { return this.s.facts.filter(f => f.status === 'proposed'); },

  /* --------------------------------------------------------- objects */
  addObject(o) {
    const rec = { id: this._id('o'), lastSeen: null, tagged: false,
                  cue: newCue(), trials: [], ...o };
    this.s.objects.push(rec);
    this.audit('object.create', o.name);
    return rec;
  },
  removeObject(id) { this.s.objects = this.s.objects.filter(x => x.id !== id); this.audit('object.delete', id); },
  findObject(name) {
    const n = (name || '').toLowerCase();
    return this.s.objects.find(o => n.includes(o.name.toLowerCase()))
        || this.s.objects.find(o => o.name.toLowerCase().includes(n));
  },
  placeObject(id, where) {
    const o = this.s.objects.find(x => x.id === id);
    if (!o) return;
    o.lastSeen = { place: where, ts: Date.now() };
    this.log(EV.OBJ_SEEN, { detail: `${o.name} — ${where}` });
    this.save();
  },

  /* ------------------------------------------------------ daily plan */
  addPlan(p) {
    const rec = { id: this._id('pl'), kind: 'task', done: null, ...p };
    this.s.plan.push(rec);
    this.s.plan.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    this.audit('plan.create', `${p.time} ${p.title}`);
    this.save();
    return rec;
  },
  removePlan(id) { const p = this.s.plan.find(x => x.id === id);
                   this.s.plan = this.s.plan.filter(x => x.id !== id);
                   this.audit('plan.delete', p ? p.title : id); this.save(); },
  updatePlan(id, patch) { const p = this.s.plan.find(x => x.id === id);
                          if (p) { Object.assign(p, patch);
                                   this.s.plan.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
                                   this.save(); } },
  markPlanDone(id) {
    const p = this.s.plan.find(x => x.id === id);
    if (!p) return;
    p.done = { date: this.todayKey(), ts: Date.now() };
    this.log(EV.PLAN_DONE, { detail: p.title });
    this.save();
  },
  planDoneToday(p) { return !!(p.done && p.done.date === this.todayKey()); },
  planToday() { return this.s.plan.slice().sort((a, b) => (a.time || '').localeCompare(b.time || '')); },

  /* ------------------------------------------------ bluetooth tags */
  addTag(t) {
    const rec = { id: this._id('t'), paired: false, lastSeen: null, ...t };
    this.s.tags.push(rec);
    this.audit('tag.pair', t.name);
    this.save();
    return rec;
  },
  removeTag(id) { const t = this.s.tags.find(x => x.id === id);
                  this.s.tags = this.s.tags.filter(x => x.id !== id);
                  this.audit('tag.remove', t ? t.name : id); this.save(); },
  findTag(name) {
    const n = (name || '').toLowerCase();
    return this.s.tags.find(t => n.includes(t.name.toLowerCase()))
        || this.s.tags.find(t => t.name.toLowerCase().includes(n));
  },
  noteTagSeen(id, where, rssi) {
    const t = this.s.tags.find(x => x.id === id);
    if (!t) return;
    t.lastSeen = { place: where || null, ts: Date.now(), rssi: rssi ?? null };
    this.save();
  },

  /* ---------------------------------------------------- actigraphy
     Five-minute epochs, seven days kept. The epoch index is minutes since
     the unix epoch divided by five, so it survives reloads and time zones. */
  EPOCH_MIN: 5,
  ACTIVITY_DAYS: 7,

  epochIndex(ts = Date.now()) { return Math.floor(ts / 60000 / this.EPOCH_MIN); },

  recordActivity(magnitude) {
    const t = this.epochIndex();
    const a = this.s.activity;
    const last = a[a.length - 1];
    if (last && last.t === t) {
      // running mean within the epoch
      last.n = (last.n || 1) + 1;
      last.v = last.v + (magnitude - last.v) / last.n;
    } else {
      // A new epoch has started, so the previous row's sample count has done
      // its job. `n` exists only to keep the running mean honest while the
      // epoch is open; carrying it on 2,015 historical rows is pure weight.
      if (last) { delete last.n; last.v = +last.v.toFixed(3); }
      a.push({ t, v: magnitude, n: 1 });
    }
    const keep = this.ACTIVITY_DAYS * 24 * 60 / this.EPOCH_MIN;
    if (a.length > keep) this.s.activity = a.slice(-keep);
  },

  /* ---------------------------------------------------- life-space
     A day's worth of derived mobility. Never a coordinate beyond home. */
  recordFix(fix, home) {
    if (!fix || !home) return;
    const day = this.todayKey();
    let d = this.s.lifespace.find(x => x.day === day);
    if (!d) {
      d = { day, maxM: 0, sumM: 0, fixes: 0, cells: [], awayMin: 0, lastTs: null };
      this.s.lifespace.push(d);
      if (this.s.lifespace.length > 60) this.s.lifespace = this.s.lifespace.slice(-60);
    }
    const m = Geo.distance(home, fix);
    d.maxM = Math.max(d.maxM, Math.round(m));
    d.sumM += m;
    d.fixes++;
    // ~0.001 degree is about 110 m. Coarse enough that the cell is a
    // neighbourhood, not an address.
    const cell = fix.lat.toFixed(3) + ',' + fix.lng.toFixed(3);
    // Capped. A long bus ride crosses a lot of 110 m squares, and the panel
    // only ever reports HOW MANY places, never which — so an unbounded list
    // would grow all day to answer a question nobody asked of it. Forty is far
    // beyond any real day out and keeps one day's record under a kilobyte.
    if (!d.cells.includes(cell) && d.cells.length < 40) d.cells.push(cell);

    // Time away must come from the CLOCK, not from a count of fixes — fixes
    // arrive irregularly, so counting them measured the sampling rate rather
    // than how long he was out. Each fix carries the time since the last one,
    // capped so a gap in coverage cannot invent an afternoon.
    const now = fix.ts || Date.now();
    const outside = m > ((this.s.zones[0] && this.s.zones[0].radiusM) || 250);
    if (outside) {
      const gapMin = d.lastTs ? Math.min((now - d.lastTs) / 60000, 10) : 1;
      d.awayMin += Math.max(gapMin, 0);
    }
    d.lastTs = now;
    this.save();
  },

  /* ----------------------------------------------------- safe zones */
  addZone(z) {
    const rec = { id: this._id('z'), radiusM: 250, ...z };
    this.s.zones.push(rec);
    this.audit('zone.create', `${z.label} r=${z.radiusM || 250}m`);
    this.save();
    return rec;
  },
  removeZone(id) { this.s.zones = this.s.zones.filter(x => x.id !== id); this.audit('zone.delete', id); this.save(); },

  /* -------------------------------------------- scheduler dedupe keys */
  /* Local, not UTC. See Fmt.dayKey — in Singapore a UTC day key rolls over
     at 8am, so the morning medication prompt at 07:55 would be filed under
     yesterday and the whole once-per-day dedupe would misfire every morning. */
  todayKey() { return Fmt.dayKey(); },
  hasFired(key) {
    if (this.s.fired.day !== this.todayKey()) return false;
    return this.s.fired.keys.includes(key);
  },
  markFired(key) {
    if (this.s.fired.day !== this.todayKey()) this.s.fired = { day: this.todayKey(), keys: [] };
    if (!this.s.fired.keys.includes(key)) this.s.fired.keys.push(key);
    this.save();
  },

  /* ------------------------------------------------------ PDPA rights */

  /** Access & Portability: everything we hold, in a readable file. */
  exportAll() {
    const s = this.s;
    const payload = {
      exportedAt: new Date().toISOString(),
      notice: 'Personal data held by INGAT for this care circle, exported under the '
            + 'PDPA Access and Data Portability provisions. Face descriptors are '
            + '128-float vectors; they are not images and cannot be turned back into a face.',
      patient: s.patient,
      consent: s.consent,
      people: s.people.map(p => ({
        name: p.name, relation: p.relation, memory: p.memory,
        enrolledAt: p.created,
        hasPhoto: !!p.photo,
        descriptorLength: p.descriptor ? p.descriptor.length : 0,
        cue: p.cue, trials: p.trials,
      })),
      places: s.places, lifeStory: s.lifeStory,
      medications: s.meds, appointments: s.appointments,
      facts: s.facts.map(f => ({ text: f.text, who: f.who, when: f.ts,
                                 status: f.status, trials: f.trials.length })),
      objects: s.objects, safeZones: s.zones,
      events: s.events, audit: s.audit, weeks: s.weeks,
    };
    this.log(EV.EXPORT);
    this.audit('data.export', `${s.people.length} people, ${s.events.length} events`);
    return payload;
  },

  /** Erasure. Descriptors and photos go first — they are the sensitive part. */
  eraseBiometrics() {
    const n = this.s.people.length;
    this.s.people.forEach(p => { p.descriptor = []; p.photo = null; });
    this.s.voices = {};
    this.log(EV.ERASE);
    this.audit('data.erase.biometric', `${n} face descriptors and photos destroyed; names and prompts kept`);
    this.save();
  },

  eraseEverything() {
    this.audit('data.erase.all', 'full erasure requested by the care circle');
    const keep = this.s.audit.slice();   // the erasure itself stays on the record
    this.s = seedState();
    this.s.people = []; this.s.events = []; this.s.weeks = [];
    this.s.appointments = []; this.s.lifeStory = []; this.s.places = []; this.s.meds = [];
    this.s.audit = keep;
    this.save();
  },

  /** Retention Limitation: how long until data must be reviewed or destroyed. */
  retentionDaysLeft() {
    const start = this.s.consent.donor.signedTs || this.s.created;
    const end = start + this.s.consent.retentionDays * 86400000;
    return Math.ceil((end - Date.now()) / 86400000);
  },

  /* --------------------------------------------------- cross-tab sync */
  _listeners: [],
  onChange(fn) { this._listeners.push(fn); },
  _broadcast() {
    this._listeners.forEach(fn => { try { fn(this.s); } catch (e) { console.error(e); } });
  },
  listen() {
    // Two browser tabs (glasses + dashboard) stay in sync through this.
    window.addEventListener('storage', e => {
      if (e.key === KEY && e.newValue) {
        try { this.s = JSON.parse(e.newValue); this._broadcast(); } catch (_) {}
      }
    });
  },
};

/* ------------------------------------------------------------- utilities */
const Fmt = {
  clock(ts) {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },
  hm(ts) {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  },
  dur(ms) {
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  },
  initials(n) {
    return (n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  },
  /** "3 Jul" — a date a person reads, not an ISO string. */
  day(ts) {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },
  /**
   * "2026-07-31" in LOCAL time, for grouping things by day.
   *
   * NOT toISOString().slice(0,10). Singapore is UTC+8, so anything happening
   * before 8am has a UTC date of the day before — an 8:30pm dinner is fine but
   * a 7am breakfast conversation would be filed under yesterday, and the whole
   * timeline would quietly drift by one day for a third of the morning.
   */
  dayKey(ts = Date.now()) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
};

window.Store = Store;
window.EV = EV;
window.Fmt = Fmt;
