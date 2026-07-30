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

function seedState() {
  return {
    version: 2,
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
    people: [],
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
        recognition: true,      // match enrolled faces, speak the prompt
        reminders:   true,      // medication, appointments, routine
        trajectory:  false,     // compute and share the Cognitive Trajectory Index
        research:    false,     // contribute de-identified data to the pilot
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

/** Forward-migrate a v1 store rather than wiping the user's session. */
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
    else if (this.s.version < 2) this.s = migrate(this.s);
    return this.s;
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch (e) {
      // Descriptors + photos can push us over quota. Drop the oldest photos
      // rather than losing the whole session.
      console.warn('store: quota, trimming photos', e);
      this.s.people.forEach((p, i) => { if (i < this.s.people.length - 4) p.photo = null; });
      try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch (_) {}
    }
    this._broadcast();
  },

  reset() {
    this.s = seedState();
    this.save();
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

  addPlace(p)     { this.s.places.push({ id: this._id('p'), ...p }); this.audit('place.create', p.label); },
  removePlace(id) { this.s.places = this.s.places.filter(x => x.id !== id); this.audit('place.delete', id); },

  addStory(s2)     { this.s.lifeStory.push({ id: this._id('l'), ...s2 }); this.audit('story.create', s2.label); },
  removeStory(id)  { this.s.lifeStory = this.s.lifeStory.filter(x => x.id !== id); this.audit('story.delete', id); },

  addMed(m)     { this.s.meds.push({ id: this._id('m'), ...m }); this.audit('medication.create', m.name); },
  removeMed(id) { this.s.meds = this.s.meds.filter(x => x.id !== id); this.audit('medication.delete', id); },

  /* -------------------------------------------- scheduler dedupe keys */
  todayKey() { return new Date().toISOString().slice(0, 10); },
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
};

window.Store = Store;
window.EV = EV;
window.Fmt = Fmt;
