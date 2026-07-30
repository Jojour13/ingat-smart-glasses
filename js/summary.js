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

  async _ollama(d) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.TIMEOUT_MS);
    try {
      const r = await fetch(this.OLLAMA + '/api/generate', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.OLLAMA_MODEL,
          system: SYSTEM,
          prompt: JSON.stringify(d),
          stream: false,
          options: { temperature: 0.3, num_predict: 220 },
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

  _list(a) {
    if (a.length === 1) return a[0].toLowerCase();
    return a.slice(0, -1).map(x => x.toLowerCase()).join(', ') + ' and ' + a[a.length - 1].toLowerCase();
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

window.Summary = Summary;
