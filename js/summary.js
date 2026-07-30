/* ============================================================================
   summary.js — the evening recap, written by an open-weight model

   At the end of the day the family gets four sentences: what he did, how he
   managed, and whether anything is worth a mention. Not a dashboard. A
   paragraph, in the tone a decent nurse would use.

   THREE ROUTES, IN THIS ORDER

     1. OLLAMA, on this machine.  http://localhost:11434
        Llama, Qwen, Gemma, Mistral, Phi — open weights, running locally.
        Nothing leaves the flat. For a product whose entire privacy argument is
        "his data stays with him", a local open model is not a fallback, it is
        the ideologically correct default.

     2. HUAWEI CLOUD MaaS, Singapore region.
        GLM, DeepSeek and Qwen are all open-weight families, served in-country,
        which keeps the data-residency claim intact.

     3. A WRITTEN TEMPLATE.
        Deterministic, offline, and good enough that nobody would notice. This
        one always works, so the feature never fails — it only gets better when
        a model is available.

   WHAT IS SENT: counts and short confirmed facts. Never a transcript, never a
   face, never a location. The prompt below is the whole payload.
   ==========================================================================*/

const Summary = {
  OLLAMA: 'http://localhost:11434',
  OLLAMA_MODEL: 'llama3.2',       // any pulled model works; small is fine here
  TIMEOUT_MS: 6000,

  _ollamaOk: null,                 // cached probe result

  /* ------------------------------------------------------------- routing */

  async route() {
    if (await this.ollamaAvailable()) return 'ollama';
    if (typeof MaaS !== 'undefined' && MaaS.available) return 'maas';
    return 'template';
  },

  async ollamaAvailable() {
    if (this._ollamaOk !== null) return this._ollamaOk;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1200);
      const r = await fetch(this.OLLAMA + '/api/tags', { signal: ctrl.signal });
      clearTimeout(t);
      this._ollamaOk = r.ok;
    } catch (_) {
      this._ollamaOk = false;
    }
    return this._ollamaOk;
  },

  /* -------------------------------------------------------------- facts */

  /** Everything the summary is allowed to know. Counts and confirmed text. */
  gather(date = new Date()) {
    const midnight = new Date(date); midnight.setHours(0, 0, 0, 0);
    const from = midnight.getTime();
    const ev = Store.s.events.filter(e => e.ts >= from);
    const n = t => ev.filter(e => e.type === t).length;

    const people = [...new Set(ev.filter(e => e.personId).map(e => e.personId))]
      .map(id => (Store.person(id) || {}).name).filter(Boolean);

    const planDone = Store.s.plan.filter(p => Store.planDoneToday(p));
    const planMissed = Store.s.plan.filter(p => !Store.planDoneToday(p));
    const facts = Store.keptFacts().filter(f => f.ts >= from).map(f => f.text);

    const sig = CTI.signals();
    const sun = Behaviour.sundowning(7);

    return {
      name: Store.s.patient.name,
      date: midnight.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
      wearHours: +(Store.wearMsToday() / 3600000).toFixed(1),
      peopleSeen: people,
      recognisedUnaided: sig.raw.unaided,
      neededHelp: sig.raw.assisted + sig.raw.missed,
      askedAgain: n(EV.TELL_AGAIN),
      lostTheThread: n(EV.THREAD_HELD),
      lookedForThings: n(EV.OBJ_ASK),
      medsConfirmed: n(EV.MED_OK),
      medsTotal: Store.s.meds.length,
      planDone: planDone.map(p => p.title),
      planMissed: planMissed.map(p => p.title),
      newThings: facts,
      leftSafeZone: n(EV.GEO_LEFT),
      poweredDown: n(EV.IDLE_OFF),
      sundownPattern: sun.flagged ? sun.share : null,
    };
  },

  /* ------------------------------------------------------------ writing */

  async write(date = new Date()) {
    const d = this.gather(date);
    const route = await this.route();
    let text, model = null;

    try {
      if (route === 'ollama') {
        text = await this._ollama(d);
        model = 'Ollama · ' + this.OLLAMA_MODEL;
      } else if (route === 'maas') {
        text = await MaaS.weeklySummary(d);
        model = 'Huawei Cloud MaaS · ' + MaaS.CONFIG.model;
      }
    } catch (e) {
      console.warn('summary: model failed, using the template', e);
      text = null;
    }

    if (!text) { text = this.template(d); model = model || 'written locally'; }
    return { text, model, route: text === this.template(d) ? 'template' : route, data: d };
  },

  async _ollama(d, system = SYSTEM, predict = 220) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.TIMEOUT_MS);
    try {
      const r = await fetch(this.OLLAMA + '/api/generate', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.OLLAMA_MODEL,
          system,
          prompt: JSON.stringify(d),
          stream: false,
          options: { temperature: 0.3, num_predict: predict },
        }),
      });
      if (!r.ok) throw new Error('ollama ' + r.status);
      const j = await r.json();
      return (j.response || '').trim() || null;
    } finally { clearTimeout(t); }
  },

  /**
   * The offline version. Written carefully enough to stand on its own, because
   * most days it is what the family will actually read.
   */
  template(d) {
    const s = [];

    s.push(`${d.name} wore his glasses for about ${d.wearHours} hours today.`);

    if (d.peopleSeen.length === 1) s.push(`He spent time with ${d.peopleSeen[0]}.`);
    else if (d.peopleSeen.length > 1) {
      const last = d.peopleSeen[d.peopleSeen.length - 1];
      s.push(`He saw ${d.peopleSeen.slice(0, -1).join(', ')} and ${last}.`);
    } else s.push(`Nobody came by that the glasses recognised.`);

    const tested = d.recognisedUnaided + d.neededHelp;
    if (tested) {
      s.push(d.neededHelp === 0
        ? `He put a name to everyone himself.`
        : `He remembered ${d.recognisedUnaided} of ${tested} names on his own, and needed a hand with the rest.`);
    }

    if (d.askedAgain >= 3) s.push(`He asked to hear things again ${d.askedAgain} times.`);
    if (d.lostTheThread >= 2) s.push(`He lost the thread of a conversation ${d.lostTheThread} times.`);

    if (d.medsTotal) {
      s.push(d.medsConfirmed >= d.medsTotal
        ? `All his medication was confirmed.`
        : `${d.medsConfirmed} of ${d.medsTotal} doses were confirmed.`);
    }

    if (d.planDone.length) s.push(`He got to ${this._list(d.planDone)}.`);
    if (d.planMissed.length && d.planMissed.length <= 2) s.push(`${this._list(d.planMissed)} did not happen.`);

    if (d.newThings.length) s.push(`Worth remembering: ${d.newThings[0].replace(/\.?$/, '.')}`);
    if (d.leftSafeZone) s.push(`He went out of the area around home ${d.leftSafeZone === 1 ? 'once' : d.leftSafeZone + ' times'}.`);

    if (d.sundownPattern) {
      s.push(`Most of his difficult moments this week have been in the late afternoon — worth mentioning at his next appointment.`);
    }

    return s.join(' ');
  },

  /** For plan items and other sentence-case titles. */
  _list(a) {
    if (a.length === 1) return a[0].toLowerCase();
    return a.slice(0, -1).map(x => x.toLowerCase()).join(', ') + ' and ' + a[a.length - 1].toLowerCase();
  },

  /** For topics. Lowercasing these turns "Wei Jie" into "wei jie". */
  _listRaw(a) {
    if (!a.length) return '';
    if (a.length === 1) return a[0];
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  },

  /* ==========================================================================
     PER-CONVERSATION SUMMARY

     Two sentences describing one visit, written when the conversation ends and
     stored against everyone who was in it. This is what makes the vault
     browsable — "the 12th of July, with Mei Ling" has to say something.

     THE RULE ABOUT WHAT THE MODEL SEES

     The rolling buffer exists in memory during a conversation and is destroyed
     when it ends. It is the richest thing available, and it is also the one
     thing we have promised never to store or transmit. So:

       - A model running ON THIS MACHINE (Ollama, open weights, localhost) may
         see the buffer. Nothing leaves the flat, and only the two sentences it
         writes are kept.
       - A model running ANYWHERE ELSE — including Huawei Cloud, including our
         own future servers — sees only the topics and the facts a human has
         already read and approved.

     That distinction is not a technicality. "Your conversation never leaves
     the house" is either true or it is marketing, and the only way to keep it
     true is to make the code refuse.

     Either way what is STORED is the same: two sentences, capped, derived.
     ========================================================================*/

  MAX_SUMMARY_WORDS: 45,

  async conversation(session, { topics = [], facts = [], buffer = null } = {}) {
    const names = (session.people || [])
      .map(id => (Store.person(id) || {}).name).filter(Boolean);
    const minutes = Math.max(1, Math.round(
      ((session.lastHeard || Date.now()) - (session.started || Date.now())) / 60000));

    const payload = {
      who: names.join(' and ') || 'someone',
      minutes,
      topics: topics.map(t => t.word || t).slice(0, 6),
      confirmed: facts.map(f => f.text || f).slice(0, 5),
      // Context from previous visits, so the summary can say "again" — which
      // is exactly the kind of thing a person notices and a log does not.
      knownAlready: names.length === 1 && Store.person(session.people[0])
        ? Vault.promptContext(Store.person(session.people[0]), 3) : '',
    };

    const route = await this.route();
    let text = null, model = null;

    try {
      if (route === 'ollama') {
        // On-device only: the buffer may be included.
        const local = { ...payload };
        if (buffer && buffer.length) {
          local.heard = buffer.slice(-40).map(b => b.text);
          local.NOTE = 'The heard lines are in memory only and are being destroyed now. '
                     + 'Do not quote them. Describe what the conversation was about.';
        }
        text = await this._ollama(local, CONVO_SYSTEM, 90);
        model = 'Ollama · ' + this.OLLAMA_MODEL + (local.heard ? ' (on-device)' : '');
      } else if (route === 'maas' && typeof MaaS !== 'undefined' && MaaS.conversationSummary) {
        // Off-device: topics and confirmed facts only. Never the buffer.
        text = await MaaS.conversationSummary(payload);
        model = 'Huawei Cloud MaaS · ' + MaaS.CONFIG.model;
      }
    } catch (e) {
      console.warn('summary: conversation model failed, writing it locally', e);
      text = null;
    }

    if (!text) { text = this.conversationTemplate(payload); model = 'written locally'; }
    return { text: this._cap(text), model, payload };
  },

  /** A stored summary is two sentences. Anything longer is a transcript. */
  _cap(text) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    const sentences = t.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
    const words = sentences.split(/\s+/);
    return words.length <= this.MAX_SUMMARY_WORDS
      ? sentences
      : words.slice(0, this.MAX_SUMMARY_WORDS).join(' ').replace(/[,;:]$/, '') + '…';
  },

  conversationTemplate(p) {
    const s = [];
    s.push(`${p.who} was here for about ${p.minutes} minute${p.minutes === 1 ? '' : 's'}.`);
    if (p.confirmed.length) s.push(`They talked about ${p.confirmed[0].replace(/\.?$/, '').toLowerCase()}.`);
    else if (p.topics.length) s.push(`Mostly about ${this._listRaw(p.topics)}.`);
    return s.join(' ');
  },

  /* ==========================================================================
     PER-PERSON SUMMARY ACROSS TIME

     "How have things been with Mei Ling lately?" — read off the stored
     conversation records, not off anything new. Weeks, not one day.
     ========================================================================*/
  async person(personId, days = 30) {
    const p = Store.person(personId);
    if (!p) return null;
    const days_ = Vault.timeline(personId, days);
    const sessions = days_.flatMap(d => d.sessions);
    const payload = {
      who: p.name,
      relation: p.relation || '',
      days,
      conversations: sessions.length,
      minutes: sessions.reduce((n, s) => n + s.durationMin, 0),
      topics: [...new Set(sessions.flatMap(s => s.topics))].slice(0, 8),
      moments: sessions.flatMap(s => s.facts.map(f => f.text)).slice(0, 8),
      lastSeen: sessions[0] ? Vault._dayLabel(sessions[0].day) : null,
    };
    if (!sessions.length) {
      return { text: `No conversations with ${p.name} in the last ${days} days.`,
               model: 'written locally', payload };
    }

    const route = await this.route();
    let text = null, model = null;
    try {
      if (route === 'ollama') {
        text = await this._ollama(payload, PERSON_SYSTEM, 130);
        model = 'Ollama · ' + this.OLLAMA_MODEL;
      } else if (route === 'maas' && typeof MaaS !== 'undefined' && MaaS.personSummary) {
        text = await MaaS.personSummary(payload);
        model = 'Huawei Cloud MaaS · ' + MaaS.CONFIG.model;
      }
    } catch (e) { text = null; }

    if (!text) { text = this.personTemplate(payload); model = 'written locally'; }
    return { text, model, payload };
  },

  personTemplate(p) {
    const s = [];
    s.push(`${p.who} has been over ${p.conversations} time${p.conversations === 1 ? '' : 's'} `
         + `in the last ${p.days} days, about ${p.minutes} minutes altogether.`);
    if (p.topics.length) s.push(`They keep coming back to ${this._listRaw(p.topics.slice(0, 3))}.`);
    if (p.moments.length) s.push(`Things worth keeping from those visits: ${p.moments.slice(0, 2).join('; ')}.`);
    if (p.lastSeen) s.push(`Last time was ${p.lastSeen.toLowerCase()}.`);
    return s.join(' ');
  },
};

const SYSTEM = `You write a short evening note to the family of an older person with
early-stage dementia. You are given only counts and a few short facts — never a
transcript.

Rules:
- Four to six sentences. Plain English. No headings, no bullet points, no emoji.
- Use his name. Write about him as a person, not a patient or a data set.
- Never use the words dementia, decline, deterioration, patient, sufferer or symptom.
- Do not diagnose, do not predict, do not give medical advice.
- If something went less well, say it plainly and without alarm, and suggest
  mentioning it at his next appointment rather than acting tonight.
- End on the most human thing in the data, not the most clinical.
- Return the note only.`;

const CONVO_SYSTEM = `You write ONE OR TWO SENTENCES describing a visit that has just
ended, for a family to read weeks later. You may be given the lines that were
heard; they are in memory only and are being deleted as you read them.

Rules:
- Two sentences maximum. Under 40 words. No headings, no bullets, no emoji.
- Describe what the visit was ABOUT. Do not quote anyone.
- Never write anything you were told only in the heard lines that a family
  member has not confirmed. If in doubt, stay general.
- Warm and plain, the way you would tell a friend how an afternoon went.
- No diagnosis, no assessment of how he coped, no clinical words.
- Return the sentences only.`;

const PERSON_SYSTEM = `You write three or four sentences about how one person's
visits have been going over the last few weeks, for the family to read. You are
given counts, topics and short confirmed facts — never a transcript.

Rules:
- Three or four sentences. Plain English. No headings, no bullets, no emoji.
- Write about a relationship, not a data set.
- Never use the words dementia, decline, deterioration, patient or symptom.
- No diagnosis, no prediction, no medical advice.
- If they have been coming less often, say so gently and without alarm.
- Return the note only.`;

window.Summary = Summary;
