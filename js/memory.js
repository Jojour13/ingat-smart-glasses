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

  /* ==========================================================================
     ONE CONVERSATION PER PERSON

     Grandpa talks to his granddaughter. She goes to make tea. His grandson
     comes in. Then she comes back.

     A single shared buffer gets this wrong in the worst way: the moment the
     grandson appeared, her conversation was thrown away, and when she returned
     the thread was gone. Both of them then look like one incoherent
     conversation to the fact extractor.

     So each person gets their own session. Switching people PARKS the current
     one instead of wiping it — she can walk out and come back and the thread
     survives. Sessions only end when they go quiet for a while, and only then
     do they give up their facts.

     Two enrolled people in view at once is a group conversation, keyed on the
     set of them, because a fact from that conversation belongs to both.
     ========================================================================*/
  SESSION_IDLE_MS: 12 * 60 * 1000,   // silence that ends a conversation
  _sessions: new Map(),              // key -> { people[], buf[], started, lastHeard }
  _activeKey: null,
  _rec: null,
  _idleTimer: null,
  _sweeper: null,

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
  /** Stable key for one person, or for a group seen together. */
  _key(ids) { return [...ids].sort().join('+'); },

  get _active() { return this._activeKey ? this._sessions.get(this._activeKey) : null; },
  get _buf() { return this._active ? this._active.buf : []; },
  get activePersonId() {
    const s = this._active;
    return s && s.people.length === 1 ? s.people[0] : null;
  },
  get activePeople() { return this._active ? this._active.people.slice() : []; },

  /**
   * These people are in view now.
   * @param {string|string[]} who  one person, or everyone currently visible
   */
  start(who) {
    const ids = (Array.isArray(who) ? who : [who]).filter(Boolean);
    if (!ids.length || !this.permitted || !this.supported) return false;
    const key = this._key(ids);

    if (this.listening && this._activeKey === key) { this._touch(); return true; }

    // Park, do not destroy. She may be back in two minutes.
    this._activeKey = key;
    if (!this._sessions.has(key)) {
      this._sessions.set(key, { people: ids, buf: [], started: Date.now(), lastHeard: Date.now() });
    }
    if (!this._sweeper) this._sweeper = setInterval(() => this.sweep(), 30000);

    if (this._rec) { try { this._rec.stop(); } catch (_) {} this._rec = null; }

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
      this.onState && this.onState(true, ids.length === 1 ? ids[0] : ids);
      return true;
    } catch (e) {
      console.warn('memory: could not start listening', e);
      this.listening = false;
      return false;
    }
  },

  /**
   * End the ACTIVE conversation. Harvests its facts, then destroys its buffer.
   * @param {boolean} propose
   */
  stop(propose = true) {
    clearTimeout(this._idleTimer);
    if (this._rec) { try { this._rec.stop(); } catch (_) {} this._rec = null; }
    this.listening = false;

    const key = this._activeKey;
    let facts = null;
    if (key) facts = this._close(key, propose);
    this._activeKey = null;
    this.onState && this.onState(false, null);
    return facts;
  },

  /** Close one session by key. Harvest, record the visit, then wipe. */
  _close(key, propose = true) {
    const s = this._sessions.get(key);
    if (!s) return null;
    let facts = null;
    if (propose && s.buf.length) facts = this._propose(s);
    if (typeof Vault !== 'undefined') Vault.recordVisit(s);
    s.buf.length = 0;                  // explicit destruction
    this._sessions.delete(key);
    return facts;
  },

  /** End every conversation that has gone quiet. Runs on a timer. */
  sweep() {
    const now = Date.now();
    [...this._sessions.entries()].forEach(([key, s]) => {
      if (key === this._activeKey) return;         // parked, not finished
      if (now - s.lastHeard < this.SESSION_IDLE_MS) return;
      const facts = this._close(key, true);
      if (facts && facts.length) this.onPropose && this.onPropose(facts);
    });
    if (!this._sessions.size && this._sweeper) {
      clearInterval(this._sweeper); this._sweeper = null;
    }
  },

  /** Destroy everything currently held, across every conversation. */
  wipeAll() {
    this._sessions.forEach(s => { s.buf.length = 0; });
    this._sessions.clear();
    this._activeKey = null;
    this.listening = false;
    if (this._sweeper) { clearInterval(this._sweeper); this._sweeper = null; }
    if (this._rec) { try { this._rec.stop(); } catch (_) {} this._rec = null; }
    this.onState && this.onState(false, null);
  },

  _wipe() { const s = this._active; if (s) s.buf.length = 0; },

  _push(text) {
    const t = (text || '').trim();
    if (!t) return;
    const s = this._active;
    if (!s) return;
    s.buf.push({ ts: Date.now(), text: t });
    s.lastHeard = Date.now();
    this._prune();
    this._touch();
  },

  /** Every buffer is a moving six-minute window. Older speech simply ceases. */
  _prune() {
    const cutoff = Date.now() - this.BUFFER_MS;
    this._sessions.forEach(s => {
      while (s.buf.length && s.buf[0].ts < cutoff) s.buf.shift();
      let chars = s.buf.reduce((n, b) => n + b.text.length, 0);
      while (chars > this.MAX_CHARS && s.buf.length > 1) chars -= s.buf.shift().text.length;
    });
  },

  /** A long silence in the ACTIVE conversation ends it. */
  _touch() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      const facts = this.stop(true);
      if (facts && facts.length) this.onPropose && this.onPropose(facts);
    }, 120000);
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
  _propose(session) {
    const people = session.people || [];
    const personId = people.length === 1 ? people[0] : null;
    const names = people.map(id => (Store.person(id) || {}).name).filter(Boolean);
    // Pass the FRAGMENTS, not one joined string. Speech recognisers rarely
    // emit punctuation, so joining first produces a single run-on "sentence"
    // that is the entire conversation — which would then be stored verbatim
    // as the "fact". Each isFinal result is a natural utterance boundary.
    const picked = this._pickSentences(session.buf.map(b => b.text), this.MAX_FACTS);
    // Topics feed the person's vault whether or not any fact survives — what
    // they talk about is worth knowing even when nothing quotable was said.
    if (typeof Vault !== 'undefined') {
      Vault.learnTopics(people, this._topics(session.buf.map(b => b.text)));
    }
    if (!picked.length) return null;

    const made = [];
    picked.forEach(sentence => {
      const text = this._tidy(sentence);
      if (this._alreadyKnown(text)) return;      // she tells him every week
      made.push(Store.proposeFact({
        text,
        who: names.join(' and '),
        personId: personId || null,
        people,
      }));
    });
    if (!made.length) return null;
    this.onPropose && this.onPropose(made);
    return made;
  },

  /** Every recurring content word, not just the single top one. */
  _topics(lines) {
    const counts = new Map();
    lines.forEach(l => this._contentWords(l).forEach(w => counts.set(w, (counts.get(w) || 0) + 1)));
    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([word, n]) => ({ word, n }));
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

  /* ==========================================================================
     HOLDING THE THREAD — the live half of conversation memory

     Everything above is about AFTER a conversation. This is about DURING one.

     Losing the thread mid-sentence is one of the most humiliating symptoms of
     early dementia. You are talking to your son, you stop, and the sentence is
     simply gone — along with what you were both talking about thirty seconds
     ago. The usual repair is to ask him, which makes the lapse public, so most
     people just fall silent instead. That withdrawal is how conversation stops
     being worth the risk, and it is a large part of how social isolation
     actually begins.

     A device can repair this privately. He taps once and hears, in his ear
     only, what the conversation is about and what he was saying. Nobody else
     in the room knows it happened.

     This runs off the SAME buffer as fact extraction — nothing extra is
     captured, nothing extra is stored, and the buffer is still destroyed when
     the conversation ends.
     ========================================================================*/

  /** The gist of the current conversation: topic, plus his last thought. */
  thread() {
    this._prune();
    const s = this._active;
    if (!s || !s.buf.length) return null;
    const recent = s.buf.slice(-8).map(b => b.text);
    const names = s.people.map(id => (Store.person(id) || {}).name).filter(Boolean);
    return {
      topic: this._topic(recent),
      lastSaid: this._lastSubstantive(recent),
      person: names.join(' and ') || null,
      fragments: s.buf.length,
      people: s.people.slice(),
    };
  },

  /** Every conversation currently open, for the UI. */
  openSessions() {
    this._prune();
    return [...this._sessions.entries()].map(([key, s]) => ({
      key,
      active: key === this._activeKey,
      names: s.people.map(id => (Store.person(id) || {}).name).filter(Boolean),
      fragments: s.buf.length,
      quietMs: Date.now() - s.lastHeard,
      startedMs: Date.now() - s.started,
    }));
  },

  /**
   * "What were we talking about?" — spoken into his ear, mid-conversation.
   * Deliberately short. He is standing in front of someone waiting for him to
   * finish a sentence; a paragraph would be worse than silence.
   */
  async remindThread() {
    const t = this.thread();
    const lang = Store.s.patient.language;
    if (!t || (!t.topic && !t.lastSaid)) {
      await Speech.say('I did not catch the last part.', { lang, tag: 'thread' });
      return null;
    }
    const bits = [];
    const topic = this._article(t.topic);
    if (t.person && topic) bits.push(`You and ${t.person} are talking about ${topic}.`);
    else if (topic) bits.push(`You are talking about ${topic}.`);
    if (t.lastSaid) bits.push(`You were saying: ${t.lastSaid}.`);
    const text = bits.join(' ');
    // Log THAT it happened, never WHAT was said. The event log is persisted
    // and exported; putting the reconstructed sentence in it would write his
    // conversation to disk through the back door, which is precisely what the
    // rest of this file exists to prevent. How often he loses the thread is
    // the clinical signal. What he was saying is nobody's business.
    Store.log(EV.THREAD_HELD);
    await Speech.say(text, { lang, tag: 'thread' });
    return t;
  },

  /**
   * "about roof" is what a machine says. "about the roof" is what a person
   * says, and this is going into the ear of someone who is already unsure
   * whether he is following the conversation — it has to sound like a person.
   */
  _article(topic) {
    if (!topic) return null;
    if (/^(the|a|an|his|her|your|my|our|their)\b/i.test(topic)) return topic;
    if (/\band\b/.test(topic)) return topic;          // "roof and contractor"
    if (/^[A-Z]/.test(topic)) return topic;           // a name
    return 'the ' + topic;
  },

  /** The noun the conversation keeps returning to. */
  _topic(lines) {
    const counts = new Map();
    lines.forEach(l => this._contentWords(l).forEach(w => {
      counts.set(w, (counts.get(w) || 0) + 1);
    }));
    if (!counts.size) return null;
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    // A word said once is not a topic; it is just a word.
    const top = ranked.filter(([, n]) => n >= 2).slice(0, 2).map(([w]) => w);
    if (!top.length) return ranked.length ? ranked[0][0] : null;
    return top.join(' and ');
  },

  /** His last remark that carried any content, trimmed to something sayable. */
  _lastSubstantive(lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const words = lines[i].trim().split(/\s+/);
      if (words.length < 4) continue;                   // "mm", "yes", "I see"
      if (this._contentWords(lines[i]).length < 2) continue;
      return this._trimToClause(lines[i].trim());
    }
    return null;
  },

  /** For the UI: how much is being held right now, and for how long. */
  bufferState() {
    this._prune();
    const s = this._active;
    const buf = s ? s.buf : [];
    const names = s ? s.people.map(id => (Store.person(id) || {}).name).filter(Boolean) : [];
    return {
      fragments: buf.length,
      chars: buf.reduce((n, b) => n + b.text.length, 0),
      oldestMs: buf.length ? Date.now() - buf[0].ts : 0,
      listening: this.listening,
      person: names.join(' and ') || null,
      openConversations: this._sessions.size,
    };
  },
};

window.Memory = Memory;
