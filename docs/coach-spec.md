# Coach spec: psychology cues and Voice Mode

This document describes how the in-run coach chooses what to say between heart
rate cues, and how the Voice Mode screen is laid out. The cue lines themselves
live in `lib/coach/psychCues.ts`, which is the source of truth.

Background reading behind the design: Alex Hutchinson, *Endure*; the
psychobiological model of endurance performance (Marcora); the motivational
self-talk trial by Blanchfield and Marcora (2014, about 18% longer time to
exhaustion); Brick and colleagues (2018) on smiling and running economy; Kross
and colleagues (2014) on distanced self-talk; reviews of associative and
dissociative attention; slow breathing and HRV; green exercise. The common
thread: perceived effort is the main limiter, so calm, autonomy-supportive,
second-person cues that reappraise and relax work better than drill-sergeant
lines. Never scold, never suppress.

## 1. Cue categories (9)

| id | does | rationale |
|---|---|---|
| `effort_reappraisal` | recasts burn/HR/heaviness as adaptation | reappraisal lowers perceived effort (Marcora; 2024 meta) |
| `self_talk_motivational` | "feeling good" early / "stay strong" late | +18% TTE, lower RPE (Blanchfield & Marcora 2014); second person adds distancing (Kross) |
| `attentional_narrow` | form/cadence/breath/tension scan | associative focus → better regulation |
| `attentional_wide` | external focus, mind roams | lowers VO₂/RPE (economy); anti-monotony ; ideal Z2 |
| `chunking` | near targets, segmenting | proximal goals reduce perceived difficulty |
| `identity_values` | who you are / why you run | identity framing sustains striving |
| `arousal_regulation` | long exhale, relax, smile | slow breathing ↑HRV; smiling improved economy 2.8% (Brick 2018) |
| `gratitude_awe` | privilege of moving, surroundings | green exercise/awe ↑vigor, buffers fatigue |
| `process_goal_progress` | banked, irreversible progress | "more done than remains" sustains effort |

## 2. Phase & trigger rules

Phases by fraction of planned duration T: **Opening** 0 to 20% → arousal_regulation,
attentional_narrow, early self_talk ("feeling good"), gratitude_awe; avoid intensity.
**Middle** 20 to 60% → attentional_wide, chunking, gratitude_awe, process_goal_progress
(halfway), occasional effort_reappraisal. **Doldrums** 60 to 70% → identity_values,
attentional_wide, process_goal_progress, self_talk; RAISE cue density here.
**Final third** >66% → self_talk ("stay strong"), effort_reappraisal, chunking,
arousal_regulation (form under fatigue), identity_values. **Closing** last 5% →
self_talk, identity_values, gratitude_awe; never correction/negativity.

Signal triggers (one cue per event; economy/safety outranks motivation):
- **HR drifting up @ same pace** → arousal_regulation → attentional_narrow → effort_reappraisal
- **Pace fading, HR normal** → self_talk → process_goal_progress → chunking
- **Long climb** → chunking (to the top) → attentional_narrow (short stride, cadence, relax face) → effort_reappraisal
- **Post-pause restart** → self_talk (no guilt) → attentional_narrow (re-find rhythm) → chunking
- **Doldrums window** → identity_values / attentional_wide / gratitude_awe / process_goal_progress

## 3. Anti-repetition rules

1. No line twice per run (`usedLineIds` per session).
2. Soft cross-run freshness: deprioritize (not ban) lines used in the last 2 runs while ≥40% of a category remains fresh.
3. No category back-to-back (`lastCategory` excluded from next pick).
4. Category cooldown ~8 min (doldrums override ~5 min). Signal fires bypass schedule but update the clock.
5. Weighted pick: `score = phaseWeight × signalWeight × timeSinceCategoryUsed × freshnessPenalty`; then uniform-random unused line in the winning category.
6. No two consecutive cues sharing a stem word (strong/steady…).
7. Category exhausted mid-run → fall back to next-best category, never repeat.

## 4. Blending with the every-minute HR band cue (HR cue is AUTHORITATIVE, unchanged)

1. Single TTS channel; priority: HR cue > safety psych (arousal on drift) > scheduled psych.
2. Slot psych cues ~30 s past the minute mark, ±5 s jitter.
3. HARD rule: no psych cue within 15 s before/after any HR cue; delay to the next window or skip.
4. Cadence: one psych cue every 3 to 4 min (Opening/Middle), 2 to 2.5 min (Doldrums/Final). Never two psych cues between consecutive HR cues.
5. Lines ≤18 words (≈≤5 s spoken); enforce length, skip rather than overrun.
6. HR-over-band: band cue corrects first; 20 to 30 s later one arousal_regulation cue reinforces. Suppress gratitude_awe/attentional_wide until back in band.
7. After any pause: hold psych cues ~20 s.

## 5. Cue bank A: evidence-based lines

108 lines (`a-1` to `a-108`) across the nine categories above, at most 18
words each, second person, present tense. See `PSYCH_CUE_LINES` in
`lib/coach/psychCues.ts`.

## 6. Cue bank B: long game lines

47 lines (`lg-1` to `lg-47`, category `identity_long_game`) about patience,
consistency and identity over years rather than one run. They are phase-gated:

- settle (opening): 1 to 6;
- aerobic patience (opening and middle): 7 to 12;
- presence, identity and long game (middle): 13 to 28;
- discomfort (middle to final): 29 to 33;
- self-compassion (any phase, especially after a pause or a fade): 34 to 37;
- late intensity (final third ONLY): 38 to 43, where `lg-38` is the signature
  line and plays at most once per run;
- finishing (closing): 44 to 47.

## 7. Tone rules

- Calm, spacious, short declaratives; one idea per cue; periods are TTS breaths.
- Register arc: early grounding, then near-silent and observational in the
  middle, then warmer, shorter and stronger verbs late. Intensity must be
  EARNED (final stretch only).
- Second person, present tense. Numbers are seasoning, not the meal: at most
  two, rounded, spoken naturally.
- Signature lines play at most once per run.
- NEVER: "no excuses", "beast mode", "crush/kill it", guilt or streak-shaming,
  sarcasm about slowness, hollow praise ("Great effort!", "Amazing job!"),
  medical claims, push-through-pain when pain is reported, the same metaphor
  twice per run, more than 20 words per breath.
- Silence is coaching: an unspoken interval builds trust.
- All lines are original wording. Do not add quotes or catchphrases from
  books, podcasts or public figures.

## 8. Voice Mode overlay (`components/run/VoiceModeOverlay.tsx`)

Design rules: half-second glance test (band state and directive readable in
under 500 ms through color, not reading); two to four data points at most;
pure black #000 base, off-white #f5f5f4 text; controls in the bottom thumb arc
with targets of at least 48 dp.

- **Band field:** full-screen vertical gradient rising from the bottom in the
  state color (in #10b981, below #f59e0b, above #ef4444, no signal #6b7280) at
  about 12% opacity, fading to black by mid-screen. 600 ms crossfade, never a
  snap. `above` breathes on a 4 s cycle; urgent (more than 4 bpm over) lifts the
  wash to 20%.
- **Status strip (top):** "VOICE MODE · Z2" microlabel, a coach chip with a
  waveform while speaking, and an Exit pill.
- **Hero (center):** HR number in the state color, a trend chevron from the
  30 s HR slope, and one directive word (KEEP, LIFT, EASE, SETTLE). A band
  gauge with a 60 s HR sparkline sits below.
- **Stat rail:** Time, Distance and Pace; tap Pace to switch to Cadence.
- **Coach line:** the last thing the coach said.
- **Control dock (bottom):** Mute, Pause/Resume and Finish, large and centered
  for the thumb.
- Animations stay at or under 600 ms or are slow ambient loops, and honor
  Reduce Motion. The screen stays awake in Voice Mode.
