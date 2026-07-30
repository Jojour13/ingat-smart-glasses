/* ============================================================================
   maas.js — Huawei Cloud MaaS (Model-as-a-Service), Singapore region

   Huawei Cloud launched its token service in Singapore on 10 April 2026 with
   GLM (including GLM-5), DeepSeek and Qwen. Two jobs here:

     1. Turn a structured memory record into the sentence the wearer hears.
     2. Write the caregiver's weekly summary paragraph.

   WHY IN-REGION MATTERS: inference stays in Singapore. That is the technical
   backing for the data-residency line on the privacy slide, and it is why
   "we use Huawei technology" is a fact rather than a logo.

   HONEST STATUS: this is written against the endpoint but ships WITHOUT
   credentials. Every call falls back to a local template, and the demo runs
   on the fallback on purpose — a live API call is one more thing that can fail
   on stage. Put the console screenshot in the deck; run the demo on cache.

   To go live:
     1. Create a Huawei Cloud account, enable ModelArts Studio / MaaS,
        choose the ap-southeast-3 (Singapore) region.
     2. Create an API key for the model you want.
     3. Set CONFIG below. Never commit a real key.
   ==========================================================================*/

const MaaS = {
  CONFIG: {
    enabled: false,                                   // flip to true once keyed
    endpoint: 'https://api.modelarts-maas.com/v1/chat/completions',
    region: 'ap-southeast-3',                         // Singapore
    model: 'glm-5',                                   // or deepseek-*, qwen-*
    apiKey: '',                                       // inject at runtime, do not commit
    timeoutMs: 3500,
  },

  _cache: new Map(),

  get available() { return this.CONFIG.enabled && !!this.CONFIG.apiKey; },

  /* ------------------------------------------------------- prompt writing */
  /**
   * Phrase the greeting the wearer hears.
   * @param {object} person {name, relation, memory}
   * @param {object} o      {lang, stage, verbosity}
   */
  async phrase(person, o = {}) {
    const key = `p:${person.id}:${o.lang}:${o.stage}`;
    if (this._cache.has(key)) return this._cache.get(key);

    const out = this.available
      ? await this._chat([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({
              task: 'greeting',
              language: o.lang || 'en-SG',
              cue_stage: o.stage ?? 0,
              person: { name: person.name, relation: person.relation, memory: person.memory },
            }) },
        ]).catch(() => null) || this._phraseLocal(person, o)
      : this._phraseLocal(person, o);

    this._cache.set(key, out);
    return out;
  },

  /** Template fallback — deliberately identical in shape to the model output. */
  _phraseLocal(person, o = {}) {
    const bits = [person.name];
    if (person.relation) bits.push(person.relation);
    let s = bits.join('. ') + '.';
    if (person.memory && (o.verbosity ?? 1) > 0) s += ' ' + person.memory.replace(/\.?$/, '.');
    return s;
  },

  /* ------------------------------------------------------ weekly summary */
  async weeklySummary(payload) {
    if (!this.available) return this._summaryLocal(payload);
    return await this._chat([
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ]).catch(() => this._summaryLocal(payload));
  },

  _summaryLocal(d) {
    const dir = d.delta < -2 ? 'down' : d.delta > 2 ? 'up' : 'steady';
    const parts = [];
    parts.push(`This week ${d.name} wore the glasses ${d.wearHours} hours a day on average.`);
    if (d.tested) {
      parts.push(`He recognised ${d.unaidedPct}% of familiar faces without help (${d.unaided} of ${d.tested}), averaging ${d.meanLatency}ms.`);
    }
    if (d.hardest) parts.push(`${d.hardest} needed the most prompting.`);
    parts.push(dir === 'down'
      ? `The index is ${Math.abs(d.delta)} points lower than his recent average — worth mentioning at the next review.`
      : dir === 'up'
        ? `The index is ${d.delta} points above his recent average.`
        : `The index is steady, within normal week-to-week variation.`);
    return parts.join(' ');
  },

  /* ---------------------------------------------------------- transport */
  async _chat(messages) {
    const c = this.CONFIG;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), c.timeoutMs);
    try {
      const r = await fetch(c.endpoint, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + c.apiKey,
        },
        body: JSON.stringify({
          model: c.model,
          messages,
          temperature: 0.3,        // low: this text is read to a vulnerable user
          max_tokens: 220,
        }),
      });
      if (!r.ok) throw new Error('MaaS ' + r.status);
      const j = await r.json();
      const txt = j?.choices?.[0]?.message?.content?.trim();
      if (!txt) throw new Error('empty completion');
      return txt;
    } finally {
      clearTimeout(t);
    }
  },
};

const SYSTEM_PROMPT = `You write one short spoken line for smart glasses worn by an
elderly person with early-stage dementia. It is heard, never read.

Rules:
- Two short sentences maximum. Under 18 words.
- Name first, then relationship, then one concrete shared memory.
- Plain everyday words. No medical language. Never mention dementia or memory loss.
- Warm but not sentimental. Never patronising. Never a question.
- If cue_stage is 1, output ONLY the first name truncated to a hint plus an ellipsis.
- If cue_stage is 2, output an empty string.
- Reply in the requested language. Return the line only, no quotes, no preamble.`;

const SUMMARY_PROMPT = `You write a four-sentence weekly summary for the family
caregiver of an elderly person with early-stage dementia.

Rules:
- Plain English. No jargon, no percentages the reader cannot act on.
- State what changed, not what it means clinically. You are not diagnosing.
- If something declined, say so plainly and suggest raising it at the next review.
- Never use alarming language. Never speculate about prognosis.
- Four sentences. Return prose only.`;

window.MaaS = MaaS;
