/* ============================================================================
   recall.js — the retrieval engine, pointed at everything that is not a face

   The vanishing-cue ladder in cues.js was always general; it was only ever
   aimed at faces. This applies the identical protocol to the other things a
   person with early dementia loses first:

     · episodic facts   "your grandson passed his exams"
     · object locations "the wallet lives in the drawer by the door"
     · routine          (same shape, not wired yet)

   That distinction matters for the pitch. Every competing product REMEMBERS
   FOR the person. Errorless learning with spaced retrieval asks them to
   remember for themselves, with help that shrinks — and the published result
   for that protocol on face naming was 22% to 98%, holding at nine months.
   There is no reason the mechanism should stop at faces.

   cues.js is deliberately left untouched. Face retrieval is the demo
   centrepiece and must not regress the day of a deadline, so this file
   duplicates ~30 lines of ladder logic rather than refactoring across it.
   Both read STAGES from cues.js, so the two can never drift apart on the
   thing that actually matters: what the wearer hears at each rung.
   ==========================================================================*/

const Recall = {
  ADVANCE_AFTER: 3,
  REGRESS_AFTER: 2,
  _busy: false,
  onEvent: null,

  /* ------------------------------------------------------------- items
     An "item" is anything with { id, cue, trials } plus a way to phrase
     itself. Facts and objects each supply their own phrasing below. */

  factItem(f) {
    return {
      kind: 'fact',
      id: f.id,
      ref: f,
      full: () => f.who ? `${f.who} told you: ${f.text}.` : `${f.text}.`,
      question: () => f.who ? `What did ${f.who} tell you?` : 'Do you remember what happened?',
      answers: () => this._keywords(f.text),
    };
  },

  objectItem(o) {
    // Defensive: an object stored before ladders existed has no cue.
    if (!o.cue) o.cue = { stage: 0, wins: 0, losses: 0, intervalH: 4, lastTrial: null };
    if (!o.trials) o.trials = [];
    const where = (o.lastSeen && o.lastSeen.place) || o.home;
    return {
      kind: 'object',
      id: o.id,
      ref: o,
      full: () => `Your ${o.name} is in ${where}.`,
      question: () => `Where does your ${o.name} live?`,
      answers: () => this._keywords(where),
    };
  },

  /** Words worth accepting as a correct spoken answer. */
  _keywords(text) {
    const stop = new Set(['the', 'a', 'an', 'your', 'you', 'is', 'in', 'on', 'at', 'by',
                          'of', 'and', 'to', 'his', 'her', 'it', 'was', 'told', 'that']);
    return (text || '')
      .toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !stop.has(w));
  },

  /* ------------------------------------------------------------ trial */
  due(item) {
    const gap = Store.s.settings.demoSpeed
      ? Store.s.settings.cooldownMs
      : item.ref.cue.intervalH * 3600 * 1000;
    return !item.ref.cue.lastTrial || (Date.now() - item.ref.cue.lastTrial) >= gap;
  },

  /**
   * One retrieval trial on a non-face item.
   * Stage 0 simply tells him. Stages 1 and 2 ask, then wait.
   */
  async trial(item) {
    if (this._busy || Cues._busy) return null;
    this._busy = true;
    const cue = item.ref.cue;
    const stage = STAGES[cue.stage] || STAGES[0];
    const lang = Store.s.patient.language;
    const emit = (k, d) => this.onEvent && this.onEvent(k, d);

    let outcome, latency = null, via = 'scaffold';
    try {
      if (stage.id === 0) {
        // errorless: state it plainly, no test
        emit('cue', { item, stage });
        await Speech.say(item.full(), { lang, tag: item.kind });
        outcome = 'scaffolded';

      } else {
        // ask, then leave a gap for him to produce it
        await Speech.say(item.question(), { lang, tag: item.kind + '-q' });
        emit('window', { item, stage, window: stage.windowMs });
        const res = await Listener.listen(item.answers(), stage.windowMs, lang);
        emit('window-end', { item });

        if (res.hit) {
          outcome = 'unaided'; latency = res.ms; via = res.via;
          Store.log(item.kind === 'fact' ? EV.FACT_RECALL : EV.OBJ_TOLD,
                    { detail: item.full(), latency });
          await Speech.say('That is right.', { lang, tag: 'ok' });
        } else {
          outcome = res.via === 'manual' ? 'assisted' : 'missed';
          latency = res.ms;
          if (item.kind === 'fact') Store.log(EV.FACT_MISSED, { detail: item.full() });
          await Speech.say(item.full(), { lang, tag: item.kind });
        }
      }

      const rec = { ts: Date.now(), stage: stage.id, outcome, latency, via };
      item.ref.trials.push(rec);
      if (item.ref.trials.length > 60) item.ref.trials = item.ref.trials.slice(-60);
      this._adapt(item.ref, outcome);
      Store.save();
      emit('trial', { item, rec });
      return rec;

    } finally {
      this._busy = false;
    }
  },

  /** Identical ladder rules to cues.js — advance on 3, regress on 2. */
  _adapt(ref, outcome) {
    const c = ref.cue;
    c.lastTrial = Date.now();
    if (outcome === 'unaided' || outcome === 'scaffolded') {
      if (outcome === 'unaided') c.intervalH = Math.min(72, +(c.intervalH * 1.6).toFixed(2));
      c.wins++; c.losses = 0;
      if (c.wins >= this.ADVANCE_AFTER && c.stage < STAGES.length - 1) {
        c.stage++; c.wins = 0;
        this.onEvent && this.onEvent('stage', { ref, dir: 'up', stage: STAGES[c.stage] });
      }
    } else {
      c.losses++; c.wins = 0;
      c.intervalH = Math.max(1, +(c.intervalH / 2).toFixed(2));
      if (c.losses >= this.REGRESS_AFTER && c.stage > 0) {
        c.stage--; c.losses = 0;
        this.onEvent && this.onEvent('stage', { ref, dir: 'down', stage: STAGES[c.stage] });
      }
    }
  },

  /* --------------------------------------------------------- rotation */
  /** Everything currently eligible for practice, soonest-due first. */
  queue() {
    const items = [
      ...Store.keptFacts().map(f => this.factItem(f)),
      ...Store.s.objects.filter(o => o.home).map(o => this.objectItem(o)),
    ];
    return items
      .filter(i => this.due(i))
      .sort((a, b) => (a.ref.cue.lastTrial || 0) - (b.ref.cue.lastTrial || 0));
  },

  /** Run the next thing due, if anything is. */
  async next() {
    const q = this.queue();
    if (!q.length) return null;
    return this.trial(q[0]);
  },

  /* ------------------------------------------ "where is my wallet?" */
  /**
   * Answer a spoken question about an object. This is a lookup, not a test —
   * if he is asking, he has already tried to remember and failed, and testing
   * him at that moment would be unkind and useless.
   */
  async whereIs(query) {
    const o = Store.findObject(query);
    Store.log(EV.OBJ_ASK, { detail: query });
    const lang = Store.s.patient.language;
    if (!o) {
      await Speech.say('I do not know where that is.', { lang, tag: 'object' });
      return null;
    }
    const seen = o.lastSeen;
    const fresh = seen && (Date.now() - seen.ts) < 36 * 3600 * 1000;
    const text = fresh
      ? `Your ${o.name} is in ${seen.place}. You put it there ${this._ago(seen.ts)}.`
      : `Your ${o.name} lives in ${o.home}.`;
    Store.log(EV.OBJ_TOLD, { detail: `${o.name} — ${fresh ? seen.place : o.home}` });
    await Speech.say(text, { lang, tag: 'object' });
    return o;
  },

  _ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 2) return 'just now';
    if (m < 60) return m + ' minutes ago';
    const h = Math.round(m / 60);
    if (h < 24) return h === 1 ? 'an hour ago' : h + ' hours ago';
    return 'yesterday';
  },

  /* ------------------------------------------------------- reporting */
  stats() {
    const all = [...Store.keptFacts(), ...Store.s.objects.filter(o => o.home)];
    let unaided = 0, tested = 0;
    all.forEach(x => (x.trials || []).forEach(t => {
      if (t.outcome === 'scaffolded') return;
      tested++;
      if (t.outcome === 'unaided') unaided++;
    }));
    return {
      items: all.length,
      tested,
      unaided,
      pct: tested ? Math.round(unaided / tested * 100) : null,
      facts: Store.keptFacts().length,
      pending: Store.proposedFacts().length,
    };
  },
};

window.Recall = Recall;
