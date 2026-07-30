# How to use this thing

Plain English. Four minutes. No technical knowledge needed.

---

## Step 0 — turn it on

Open a terminal in the `Prototype` folder and run:

```bash
python serve.py
```

A browser window opens by itself. **Leave that terminal window open** — it is the
thing serving the pages. Close it and everything stops working.

If it says the port is busy: `python serve.py 8080`

**Do not double-click the HTML files.** They will open, but the camera will not
work. Browsers only allow camera access from `http://localhost`, never from a
file on disk. This is the single most common reason it "doesn't work".

---

## The three steps, in order

### 1. Say yes on his behalf — the **Privacy** page

Type any name in the box, click **He agreed**.

**Nothing will recognise anyone until you do this.** That is deliberate: it is the
consent rule built into the product, not a bug. If you skip it, the Glasses page
will tell you recognition is blocked.

### 2. Put a face in — the **Home** page (or **Setup**)

Easiest route: on the Home page, click **Open camera**, type a name like
`Mei Ling`, relationship `Your daughter`, memory
`She came last Sunday and brought kaya toast`, then **Capture 4 samples & enrol**.

Enrol *your own face*. You are going to stand in front of the camera in a moment,
so it needs to know you.

Alternative: the **Setup** page lets you drag in a batch of family photos. It
scans each one automatically and flags any where it cannot find a face.

### 3. Look at the camera — the **Glasses** page

Click **Start glasses**. Wait for the models to load (about ten seconds, once).
Look into the camera.

You should hear: *"Mei Ling. Your daughter. She came last Sunday and brought kaya
toast."*

That is the product working.

---

## What to do next, to see the interesting part

The first prompt just tells him the answer. The point of the product is that the
help **shrinks**.

- **Press `1` three times.** (Key `1` = "person 1 walks in", without you having to
  move.) Watch the right-hand panel: three green bars fill, then it flips to
  **PARTIAL**.
- **Press `1` again.** Now you only hear *"Mei…"* and a red bar sweeps across —
  that is a 2-second window for him to remember it himself.
- **Press `G`** (he got it) — the log turns green and the help shrinks further.
- **Three greens** and it becomes **CHIME ONLY**: just a tone, and three seconds
  to produce the name on his own.
- **Press `N` twice** and the help comes *back*. Support returns as easily as it
  withdraws. Say that out loud when you demo it.

Then open the **Caregiver** page in a second tab. It has been recording all of it.

---

## The five pages, in one line each

| Page | What it is |
|---|---|
| **Home** | Start here. Quick enrolment and an honest list of what is real vs simulated. |
| **Setup** | For the family. Photos, calendar, medication, places, his life story, and recording prompts in your own voice. |
| **Glasses** | His device. The camera and the voice. *This screen is for the audience — the real wearer has no screen at all.* |
| **Caregiver** | The daughter's view. Wear time, prompts needed, the decline index, who he is forgetting. |
| **Privacy** | Consent, Singapore data-protection obligations, download-everything, erase-everything, audit log. |

---

## Keys on the Glasses page

| Key | Does |
|---|---|
| `1` – `9` | That person walks in (no camera needed) |
| `G` | He remembered the name |
| `N` | He couldn't |
| `space` | Tap — "tell me again" |

**`1`–`9` is your safety net.** If the camera misbehaves in front of judges, press
`1` and carry on. Everything downstream — the shrinking cue, the index, the
dashboard — is identical either way.

---

## If something goes wrong

**Nothing happens when I look at the camera.**
Check the right panel says at least "1 enrolled", and that you did Step 1. There
is also an 18-second cooldown per person so it does not repeat endlessly — press
`1` to force it.

**No sound.**
Click anywhere on the page first; browsers block audio until you interact. If
text appears in the dark "What he hears" panel but you hear nothing, it is your
computer's voice settings, not the app.

**"Camera off" and it will not start.**
You are probably opening the file directly instead of through `python serve.py`.
See Step 0.

**It says recognition is blocked.**
Step 1. Go and record consent.

**The face model will not load.**
It now falls back automatically and tells you if it truly failed. Use `1`–`9` in
the meantime — nothing else depends on it.

---

## Before you demo to anyone

1. Run it and open all five pages once, so everything is cached.
2. Record consent.
3. Enrol two or three teammates **in the room you will present in**, under that
   room's lighting. This matters more than anything else.
4. Press `1` three times for each person, so they are already on the PARTIAL rung
   and the shrinking cue shows up in your first thirty seconds.
5. Turn the volume up and play one prompt to check.
6. Have the Caregiver page open in a second tab already.
