# INGAT — every feature, and how to use it

This is the complete guide to the working prototype: what each page does, what
each feature is for, what is real and what is simulated, and how to drive the
whole thing in front of an audience.

If you only read one section, read **[The five-minute demo](#the-five-minute-demo)**.

---

## Contents

1. [What the product is](#1-what-the-product-is)
2. [The five surfaces](#2-the-five-surfaces)
3. [The five-minute demo](#the-five-minute-demo)
4. [Home — `index.html`](#4-home--indexhtml)
5. [Setup Studio — `family.html`](#5-setup-studio--familyhtml)
6. [Glasses — `glasses.html`](#6-glasses--glasseshtml)
7. [Memory Vault — `vault.html`](#7-memory-vault--vaulthtml)
8. [Caregiver dashboard — `care.html`](#8-caregiver-dashboard--carehtml)
9. [Trust Centre — `privacy.html`](#9-trust-centre--privacyhtml)
10. [The engines underneath](#10-the-engines-underneath)
11. [Privacy, in code rather than in policy](#11-privacy-in-code-rather-than-in-policy)
12. [What is real and what is simulated](#12-what-is-real-and-what-is-simulated)
13. [Running it](#13-running-it)
14. [Keyboard reference](#14-keyboard-reference)
15. [Known limits](#15-known-limits)

---

## 1. What the product is

Smart glasses and a companion web app for someone in the **early stage** of
dementia — the 41% of Singaporeans with dementia who still live at home, still
go out, and are alone on weekday afternoons because their daughter is at work.

The product does two things at once, and the fact that they are the same act is
the whole idea:

**It helps him.** A name in his ear when someone walks up. A reminder that his
tablet is at one o'clock. A private word about what the conversation is about
when he loses the thread. Where his wallet is.

**It measures him.** Every one of those moments is also a data point. Whether he
needed the name or got there himself. Whether he needed it again this week. When
in the day he struggles. How far he still goes from home. Nobody administers a
test; he just lives his week, and a picture assembles itself.

Most products in this space do one or the other. A reminder app helps and
measures nothing. A cognitive test measures and helps nobody. Here, **helping
someone and measuring them are the same act** — which is why the measurement
is free, continuous, and unbiased by a tired caregiver's recall.

---

## 2. The five surfaces

| Page | Who it is for | What it is |
|---|---|---|
| `index.html` | You, running the demo | Start here. Enrolment, sample data, honest-limits table |
| `family.html` | The family, once | Ten-step Setup Studio — people, plan, medication, appointments, life story, tags |
| `glasses.html` | The glasses themselves | What the device does. Operator console, plus a Wearer mode with no controls |
| `vault.html` | The family, weekly | **The Memory Vault.** What it knows about each person, and every conversation |
| `care.html` | The daughter, daily | One screen: how today went, what changed, what needs her |
| `privacy.html` | Anybody who asks | PDPA Trust Centre. Consent, export, erasure, audit trail |

All five share one data store and stay in sync across browser tabs.

---

## The five-minute demo

Do it in exactly this order.

**1 — Consent (30 seconds).** `privacy.html` → sign the donor consent, set assent
to active, switch on **Conversation** and **Location**. *Nothing recognises
anybody until this is done, and that is not a formality — it is a runtime gate.
Try pressing **1** on the Glasses page before consenting and watch it refuse.*

**2 — Enrol a face (60 seconds).** `index.html` → **Open camera** → type a name
and a relationship → **Capture 4 samples & enrol**. Use your own face. Four
samples are averaged into one 128-number descriptor; no image is kept unless you
also add a photo.

**3 — Be recognised (30 seconds).** `glasses.html` → **Start glasses** → look at
the camera. It says your name out loud. Press **1** to hear it again.

**4 — The vault (90 seconds).** `vault.html`. This is the part to slow down for.
Mei Ling is a sample record with eleven weeks behind her. Read the brief at the
top, then scroll to the timeline and open a Tuesday in June. Then say the line
that matters:

> *You can see what that afternoon was about. You cannot see what was said —
> those words were never written down.*

**5 — The dashboard (60 seconds).** `care.html`. The evening recap at the top is
written by an open-weight model. Below it: who he talked to today, when in the
day he struggles, whether he is withdrawing, his daily rhythm, how big his world
is, and the Cognitive Trajectory Index with its escalation flag.

**If asked "is this real?"** — everything on Home under *What is real and what is
simulated* answers it, honestly, including the things that are not.

---

## 4. Home — `index.html`

### Three things in order
The onboarding strip. Consent → a face → look at the camera. Everything else on
the page is detail.

### The Memory Vault card
The product's one-paragraph claim, with a link straight through.

### 1 — Enrol a face from the camera
Live enrolment. Opens the camera, detects a face, captures four samples, averages
them into one descriptor.

- **Flip camera** switches front/rear. On a phone the rear camera cannot see your
  own face, which is why this button exists.
- Only one page can hold the camera at a time. If it will not open, close the
  other tab.
- Models load from `./models` — no network, ever.

### 2 — Run the demo
Links to all five surfaces.

### 3 — Sample data
Loads a small sample family, appointments and history so nothing is empty.

### What is real and what is simulated
A table naming, feature by feature, what genuinely runs and what is modelled.
**Do not remove this.** A judge who finds an unlabelled simulation stops
believing the labelled ones.

---

## 5. Setup Studio — `family.html`

Where the household spends its first ten minutes. Ten steps, none of them
mandatory, all of them resumable.

| Step | What it does |
|---|---|
| **People** | Enrol from a photo. Drop in a group photo and it finds every face and lets you name each one |
| **What to say** | The one-line memory he hears with each name |
| **His day** | The daily planner — what he should do, and when |
| **Medication** | Name, description, time. "The small yellow pill", not "5mg" |
| **Appointments** | With reminder offsets (a day before, an hour before) |
| **Life story** | Work, home, songs, events — the material for reminiscence prompts |
| **Places** | A line he hears at the lift lobby, the coffee shop |
| **Things** | Wallet, keys, spectacles — for "where is my…" |
| **Trackers** | Bluetooth tags, so "where is my phone" can make the phone ring |
| **Safe zone** | Home and a radius. Not a map with a dot on it |

**Photos.** iPhone HEIC files are rejected with an explanation rather than
failing silently; EXIF rotation is applied; 12-megapixel images are downscaled
before analysis. A group photo returns **every** face, largest first, each with a
cropped thumbnail so you can tell them apart.

---

## 6. Glasses — `glasses.html`

Two modes on one page.

### Operator console
For you, driving the demo. Live camera, match confidence, what it is about to
say, the event stream, and the number keys.

### Wearer mode
What he would experience: no controls, one enormous line of text, nothing to
press. Press **Escape** to leave. There is no keyboard trap.

### What it does on its own
- **Recognises** an enrolled face and speaks the right prompt for his current
  cue stage
- **"Someone is here"** for a face it does not know — never a name it guessed
- **Prompts medication** at the right clock time, once per dose per day
- **Reads the day's plan** as each item comes due
- **Announces appointments** at the offsets the family set
- **Powers down** when it has been set on a table, and back up when picked up
- **Listens** — only while an enrolled, consented person is in view

---

## 7. Memory Vault — `vault.html`

**This is the part of the product that has no equivalent elsewhere.**

Every other product in this space stores a profile that somebody typed in once.
This one keeps a separate, growing vault for each person in his life, and most
of what is in it nobody typed. It worked it out by being in the room — the same
way an assistant you have talked to for months knows things about you that were
never in a form.

### What is in one person's vault

**The brief.** One paragraph at the top: who she is, how long they have been
talking, how many conversations, what they keep coming back to, and the most
recent things worth remembering. This is the answer to *"what does it actually
know about her?"*, and every line of it can be deleted.

**How it has been lately.** Three or four sentences about the last thirty days,
written by an open-weight model. Press **Write it again** for a fresh one.

**What he hears when she walks in.** The actual prompt. It **rotates** through
what is known, because hearing "she brought kaya toast" for the ninetieth time is
how a helpful prompt turns into wallpaper he stops noticing. Press **Next one**
to cycle, **Hear it** to play it.

**What they talk about.** Topic chips with counts, accumulated across every
conversation. Recurring word *pairs* are counted as one topic, so it says
"Wei Jie" rather than "wei" and "jie".

**Everything known about her.** Every note, each labelled **Typed** (the family
wrote it) or **Learned** (it came out of a conversation and a human approved it).
Add or remove any of them.

**Every conversation.** A timeline going back up to a year, grouped by day. Each
entry has the time, how long it lasted, what it was about, two sentences
describing it, and any moments a family member read and approved.

**Search.** Over topics, approved moments and descriptions. It searches what is
kept, because nothing else exists to search.

### The rule about what is stored

A finished conversation leaves **one record**: who, when, how long, what it was
about, the approved moments, and two sentences.

It does not leave a transcript, a recording, or a quote.

The two sentences are the only new text, and they are capped at two sentences and
45 words. There is a hard rule about who may write them:

- A model running **on this machine** (Ollama, open weights, `localhost:11434`)
  may see the six-minute rolling buffer, which is destroyed either way on the
  next line of code.
- A model running **anywhere else** — including Huawei Cloud, including our own
  future servers — sees only the topics and the facts a human has already read
  and approved.

*"Your conversation never leaves the house" is either true or it is marketing,
and the only way to keep it true is to make the code refuse.*

### Doesn't keeping every conversation fill the device up?

No — and the reason is the same reason the privacy design works: **what is kept
is a description, not a recording.**

Measured, not estimated:

| | |
|---|---|
| One conversation record | **~320 bytes** |
| One minute of 16 kHz mono audio | ~1.9 MB — **six thousand times more** |
| Eleven conversations (the sample person) | 3.4 KB |
| Seven days of movement data | 74.6 KB — *twenty times the conversations* |
| Whole store, fully seeded | 89 KB, about **1.7%** of a browser's ~5 MB |

The conversations are the cheapest thing in the store. The accelerometer costs
twenty times more, and it is capped at seven days.

**Nothing grows without a ceiling:**

| Collection | Cap |
|---|---|
| Movement (activity) | 2,016 rows — 7 days at one per five minutes |
| Life-space | 60 days, at most 40 coarse cells per day |
| Conversations | 120 per person, and nothing older than a year |
| Notes | 40 per person; pinned ones are never dropped |
| Topics | 25 per person |
| Visits | 60 per person |
| Event log | 800 |
| Audit trail | 400 |

A simulated five years — six people, three visits a week, 780 conversations —
leaves the whole store well under 400 KB. There is a test that runs exactly that.

**If it ever did fill up**, `Store.save()` sheds in a deliberate order, least
painful first: older photographs → all photographs → this week's movement → most
of the event log → and only then the oldest half of the conversation history. A
photograph can be taken again; an afternoon cannot. Whatever went is recorded and
shown in the Trust Centre, because a device that silently deletes someone's
history and carries on looking healthy is worse than one that runs out of room.

All of this is live on **[the Trust Centre](privacy.html)** under *How much of
him is on this device*.

### The sample record

Mei Ling arrives with eleven weeks of history, because the vault's whole argument
is that it **compounds** and an empty page cannot make that argument. She is
flagged **sample** everywhere she appears, and she has **no face descriptor** —
she can never be recognised and will never trigger a prompt. She is added only to
an empty address book; if you have enrolled your own family, she is not inserted.

---

## 8. Caregiver dashboard — `care.html`

One screen, read in ninety seconds, silent unless something needs her.

### Care Signal — today
Wear time, prompts served, prompts needed, doses confirmed, his day, times he
lost the thread.

### How today went
Four to six sentences written by an open-weight model, on the ladder
**Ollama → Huawei Cloud MaaS → written template**. The template is good enough
that most days nobody would notice, so the feature never fails — it only gets
better when a model is available. The model is given counts and approved facts.
It is never given a transcript, because one does not exist.

### Who he talked to today
Today's conversations, straight off the vault records. Links through to the full
history.

### When in the day he struggles
A 24-hour clock chart of his difficult moments. Late-afternoon clustering
("sundowning") is flagged only when it is well beyond what chance would give.

### How much he is still talking to people
Conversations, distinct people, minutes — against **his own** previous four
weeks, never against a population. Withdrawal from conversation is one of the
earliest changes, and it feeds on itself: he stops talking because losing the
thread in front of people is humiliating, and talking less makes it worse.

### His daily rhythm
The nonparametric actigraphy measures, from the accelerometer at one reading per
five minutes:

| Shown as | Really | What it means |
|---|---|---|
| day-to-day sameness | IS, interdaily stability | How much one day resembles the next |
| broken-up-ness | IV, intradaily variability | How fragmented a single day is |
| busy vs quiet gap | RA, relative amplitude | The distance between his busiest and quietest hours |

In a UK Biobank cohort of over 91,000 people, more fragmented and less consistent
rhythms carried a materially higher risk of dementia and mild cognitive
impairment — and they move **before** the cognitive tests do.

### How big his world is
Places visited, furthest from home, hours out, against his own previous four
weeks. Life-space mobility predicts cognitive decline, and GPS-derived range
separates mild Alzheimer's from controls.

**No route is stored.** Distance-from-home and a coarse ~110-metre neighbourhood
cell are computed at the moment of the GPS fix and the coordinates are thrown
away. The panel can tell a daughter his world is shrinking while being physically
incapable of telling anyone where he went.

### Cognitive Trajectory Index
Five sub-scores rolled into one number, tracked weekly, with an escalation flag
when the trend turns. It refuses to score until there is enough data — a freshly
enrolled person is not a low scorer, they are an unmeasured one.

### Did this happen?
The confirmation queue. A machine-heard sentence is a **proposal**; a daughter
saying "yes, that happened" is what makes it a fact. Approve, edit or discard.
Only approved facts enter practice.

### The rest
What he is practising · who he is forgetting · the memory library · medication ·
the consent register · the full event timeline.

---

## 9. Trust Centre — `privacy.html`

Not a policy page. The working controls.

- **Donor consent** and **donee** (the person holding Lasting Power of Attorney)
- **Assent** — his ongoing agreement, separate from the legal consent, revocable
  by him at any time. Under the Mental Capacity Act capacity is presumed and
  decisions are supported, not substituted
- **Six purposes**, each switchable on its own: recognition, reminders,
  conversation, location, trajectory, research
- **How much of him is on this device** — a real measurement of the store, by
  kind, with what would be deleted first if it ever ran out of room
- **Export everything** — PDPA access and portability, as JSON
- **Erase biometrics** — destroys every face descriptor and photo while keeping
  names and prompts, so the product degrades instead of dying
- **Erase everything**
- **Audit trail** — append-only, timestamped

**The consent switches are load-bearing.** Turn off *conversation* and the
microphone genuinely stops. Turn off *recognition* and faces stop being matched.

---

## 10. The engines underneath

### Errorless learning with vanishing cues
The clinical core. He is never allowed to guess wrong, because in dementia a
wrong guess is learned as firmly as a right one. Instead the prompt **fades**:

| Stage | What he hears |
|---|---|
| 0 | The whole thing — "This is Mei Ling, your daughter" |
| 1 | A partial cue — the first sound, then a pause |
| 2 | A chime only — his turn |

Three unaided retrievals move him up a stage; two failures move him down. The
interval between trials expands ×1.6 on success and halves on failure. In the
published trials this took face naming from 22% to 98%, generalised to real
faces, and held at three, six and nine months.

The **same ladder** runs on facts and on where he left his wallet.

### Conversation memory
Listens only while an enrolled, consented person is in view. A rolling six-minute
buffer that is never written to disk. Up to five short candidate facts per
conversation, each sent to the caregiver to approve. Then the buffer is destroyed.

**One conversation per person.** His granddaughter is talking to him; she goes to
make tea; his grandson comes in; then she comes back. A single shared buffer
throws her conversation away the moment the grandson appears. Here each person
gets their own session, switching **parks** rather than wipes, and two people in
view at once is a group conversation keyed on the set of them.

### Holding the thread
The live half. He taps once and hears, in his ear only, what the conversation is
about and what he was saying. Nobody else in the room knows it happened.

The event log records **that** it happened and never **what** was said. How often
he loses the thread is the clinical signal; what he was saying is nobody's
business.

### Bluetooth trackers
"Where is my phone?" makes the tag on the phone ring, over Web Bluetooth's
Immediate Alert Service. Where a tag is not paired it says so plainly rather than
pretending — proximity is reported in coarse bands, never in metres it cannot
measure.

### Safe zone
Not a live map. A home zone, an alert when he leaves it, and — the half that
matters — **a bearing home spoken into his ear**, so the same sensor that
reassures her also helps him. CARA already owns safe return in Singapore;
competing with it would be foolish, so this raises the alarm earlier and hands
off.

---

## 11. Privacy, in code rather than in policy

Six decisions that are enforced by the code, not by a paragraph:

1. **Enrolment-only recognition.** A face that is not enrolled never has its
   descriptor stored. The vector is a local variable and goes out of scope with
   the frame.
2. **Facts, never transcripts.** The difference between a memory aid and a
   surveillance device. Under the PDPA every person in that room is a data
   subject and almost none of them consented.
3. **Consent gates behaviour at runtime.** Not a checkbox that logs a preference.
4. **Location is derived at the point of measurement.** Distance and a coarse cell
   survive; coordinates do not. His route is not reconstructable from what is kept.
5. **The on-device rule for models.** Only a model running on this machine may see
   the rolling buffer.
6. **The event log is deliberately thin.** It records that he lost the thread,
   never what he was saying — because the log is persisted and exported, and
   putting the sentence in it would write his conversation to disk through the
   back door.

---

## 12. What is real and what is simulated

| Component | Status |
|---|---|
| Face detection + 128-number embedding | **Real.** In-browser, weights local, no network |
| Enrolment-only matching | **Real** |
| "Someone is here" for unknown faces | **Real** |
| Spoken prompts, multilingual | **Real.** Voice availability depends on the OS |
| Vanishing-cue ladder, expanding intervals | **Real.** Full state machine, persisted |
| Conversation memory and fact proposals | **Real**, on the browser's own speech recognition |
| Memory Vault, conversation history | **Real.** The sample person's eleven weeks are **flagged as a sample everywhere** |
| Per-conversation and per-person write-ups | **Real** on the Ollama → MaaS → template ladder |
| Rest-activity rhythm (IS/IV/RA/M10/L5) | **Real maths** from the phone accelerometer. Seven days of history seeded and **labelled on the card** |
| Life-space | **Real maths**, derived so no route is stored. Five weeks seeded and **labelled on the card** |
| Sundowning clock, social withdrawal | **Real**, from this session's own events |
| Cognitive Trajectory Index | **Real maths.** History seeded and labelled. The weights are a first pass, not a validated instrument |
| Bluetooth trackers | **Real** where the browser supports it; says so plainly where it does not |
| Safe zone | **Real** geolocation |
| Wear time, idle power-down | **Real, proxied** from detection activity |
| Presbycusis EQ, whisper mode | **Not simulated.** Firmware-level; a browser exposes rate and pitch only |
| On-glasses execution | **Roadmap.** This models the phone-camera + audio-glasses configuration |
| Huawei Cloud MaaS | **Coded, not keyed.** Falls back to a local template |

---

## 13. Running it

```bash
python serve.py
```

Then open `http://localhost:8000`. No build step, no `npm install`, no CDN, no
network. The face-recognition weights are vendored in `./models`.

Requirements: **Python 3** (standard library only) and **Chrome or Edge** —
Firefox has no `SpeechRecognition`, so retrieval detection falls back to the
manual buttons, which always work.

For AI-written summaries, optionally:

```bash
ollama serve
```

Anything pulled works; a small model is fine. Without it the written templates
take over and nothing breaks.

---

## 14. Keyboard reference

On `glasses.html`:

| Key | What it does |
|---|---|
| **1** | Say the current prompt for whoever is in view |
| **2** | He got the name himself — logs an unaided retrieval |
| **3** | He needed help — logs an assisted retrieval |
| **4** | "Tell me again" |
| **5** | Medication prompt |
| **6** | "What were we talking about?" — holds the thread |
| **7** | "Where is my…" — object lookup, rings a tracker if paired |
| **8** | Which way is home |
| **9** | A reminiscence moment from his life story |
| **Escape** | Leave Wearer mode |

---

## 15. Known limits

Worth stating before anyone else finds them.

- **No user validation yet.** No family has used this. That is the largest gap in
  the submission and no amount of working code substitutes for it.
- **The CTI weights are a first pass.** Five sub-scores rolled into one number
  with weights we chose. It is internally consistent and directionally sensible;
  it is not a validated instrument and is not presented as one.
- **The behavioural panel covers about a third of the Neuropsychiatric
  Inventory.** We can passively sense sleep/rhythm disturbance, aberrant motor
  behaviour, apathy and withdrawal, and the timing pattern that maps onto
  agitation. We cannot sense delusions, hallucinations, disinhibition or appetite.
  What we get in exchange is continuous and unbiased by a caregiver's recall.
- **Speech recognition is the browser's**, which means it is a cloud service in
  Chrome. On the real device this is an on-device model; in the prototype it is
  the honest limitation to name first.
- **The glasses do not exist yet.** Huawei Eyewear 2 has no camera; the Huawei AI
  Glasses have one but are China-only with no public SDK. The prototype models
  the phone-camera + audio-glasses configuration, which is the shippable Phase 1.
- **Everything is descriptive, never diagnostic.** No number here is a diagnosis
  or a prediction. Every flagged change offers a non-medical explanation first,
  and suggests mentioning it at the next appointment rather than acting tonight.

---

*Built for the Huawei Tech4City Competition 2026. Code:
<https://github.com/Jojour13/ingat-smart-glasses> · Live:
<https://ingat-inky.vercel.app>*
