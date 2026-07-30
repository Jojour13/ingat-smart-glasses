/* ============================================================================
   cues.js — the vanishing-cue / spaced-retrieval engine

   This is the differentiator. Competing products always supply the answer,
   which is a prosthesis and creates permanent dependency — and perceived loss
   of autonomy is one of the strongest predictors of assistive-device
   abandonment. So the prompt shrinks.

   Protocol: errorless learning with vanishing cues, retrieved at expanding
   intervals. Published result for this method on face naming: 22% -> 98%,
   generalising from photographs to real faces and maintained at 3, 6 and 9
   months. See README for the citation.

     Stage 0  FULL PROMPT   "Mei Ling. Your daughter. She came last Sunday."
              Errorless — he never experiences failure, so no wrong trace forms.
     Stage 1  PARTIAL CUE   "Mei..."   then a 2 s window
     Stage 2  CHIME ONLY    ( tone )   then a 3 s window

   Advance on 3 consecutive unaided retrievals. Regress on 2 consecutive
   failures — support must come back as readily as it withdraws.
   Interval x1.6 on success, halved on failure.

   The therapy dose IS the measurement: every trial emits latency, stage and
   outcome, which is exactly what the Cognitive Trajectory Index consumes.
   ==========================================================================*/

const STAGES = [
  { id: 0, label: 'Full prompt', short: 'FULL',    windowMs: 0 },
  { id: 1, label: 'Partial cue', short: 'PARTIAL', windowMs: 2000 },
  { id: 2, label: 'Chime only',  short: 'CHIME',   windowMs: 3000 },
];

const ADVANCE_AFTER = 3;   // consecutive unaided retrievals
const REGRESS_AFTER = 2;   // consecutive failures

const Cues = {
  _cooldown: new Map(),     // personId -> timestamp
  _busy: false,
  onEvent: null,            // (kind, payload) => void  for the UI

  /** Should we run a trial for this person right now? */
  due(person) {
    if (this._busy) return false;
    const last = this._cooldown.get(person.id) || 0;
    const gap = Store.s.settings.demoSpeed
      ? Store.s.settings.cooldownMs                       // seconds, for the demo
      : person.cue.intervalH * 3600 * 1000;               // real spaced interval
    return Date.now() - last >= gap;
  },

  /** Human-readable first cue: first word, or first three letters. */
  partialCue(name) {
    const first = (name || '').trim().split(/\s+/)[0] || '';
    return (first.length > 4 ? first.slice(0, 3) : first) + '…';
  },

  fullPrompt(p) {
    const bits = [p.name];
    if (p.relation) bits.push(p.relation);
    let s = bits.join('. ') + '.';
    if (p.memory) s += ' ' + p.memory.replace(/\.?$/, '.');
    return s;
  },

  /**
   * Run one retrieval trial. Resolves to the trial record.
   * This is the whole loop: cue -> window -> outcome -> adapt -> log.
   */
  async trial(person) {
    if (this._busy) return null;
    this._busy = true;
    this._cooldown.set(person.id, Date.now());

    const stage = STAGES[person.cue.stage] || STAGES[0];
    const lang = Store.s.patient.language;
    const emit = (k, d) => this.onEvent && this.onEvent(k, d);

    let outcome, latency = null, via = 'scaffold';

    try {
      if (stage.id === 0) {
        // ---- errorless: supply everything, immediately, no test
        emit('cue', { person, stage, window: 0 });
        Store.log(EV.PROMPT_FULL, { personId: person.id, detail: person.name });
        await Speech.sayAs(person.id, this.fullPrompt(person), { lang, tag: 'full' });
        outcome = 'scaffolded';

      } else {
        // ---- test with a shrinking cue
        if (stage.id === 1) {
          Store.log(EV.PROMPT_CUE, { personId: person.id, detail: person.name });
          await Speech.say(this.partialCue(person.name), { lang, tag: 'cue' });
        } else {
          Store.log(EV.PROMPT_CHIME, { personId: person.id, detail: person.name });
          Speech.chime();
          await new Promise(r => setTimeout(r, 420));
        }

        emit('window', { person, stage, window: stage.windowMs });
        const targets = [person.name, person.name.split(/\s+/)[0]];
        const res = await Listener.listen(targets, stage.windowMs, lang);
        emit('window-end', { person });

        if (res.hit) {
          outcome = 'unaided';
          latency = res.ms;
          via = res.via;
          Store.log(EV.UNAIDED, { personId: person.id, detail: person.name, latency, via });
          // brief affirmation, then get out of the way
          await Speech.say('Yes. ' + person.name + '.', { lang, tag: 'ok' });
        } else if (res.via === 'manual') {
          outcome = 'assisted';
          latency = res.ms;
          Store.log(EV.ASSISTED, { personId: person.id, detail: person.name, latency });
          await Speech.sayAs(person.id, this.fullPrompt(person), { lang, tag: 'full' });
        } else {
          outcome = 'missed';
          latency = stage.windowMs;
          Store.log(EV.MISSED, { personId: person.id, detail: person.name, latency });
          await Speech.sayAs(person.id, this.fullPrompt(person), { lang, tag: 'full' });
        }
      }

      const rec = { ts: Date.now(), stage: stage.id, outcome, latency, via };
      person.trials.push(rec);
      if (person.trials.length > 120) person.trials = person.trials.slice(-120);
      this._adapt(person, outcome);
      Store.save();
      emit('trial', { person, rec });
      return rec;

    } finally {
      this._busy = false;
    }
  },

  /** Expanding-interval scheduling and stage transitions. */
  _adapt(person, outcome) {
    const c = person.cue;
    c.lastTrial = Date.now();

    if (outcome === 'unaided') {
      c.wins++; c.losses = 0;
      c.intervalH = Math.min(72, +(c.intervalH * 1.6).toFixed(2));
      if (c.wins >= ADVANCE_AFTER && c.stage < STAGES.length - 1) {
        c.stage++; c.wins = 0;
        Store.log(EV.STAGE_UP, { personId: person.id, detail: `${person.name} -> ${STAGES[c.stage].short}` });
        this.onEvent && this.onEvent('stage', { person, dir: 'up', stage: STAGES[c.stage] });
      }
    } else if (outcome === 'scaffolded') {
      // Errorless phase. Count exposures towards the first promotion, but
      // do not lengthen the interval — he is not being tested yet.
      c.wins++;
      if (c.wins >= ADVANCE_AFTER && c.stage < STAGES.length - 1) {
        c.stage++; c.wins = 0;
        Store.log(EV.STAGE_UP, { personId: person.id, detail: `${person.name} -> ${STAGES[c.stage].short}` });
        this.onEvent && this.onEvent('stage', { person, dir: 'up', stage: STAGES[c.stage] });
      }
    } else {
      c.losses++; c.wins = 0;
      c.intervalH = Math.max(1, +(c.intervalH / 2).toFixed(2));
      if (c.losses >= REGRESS_AFTER && c.stage > 0) {
        c.stage--; c.losses = 0;
        Store.log(EV.STAGE_DOWN, { personId: person.id, detail: `${person.name} -> ${STAGES[c.stage].short}` });
        this.onEvent && this.onEvent('stage', { person, dir: 'down', stage: STAGES[c.stage] });
      }
    }
  },

  /** "Someone is here." We never guess a name. */
  async unknown() {
    if (this._busy) return;
    const k = '__unknown';
    const last = this._cooldown.get(k) || 0;
    if (Date.now() - last < 12000) return;
    this._cooldown.set(k, Date.now());
    this._busy = true;
    try {
      Store.log(EV.UNKNOWN);
      this.onEvent && this.onEvent('unknown', {});
      await Speech.say('Someone is here.', { lang: Store.s.patient.language, tag: 'unknown' });
    } finally { this._busy = false; }
  },

  /** The single physical control: one tap means "tell me again". */
  async tellAgain(lastText) {
    // If a retrieval window is open, a tap means he could not produce it.
    if (Listener.busy) { Listener.confirm(false); return; }
    Store.log(EV.TELL_AGAIN);
    this.onEvent && this.onEvent('tellagain', {});
    if (lastText) await Speech.say(lastText, { lang: Store.s.patient.language, tag: 'repeat' });
  },

  /** Reset a person's ladder back to errorless. Used by the caregiver. */
  resetLadder(person) {
    person.cue = { stage: 0, wins: 0, losses: 0, intervalH: 4, lastTrial: null };
    Store.save();
  },

  progress(person) {
    const c = person.cue;
    const done = c.stage * ADVANCE_AFTER + Math.min(c.wins, ADVANCE_AFTER);
    const total = (STAGES.length - 1) * ADVANCE_AFTER + ADVANCE_AFTER;
    return Math.round(done / total * 100);
  },
};

window.Cues = Cues;
window.STAGES = STAGES;
