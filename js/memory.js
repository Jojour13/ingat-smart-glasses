/* ============================================================================
   memory.js — episodic memory. FACTS, never transcripts.

   THE PROBLEM THIS SOLVES
   Episodic memory — memory for events — degrades before semantic memory in
   Alzheimer's. Forgetting THAT your daughter visited hurts more than
   forgetting a word. Nothing else in this product touches that.

   WHY THE OBVIOUS VERSION IS UNSHIPPABLE
   "Record his conversations so he can replay them" destroys every privacy
   claim the product makes. Under the PDPA every person in that room is a data
   subject, and almost none of them consented. A device that records the family
   is a surveillance device, whatever it is called on the box.

   WHAT THIS DOES INSTEAD
     1. Listens ONLY while an enrolled, consented person is in view. A stranger
        in the room means the microphone is not running.
     2. Holds what it hears in a rolling in-memory buffer that is never written
        to disk, never sent anywhere, and is cleared the moment the person
        leaves or the buffer ages out.
     3. Derives ONE SHORT FACT and throws the rest away.
     4. Sends that fact to the CAREGIVER to confirm or edit before it is kept.
        A machine-heard sentence is not evidence; a daughter saying "yes, that
        happened" is.
     5. The confirmed fact enters spaced retrieval, so he is asked about it at
        expanding intervals rather than simply told.

   The difference between a transcript and a fact is the difference between
   surveillance and a memory aid. He does not need the words. He needs to know
   his grandson passed.
   ==========================================================================*/

const Memory = {
  listening: false,
  activePersonId: null,
  onPropose: null,          // (fact) => void
  onState: null,            // (bool listening, personId) => void

  BUFFER_MS: 6 * 60 * 1000, // nothing older than six minutes is retained
  MAX_CHARS: 4000,

  _buf: [],                 // [{ ts, text }] — VOLATILE. Never persisted.
  _rec: null,
  _idleTimer: null,

  get supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  /** Consent gate. Conversation is its own PDPA purpose, separately revocable. */
  get permitted() {
    const c = Store.s.consent;
    return !!(c && c.purposes && c.purposes.conversation
              && c.assent.status === 'active' && c.donor.signedTs);
  },

  /**
   * An enrolled person came into view. Start listening — and ONLY now.
   * @param {string} personId
   */
  start(personId) {
    if (!this.permitted || !this.supported) return false;
    if (this.listening && this.activePersonId === personId) {
      this._touch();
      return true;
    }
    this.stop(false);
    this.activePersonId = personId;

    try {
      const R = window.SpeechRecognition || window.webkitSpeechRecognition;
      const r = new R();
      this._rec = r;
      r.lang = Store.s.patient.language || 'en-SG';
      r.continuous = true;
      r.interimResults = false;
      r.onresult = ev => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) this._push(ev.results[i][0].transcript);
        }
      };
      r.onerror = () => {};
      r.onend = () => { if (this.listening) { try { r.start(); } catch (_) {} } };
      r.start();
      this.listening = true;
      this._touch();
      this.onState && this.onState(true, personId);
      return true;
    } catch (e) {
      console.warn('memory: could not start listening', e);
      this.listening = false;
      return false;
    }
  },

  /** They left, or we are done. Propose a fact, then wipe the buffer. */
  stop(propose = true) {
    clearTimeout(this._idleTimer);
    if (this._rec) {
      this.listening = false;
      try { this._rec.stop(); } catch (_) {}
      this._rec = null;
    }
    const personId = this.activePersonId;
    let facts = null;
    if (propose && this._buf.length) facts = this._propose(personId);
    this._wipe();
    this.activePersonId = null;
    this.listening = false;
    this.onState && this.onState(false, null);
    return facts;                      // array of proposed facts, or null
  },

  /** Explicitly destroy everything heard. Called on stop, and on demand. */
  _wipe() {
    this._buf.length = 0;
  },

  _push(text) {
    const t = (text || '').trim();
    if (!t) return;
    this._buf.push({ ts: Date.now(), text: t });
    this._prune();
    this._touch();
  },

  /** The buffer is a moving six-minute window. Older speech simply ceases. */
  _prune() {
    const cutoff = Date.now() - this.BUFFER_MS;
    while (this._buf.length && this._buf[0].ts < cutoff) this._buf.shift();
    let chars = this._buf.reduce((n, b) => n + b.text.length, 0);
    while (chars > this.MAX_CHARS && this._buf.length > 1) {
      chars -= this._buf.shift().text.length;
    }
  },

  /** No speech for a while means the conversation is over. */
  _touch() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this.stop(true), 90000);
  },

  /* ------------------------------------------------------ extraction */
  /**
   * Turn the buffer into one candidate fact.
   *
   * Deliberately simple and local. An LLM would phrase this better and
   * js/maas.js is wired for it, but a heuristic that runs on-device is the
   * honest default: nothing about the conversation should need to leave the
   * machine for the feature to work.
   *
   * Whatever comes out is a PROPOSAL. It is not kept until a human says so.
   */
  MAX_FACTS: 5,     // per conversation

  /**
   * Turn the buffer into up to MAX_FACTS candidate facts.
   *
   * Not one. An hour with your daughter can easily contain five things worth
   * keeping — the grandson's exam results, that she is coming again on
   * Thursday, that the neighbour has moved out. Keeping one and destroying the
   * other four does not make the product safer, it makes it not work, and then
   * the data we did keep was collected for nothing.
   *
   * Data minimisation under the PDPA means not collecting more than the
   * purpose requires. The purpose here is episodic memory support, and one
   * sentence per visit does not serve it.
   */
  _propose(personId) {
    // Pass the FRAGMENTS, not one joined string. Speech recognisers rarely
    // emit punctuation, so joining first produces a single run-on "sentence"
    // that is the entire conversation — which would then be stored verbatim
    // as the "fact". Each isFinal result is a natural utterance boundary.
    const picked = this._pickSentences(this._buf.map(b => b.text), this.MAX_FACTS);
    if (!picked.length) return null;

    const person = personId ? Store.person(personId) : null;
    const made = [];
    picked.forEach(sentence => {
      const text = this._tidy(sentence);
      if (this._alreadyKnown(text)) return;      // she tells him every week
      made.push(Store.proposeFact({
        text,
        who: person ? person.name : '',
        personId: personId || null,
      }));
    });
    if (!made.length) return null;
    this.onPropose && this.onPropose(made);
    return made;
  },

  /**
   * Has he been told this before?
   *
   * Families repeat themselves — that is what makes them families — and
   * without this the library fills with six copies of the same news, all of
   * which then enter the practice rotation separately. Compares content words
   * rather than exact strings, because the recogniser will not transcribe it
   * identically twice.
   */
  _alreadyKnown(text) {
    const words = a => new Set(this._contentWords(a));
    const nw = words(text);
    if (!nw.size) return true;
    return Store.s.facts.some(f => {
      const ow = words(f.text);
      if (!ow.size) return false;
      let shared = 0;
      nw.forEach(w => { if (ow.has(w)) shared++; });
      return shared / Math.min(nw.size, ow.size) >= 0.6;
    });
  },

  _contentWords(s) {
    const stop = new Set(['the','a','an','and','but','or','so','then','that','this','was','were',
                          'is','are','has','have','had','his','her','your','you','my','me','him',
                          'she','he','they','we','it','of','to','in','on','at','for','with','about']);
    return (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ')
      .split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
  },

  MAX_WORDS: 16,   // a fact is one clause. Anything longer is a transcript.

  /** Back-compat single-pick wrapper. */
  _pickSentence(fragments) {
    return this._pickSentences(fragments, 1)[0] || null;
  },

  /**
   * The clauses most likely to be worth remembering, best first.
   * @param {string[]} fragments  one per final speech result
   * @param {number}   limit
   */
  _pickSentences(fragments, limit = 5) {
    const units = [];
    (fragments || []).forEach(frag => {
      // split on punctuation where the recogniser gave us any, and on the
      // conjunctions people actually speak in, so a long unpunctuated run
      // still breaks into clauses instead of surviving whole
      String(frag)
        .split(/(?<=[.!?])\s+|\s*,\s*|\s+\b(?:and then|but then|anyway|so anyway)\b\s+/i)
        .forEach(s => {
          const t = (s || '').trim();
          if (t) units.push(t);
        });
    });

    const candidates = units.filter(s => s.split(/\s+/).length >= 4 && s.length < 200);
    if (!candidates.length) return [];

    // Strong markers are things that actually happen to a family. Weak ones
    // are merely event-shaped — "came round" is a visit, but so is every
    // salesman, so it must not outrank "passed his exams".
    const STRONG = /\b(passed|born|died|married|moved|graduat\w*|won|hospital|operation|wedding|baby|birthday|exams?|engaged|retired)\b/i;
    const WEAK   = /\b(came|went|visited|got|bought|sold|started|finished|job|school|tomorrow|yesterday|sunday|monday|tuesday|wednesday|thursday|friday|saturday|next week|last week)\b/i;
    const FILLER = /\b(you know|i mean|sort of|kind of|the one|or something|anyway)\b/i;

    const scored = candidates.map(s => {
      const words = s.split(/\s+/).length;
      let score = 0;
      const strong = (s.match(new RegExp(STRONG.source, 'gi')) || []).length;
      const weak = (s.match(new RegExp(WEAK.source, 'gi')) || []).length;
      score += strong * 5;
      score += Math.min(weak, 2) * 1.5;
      if (/\b(he|she|they|your|my)\b/i.test(s)) score += 1;
      if (/\d/.test(s)) score += 1;
      if (FILLER.test(s)) score -= 2;         // conversational padding, not a fact
      if (/\?\s*$/.test(s)) score -= 4;       // questions are not facts
      // BREVITY WINS. A fact is one clause. Rewarding length is how a
      // transcript sneaks in wearing a fact's clothes.
      score -= Math.max(0, (words - 10) * 0.4);
      return { s, score };
    }).sort((a, b) => b.score - a.score);

    // Everything that clears the bar, best first, de-duplicated against each
    // other so two phrasings of the same remark do not both survive.
    const out = [];
    for (const c of scored) {
      if (c.score < 4 || out.length >= limit) break;
      const trimmed = this._trimToClause(c.s);
      const words = new Set(this._contentWords(trimmed));
      const dup = out.some(prev => {
        const pw = new Set(this._contentWords(prev));
        let shared = 0;
        words.forEach(w => { if (pw.has(w)) shared++; });
        return shared / Math.max(1, Math.min(words.size, pw.size)) >= 0.6;
      });
      if (!dup) out.push(trimmed);
    }
    return out;
  },

  /**
   * Last line of defence on length. If a clause still runs long, keep the
   * window around the event marker rather than the whole thing — the marker
   * is why we selected it.
   */
  _trimToClause(s) {
    const words = s.trim().split(/\s+/);
    if (words.length <= this.MAX_WORDS) return s.trim();
    const MARKERS = /\b(passed|born|died|married|moved|started|finished|won|got|bought|sold|visited|came|went|hospital|school|exam|birthday|wedding|baby|job|operation)\b/i;
    const at = words.findIndex(w => MARKERS.test(w));
    if (at < 0) return words.slice(0, this.MAX_WORDS).join(' ');
    const from = Math.max(0, at - 4);
    return words.slice(from, from + this.MAX_WORDS).join(' ');
  },

  _tidy(s) {
    let t = s.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  },

  /** For the UI: how much is being held right now, and for how long. */
  bufferState() {
    this._prune();
    return {
      fragments: this._buf.length,
      chars: this._buf.reduce((n, b) => n + b.text.length, 0),
      oldestMs: this._buf.length ? Date.now() - this._buf[0].ts : 0,
      listening: this.listening,
      person: this.activePersonId ? (Store.person(this.activePersonId) || {}).name : null,
    };
  },
};

window.Memory = Memory;
