# INGAT

**Smart glasses that remember for someone with early-stage dementia — and turn the forgetting into a measurement.**

A working prototype. No build step, no `npm install`, no framework, no CDN. Face
recognition runs entirely in your browser, and the whole thing works with the
network unplugged.

```bash
python serve.py
```

Then open **http://localhost:8000**. New to it? Read [START-HERE.md](START-HERE.md) — plain English, four minutes.

**[FEATURES.md](FEATURES.md) is the complete guide** — every page, every feature,
the five-minute demo script, what is real and what is simulated, and the known
limits.

---

## What it does

Someone in the early stages of dementia is still functional, still living at
home, and still going to the coffee shop. What they lose first is not the
ability to cook or walk — it is the name of the person who just walked through
the door, whether they took the 1pm tablet, and which way is home.

INGAT is a pair of ordinary prescription glasses that quietly tells them, in
their own language:

> *"Mei Ling. Your daughter. She came last Sunday and brought kaya toast."*

Name, relationship, **and a shared memory** — because the thing that hurts is not
forgetting a name, it is the silence where a relationship should be.

The help leaves a trace. How many prompts were needed. How long before they
recognised their own child. That trace becomes a continuous record of cognitive
change, drawn from real life instead of a twenty-minute test in a clinic once a
year.

---

## Features

### The glasses — what the wearer experiences

- **Face recognition** against people the family enrolled, spoken aloud, hands-free
- **No screen.** Audio only. This is a deliberate clinical choice, not a missing feature — see below
- **One physical control.** A single tap means *"tell me again"*. That is the entire gesture vocabulary
- **Never guesses a name.** Below the confidence threshold it says *"someone is here"*
- **Medication, appointments, morning briefing, and a daily reminiscence moment**, on real clock time
- **Place prompts** — *"This is the lift lobby. Your flat is on the seventh floor, unit 12."*
- **Multilingual** — English, Mandarin, Cantonese, Malay, Tamil
- **Speech tuned for age-related hearing loss** — slower rate, clearer delivery

### Vanishing cues — the help shrinks

Most memory aids always supply the answer. That is a crutch, and it builds
permanent dependency. INGAT implements **errorless learning with spaced
retrieval**, an established memory-rehabilitation protocol:

| Stage | What is said | Window |
|---|---|---|
| **Full** | *"Mei Ling. Your daughter. She came last Sunday and brought kaya toast."* | none — not a test |
| **Partial** | *"Mei…"* | 2 seconds |
| **Chime** | a soft tone | 3 seconds |

Three consecutive unaided retrievals advance a stage. **Two failures put the help
back.** The interval stretches ×1.6 on success and halves on failure, per person.

Retrieval is detected by the wearer *saying the name out loud* — the microphone
hears it, and that is the measurement.

### The Setup Studio — for the family

- **Drag in a batch of photos.** Each is scanned automatically and flagged if no face is found
- Name, relationship, and one shared memory per person — with a **live preview of exactly what will be spoken**
- **Calendar** with appointment reminders at chosen offsets
- Medication, places, and a life-story bank for the daily reminiscence moment
- **Record prompts in your own voice** — a familiar voice is recognised faster and is calming rather than clinical

### The caregiver dashboard

- **Care Signal** — silent by default, one message with one action when something matters
- Wear time, prompts served, **prompts needed**, dose confirmations
- **Cognitive Trajectory Index** — a weekly score built from five sub-scores, with escalation, watch and recovery flags
- **"Who is he forgetting?"** — recognition latency and prompt dependency per person
- Contextual micro-lessons triggered by what the system detects

### The Trust Centre

Consent, data rights and the audit trail — implemented, not described.

- Consent **read aloud through the glasses in the wearer's own language**, then recorded
- Four **granular purposes** (recognition, reminders, trajectory, research), each independently revocable
- **Recognition is gated on consent.** Pause assent and the camera stops while reminders continue
- **Download everything we hold** and **erase everything** are buttons, not an email address
- Live retention countdown, append-only audit log

---

## Design decisions worth knowing

**No screen — and that is clinical.** The intuitive "premium" version of this
product labels faces on a heads-up display. For this user it is actively
harmful: dementia frequently impairs visual processing alongside memory, so a
text overlay adds load to the system that is already failing, and it makes the
wearer look *away* from the person they are greeting. Anything visible is also
anything other people can see. The correct interface here is no interface.

**Enrolment-only recognition.** The system matches only against faces a family
explicitly added. A non-enrolled face has its descriptor discarded with the
frame. **Strangers are never identified.** This one restraint is what makes the
whole product defensible.

**Ephemeral by default.** No frame, image or video is ever written to storage.
Frame → embedding → match → discard. The only persisted vector is one 128-float
descriptor per consented person, which cannot be turned back into a face.

**The camera switch speaks.** Flip it off and the wearer is told *"Camera off. I
can still remind you about your medicine."* A silent failure would read to
someone with dementia as *I have got worse.*

**One typographic rule.** The product has no screen for its actual user, so the
interface separates two kinds of content by typeface: **serif = words a human
will hear**, **mono = measurements the machine took**. Once you have seen it
twice you can tell at a glance whether a line is care or telemetry.

---

## How it works

```
serve.py              static server; serves the weight shards as octet-stream
index.html            start here — quick enrolment, honest real-vs-simulated table
family.html           Setup Studio — people, calendar, meds, places, story, voice
glasses.html          the device + an operator console for an audience
care.html             the caregiver dashboard
privacy.html          Trust Centre — consent, data rights, audit
css/app.css           design system
js/store.js           data layer, localStorage, cross-tab sync, schema migration
js/speech.js          audio channel, recorded-voice playback, retrieval listener
js/vision.js          face-api wrapper, enrolment-only matching
js/cues.js            the vanishing-cue / spaced-retrieval engine
js/schedule.js        briefing, medication, appointments, reminiscence
js/cti.js             Cognitive Trajectory Index + hand-rolled SVG chart
js/maas.js            Huawei Cloud MaaS (Singapore region) — coded, unkeyed
models/               vendored face-api weights, 6.5 MB
```

Recognition is [face-api.js](https://github.com/justadudewhohacks/face-api.js)
(TinyFaceDetector + FaceRecognitionNet) running in-browser. Speech is the Web
Speech API. The chart is hand-rolled SVG rather than a charting library, for the
same reason the models are vendored: **one less thing that can fail to load.**

**Robustness built in after testing found the failure modes:**

- TensorFlow.js defaults to WebGL, and when WebGL stalls it stalls *silently*.
  Model loading is raced against a timeout, falls back to the CPU backend, and
  fails fast with a useful message rather than hanging forever.
- Uploaded photos are nothing like webcam frames — a face might be 60px in a
  group shot or 2000px in a portrait. Detection sweeps four input sizes,
  relaxing the threshold each pass, before giving up.
- The Cognitive Trajectory Index refuses to publish below three tested trials.
  A number on a clinician's screen implies it means something.

---

## Honest limits

Volunteering this is worth more than hiding it.

| Component | Status |
|---|---|
| Face detection + 128-d embedding | **Real.** In-browser, weights local, no network |
| Enrolment-only matching | **Real** |
| "Someone is here" for unknown faces | **Real** |
| Spoken prompts, multilingual | **Real.** Voice availability depends on the OS |
| Vanishing-cue ladder, expanding intervals | **Real.** Full state machine, persisted |
| Retrieval detection by speech | **Real**, with a manual fallback that always works |
| Scheduler | **Real.** Real clock time, once per key per day |
| Consent gate, export, erasure, audit | **Real** |
| Recorded family voice | **Real.** On-device, played instead of TTS when present |
| Cognitive Trajectory Index | **Real maths.** History is seeded and **labelled as seeded in the UI**. The weights are a first pass, not a validated instrument |
| Wear time, idle power-down | **Real, proxied** — from detection activity, not an IMU |
| Rest-activity rhythm (IS / IV / RA / M10 / L5) | **Real maths**, from the phone accelerometer at one sample per five minutes. Seven days of history are seeded and **labelled as seeded on the card itself** |
| Life-space (places, furthest, hours out) | **Real maths**, derived at the moment of measurement so no route is ever stored. Five weeks of history are seeded and **labelled as seeded on the card** |
| Sundowning clock, social withdrawal | **Real.** Computed from this session's own event log, compared against his own previous weeks |
| Place prompts | **Real, manually triggered.** These would be GPS geofences |
| Presbycusis EQ, whisper mode | **Not simulated.** Firmware-level; a browser exposes rate and pitch only |
| On-glasses execution | **Roadmap.** This models the phone-camera + audio-glasses configuration |
| Huawei Cloud MaaS | **Coded, not keyed.** Falls back to local templates |

---

## Requirements

- **Python 3** (standard library only — `serve.py` has no dependencies)
- **Chrome or Edge.** Firefox lacks `SpeechRecognition`, so retrieval detection
  falls back to the manual keys, which always work
- A webcam for live recognition — or press `1`–`9` to simulate

Do not open the HTML files directly. Browsers block camera access on `file://`;
`http://localhost` is a secure context and `file://` is not.

---

## Keyboard

| Key | Action |
|---|---|
| `1`–`9` | That person walks in (no camera needed) |
| `G` | They retrieved the name |
| `N` | They couldn't |
| `space` | Tap — "tell me again" |

---

## Attribution

Face detection and recognition by
[face-api.js](https://github.com/justadudewhohacks/face-api.js) (MIT), including
the vendored model weights in `models/`. See [NOTICE.md](NOTICE.md).

Built for the Huawei Tech4City Competition 2026, theme *AI for Health —
Ageing-in-Place*.

**This is a prototype, not a medical device.** It makes no diagnostic claim and
must not be used to make clinical decisions.
