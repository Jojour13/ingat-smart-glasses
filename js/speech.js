/* ============================================================================
   speech.js — the audio channel
   This is the ONLY output channel to the wearer. There is no screen.

   Presbycusis note: age-related hearing loss removes energy above ~2 kHz,
   which is where consonants live, so a default TTS voice is audible but not
   intelligible to a 71-year-old in a hawker centre. What we can do in a
   browser is slow the rate and pick the clearest available voice. The
   audiogram-shaped EQ and consonant emphasis described in the hardware spec
   are firmware-level and are NOT simulated here — see README, "honest limits".
   ==========================================================================*/

const Speech = {
  voices: [],
  ready: false,
  onSay: null,          // hook so the UI can caption what he hears
  _lastUtterance: null,

  init() {
    if (!('speechSynthesis' in window)) {
      console.warn('speech: Web Speech API unavailable');
      return;
    }
    const load = () => {
      this.voices = speechSynthesis.getVoices();
      this.ready = this.voices.length > 0;
    };
    load();
    speechSynthesis.onvoiceschanged = load;
  },

  /** Best available voice for a BCP-47 tag, with sensible fallbacks. */
  pick(lang) {
    if (!this.voices.length) this.voices = speechSynthesis.getVoices();
    const want = lang.toLowerCase();
    const base = want.split('-')[0];
    // exact -> same language, any region -> anything
    return this.voices.find(v => v.lang.toLowerCase() === want)
        || this.voices.find(v => v.lang.toLowerCase().startsWith(base))
        || this.voices.find(v => v.default)
        || this.voices[0]
        || null;
  },

  /**
   * Speak into the wearer's ear.
   * @param {string} text
   * @param {object} o  { lang, rate, interrupt, tag }
   * @returns {Promise<void>} resolves when the utterance ends
   */
  say(text, o = {}) {
    const lang = o.lang || Store.s.patient.language || 'en-SG';
    const rate = o.rate ?? Store.s.patient.speechRate ?? 0.82;

    if (this.onSay) this.onSay(text, { lang, tag: o.tag });

    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) return resolve();
      if (o.interrupt !== false) speechSynthesis.cancel();

      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;         // slower for presbycusis
      u.pitch = 0.95;        // marginally lower; moves energy into audible band
      u.volume = 1;
      const v = this.pick(lang);
      if (v) u.voice = v;

      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      // Chrome occasionally drops onend; guarantee resolution.
      setTimeout(finish, Math.min(1200 + text.length * 90, 12000));

      this._lastUtterance = u;
      speechSynthesis.speak(u);
    });
  },

  /**
   * Speak a person's prompt — using the family's own recording if one exists.
   * A familiar voice is recognised faster than a synthetic one, is harder to
   * ignore, and is calming rather than clinical. Falls back to TTS silently.
   */
  async sayAs(personId, text, o = {}) {
    const clip = personId && Store.s.voices ? Store.s.voices[personId] : null;
    if (!clip) return this.say(text, o);

    if (this.onSay) this.onSay(text, { ...o, lang: 'recorded', tag: (o.tag || '') + ' · real voice' });
    return new Promise(resolve => {
      try {
        const a = this._audio = this._audio || new Audio();
        a.src = clip;
        let done = false;
        const fin = () => { if (!done) { done = true; resolve(); } };
        a.onended = fin;
        a.onerror = () => { this.say(text, o).then(fin); };
        a.play().catch(() => { this.say(text, o).then(fin); });
        setTimeout(fin, 15000);
      } catch (e) { this.say(text, o).then(resolve); }
    });
  },

  /** Non-verbal attention tone — the stage-2 cue. Nothing is spoken. */
  chime() {
    if (this.onSay) this.onSay('( soft chime )', { tag: 'chime' });
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this._ctx = this._ctx || new Ctx();
      const ctx = this._ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      // Two soft partials, ~1 kHz — inside the audible band for presbycusis,
      // short enough not to mask the conversation he is already in.
      [988, 1319].forEach((f, i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        g.gain.setValueAtTime(0, t + i * 0.09);
        g.gain.linearRampToValueAtTime(0.16, t + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.32);
        osc.connect(g).connect(ctx.destination);
        osc.start(t + i * 0.09);
        osc.stop(t + i * 0.09 + 0.36);
      });
    } catch (e) { console.warn('chime failed', e); }
  },

  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },
};

/* ============================================================================
   Listener — how we know he retrieved the name unaided.

   This is the product mechanism, not a demo shortcut: the wearer says the
   name out loud ("Ah, Mei Ling!"), and that IS the retrieval event. It is
   exactly what the inward-facing microphone in the hardware spec exists for.

   Browser ASR is imperfect and in Chrome it needs network, so every listen()
   also resolves on a manual operator confirmation. The demo never depends on
   the speech recogniser working.
   ==========================================================================*/
const Listener = {
  supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  _rec: null,
  _active: null,

  /**
   * Listen for one of `targets` for `ms`.
   * @returns {Promise<{hit:boolean, via:string, heard:string, ms:number}>}
   */
  listen(targets, ms, lang = 'en-SG') {
    const t0 = performance.now();
    const norm = s => (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const wants = targets.map(norm).filter(Boolean);

    return new Promise(resolve => {
      let settled = false;
      const done = (hit, via, heard = '') => {
        if (settled) return;
        settled = true;
        this._active = null;
        try { this._rec && this._rec.stop(); } catch (_) {}
        window.removeEventListener('ingat:confirm', onConfirm);
        resolve({ hit, via, heard, ms: Math.round(performance.now() - t0) });
      };

      // manual path — operator confirmation, or the wearer's tap
      const onConfirm = e => done(e.detail === 'yes', 'manual');
      window.addEventListener('ingat:confirm', onConfirm);
      this._active = done;

      // ASR path
      if (this.supported) {
        try {
          const R = window.SpeechRecognition || window.webkitSpeechRecognition;
          const r = new R();
          this._rec = r;
          r.lang = lang;
          r.interimResults = true;
          r.continuous = true;
          r.onresult = ev => {
            let heard = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              heard += ev.results[i][0].transcript + ' ';
            }
            const h = norm(heard);
            if (h && wants.some(w => h.includes(w))) done(true, 'speech', h);
          };
          r.onerror = () => {};   // fall through to timeout / manual
          r.start();
        } catch (e) { /* no ASR: manual + timeout still work */ }
      }

      setTimeout(() => done(false, 'timeout'), ms);
    });
  },

  /** Fire from the UI: the wearer produced the name (or tapped for help). */
  confirm(yes) {
    window.dispatchEvent(new CustomEvent('ingat:confirm', { detail: yes ? 'yes' : 'no' }));
  },

  get busy() { return !!this._active; },
};

window.Speech = Speech;
window.Listener = Listener;
