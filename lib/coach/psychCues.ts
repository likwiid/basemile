// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Sports-psychology cue engine for Voice Mode — docs/coach-spec.md §1–§7.
 *
 * Two banks, selected by a pure weighted engine:
 * - Bank A (108 lines, ids a-1..a-108): evidence-based cues across nine
 *   categories (Marcora reappraisal, Blanchfield & Marcora self-talk, Brick
 *   smiling economy, association/dissociation, chunking, identity, slow
 *   breathing, green-exercise gratitude, banked-progress framing).
 * - Bank B (47 lines, ids lg-1..lg-47, category `identity_long_game`): long
 *   game identity lines, phase-gated per the §6 header (late-intensity lines
 *   are final-third only; the "more than you think" signature fires once per
 *   run).
 *
 * The engine is deterministic given a seeded `rand` and holds no state: the
 * caller owns per-run memory (used ids, last category, category clocks, the
 * last two spoken texts, signature flag) and passes it in on every pick.
 */

export const PSYCH_CUE_CATEGORIES = [
  'effort_reappraisal',
  'self_talk_motivational',
  'attentional_narrow',
  'attentional_wide',
  'chunking',
  'identity_values',
  'arousal_regulation',
  'gratitude_awe',
  'process_goal_progress',
  'identity_long_game',
] as const;

export type PsychCueCategory = (typeof PSYCH_CUE_CATEGORIES)[number];

export type RunPhase = 'opening' | 'middle' | 'doldrums' | 'final' | 'closing';

/** In-run events that request a cue outside the normal schedule (§2). */
export type PsychSignal = 'hr_drift' | 'pace_fade' | 'climb' | 'post_pause';

export interface PsychCueLine {
  id: string;
  category: PsychCueCategory;
  /** Phases where this line may be spoken. */
  phases: readonly RunPhase[];
  /** Spoken text — second person, one idea, ≤18 words (§4.5, §7). */
  text: string;
}

/** The "more than you think" line: max once per run (§6, §7). */
export const SIGNATURE_LINE_ID = 'lg-38';

export const CATEGORY_COOLDOWN_MS = 8 * 60_000;
export const DOLDRUMS_CATEGORY_COOLDOWN_MS = 5 * 60_000;

// Phase combinations used by the bank. Names read as phase initials.
const OM: readonly RunPhase[] = ['opening', 'middle'];
const OMD: readonly RunPhase[] = ['opening', 'middle', 'doldrums'];
const OMDF: readonly RunPhase[] = ['opening', 'middle', 'doldrums', 'final'];
const OMF: readonly RunPhase[] = ['opening', 'middle', 'final'];
const OMDC: readonly RunPhase[] = ['opening', 'middle', 'doldrums', 'closing'];
const MD: readonly RunPhase[] = ['middle', 'doldrums'];
const MDF: readonly RunPhase[] = ['middle', 'doldrums', 'final'];
const MF: readonly RunPhase[] = ['middle', 'final'];
const DF: readonly RunPhase[] = ['doldrums', 'final'];
const DFC: readonly RunPhase[] = ['doldrums', 'final', 'closing'];
const O: readonly RunPhase[] = ['opening'];
const F: readonly RunPhase[] = ['final'];
const FC: readonly RunPhase[] = ['final', 'closing'];
const C: readonly RunPhase[] = ['closing'];
const ANY: readonly RunPhase[] = ['opening', 'middle', 'doldrums', 'final', 'closing'];

function cue(
  id: string,
  category: PsychCueCategory,
  phases: readonly RunPhase[],
  text: string
): PsychCueLine {
  return { id, category, phases, text };
}

export const PSYCH_CUE_LINES: readonly PsychCueLine[] = [
  // — effort_reappraisal: recast burn/HR/heaviness as adaptation (§5) —
  cue('a-1', 'effort_reappraisal', MF, 'That heat in your legs is your engine building. Let it.'),
  cue('a-2', 'effort_reappraisal', MF, 'The heavy feeling is training landing. Proof the work is working.'),
  cue('a-3', 'effort_reappraisal', MF, "Your heart is climbing because it's answering the call. Nothing wrong here."),
  cue('a-4', 'effort_reappraisal', MF, 'Notice the effort, then name it: this is adaptation, not damage.'),
  cue('a-5', 'effort_reappraisal', MF, 'A faster heartbeat is fuel arriving, not a warning to slow.'),
  cue('a-6', 'effort_reappraisal', MF, 'Discomfort is just information. Read it calmly and keep rolling.'),
  cue('a-7', 'effort_reappraisal', MF, 'This burn is temporary and useful. Your body is rewriting itself.'),
  cue('a-8', 'effort_reappraisal', MF, 'What you feel right now is fitness being made, breath by breath.'),
  cue('a-9', 'effort_reappraisal', MF, "The sensation you're fighting is the exact place growth happens."),
  cue('a-10', 'effort_reappraisal', MF, 'Tired legs are strong legs practicing. Trust the ground under you.'),
  cue('a-11', 'effort_reappraisal', MF, 'Not too hard. Hard enough to matter. Sit with it.'),
  cue('a-12', 'effort_reappraisal', MF, "Your body isn't failing. It's adapting in real time."),
  cue('a-13', 'effort_reappraisal', MF, 'Effort is the price of change, and you can afford it.'),
  cue('a-14', 'effort_reappraisal', MF, 'Let the feeling be big without letting it be a problem.'),

  // — self_talk_motivational: "feeling good" early / "stay strong" late (§2, §5) —
  cue('a-15', 'self_talk_motivational', OM, 'Feeling good, moving easy. Let that be your quiet refrain.'),
  cue('a-16', 'self_talk_motivational', DFC, 'You are strong and you are steady. Say it, mean it.'),
  cue('a-17', 'self_talk_motivational', DF, 'Tell yourself the truth: you have done harder than this.'),
  cue('a-18', 'self_talk_motivational', DFC, 'Stay smooth, stay strong. Two words, one rhythm.'),
  cue('a-19', 'self_talk_motivational', DF, 'You can hold this. You were holding it a minute ago.'),
  cue('a-20', 'self_talk_motivational', DF, 'Keep going, keep flowing. The pace belongs to you now.'),
  cue('a-21', 'self_talk_motivational', MDF, "Talk to yourself like someone you're proud of."),
  cue('a-22', 'self_talk_motivational', F, 'You trained for exactly this moment, so meet it.'),
  cue('a-23', 'self_talk_motivational', FC, 'One more good minute. You are very good at one more.'),
  cue('a-24', 'self_talk_motivational', OMD, 'Light and loose. Repeat it until your stride agrees.'),
  cue('a-25', 'self_talk_motivational', DFC, "You're the kind of person who finishes what they start."),
  cue('a-26', 'self_talk_motivational', DF, 'Strong is a decision, and you just made it again.'),
  cue('a-27', 'self_talk_motivational', OMD, 'Your pace, your plan, your day. Own all three.'),
  cue('a-28', 'self_talk_motivational', OMDF, 'Whisper "steady" on each exhale and let it carry you.'),

  // — attentional_narrow: form/cadence/breath/tension scan (§5) —
  cue('a-29', 'attentional_narrow', OMF, 'Scan once. Jaw, shoulders, hands. Soften whatever you find.'),
  cue('a-30', 'attentional_narrow', OMF, 'Count ten footfalls and make each one land quietly.'),
  cue('a-31', 'attentional_narrow', OMF, 'Feel your feet leave the ground a little quicker.'),
  cue('a-32', 'attentional_narrow', OMF, 'Match your breath to your steps and hold the pattern.'),
  cue('a-33', 'attentional_narrow', OMF, 'Posture check: tall spine, open chest, eyes level ahead.'),
  cue('a-34', 'attentional_narrow', OMF, 'Listen to your cadence and let it turn even and smooth.'),
  cue('a-35', 'attentional_narrow', OMF, 'Drop your shoulders away from your ears, right now.'),
  cue('a-36', 'attentional_narrow', OMF, 'Find the rhythm of your breathing and settle inside it.'),
  cue('a-37', 'attentional_narrow', OMF, 'Shorten your stride slightly on this stretch and stay springy.'),
  cue('a-38', 'attentional_narrow', OMF, 'Put your attention on relaxed hands and a loose jaw.'),
  cue('a-39', 'attentional_narrow', OMF, 'Feel the midfoot touch. Light, quiet, step after step.'),
  cue('a-40', 'attentional_narrow', OMF, 'Tune the breath: smooth in, a little longer out.'),

  // — attentional_wide: external focus, mind roams — ideal Z2 (§5) —
  cue('a-41', 'attentional_wide', MD, 'Lift your eyes and take in the whole horizon a moment.'),
  cue('a-42', 'attentional_wide', MD, 'Pick a point far ahead and let it pull you forward.'),
  cue('a-43', 'attentional_wide', MD, 'Let your mind wander somewhere pleasant while your legs keep time.'),
  cue('a-44', 'attentional_wide', MD, "Find three things around you that you hadn't noticed yet."),
  cue('a-45', 'attentional_wide', MD, 'Feel the air moving past you and ride it easily.'),
  cue('a-46', 'attentional_wide', MD, 'Let the scenery do a little of the work now.'),
  cue('a-47', 'attentional_wide', MD, 'Widen your focus past your body to the world around you.'),
  cue('a-48', 'attentional_wide', MD, 'Watch the ground come to you and simply flow over it.'),
  cue('a-49', 'attentional_wide', MD, 'Give your attention to the light, the trees, the open road.'),
  cue('a-50', 'attentional_wide', MD, 'Drift a minute; let the distance pass almost unnoticed.'),
  cue('a-51', 'attentional_wide', MD, 'Look up. The effort feels smaller under a big sky.'),
  cue('a-52', 'attentional_wide', MD, 'Let your thoughts float free while your rhythm holds itself.'),

  // — chunking: near targets, segmenting (§5) —
  cue('a-53', 'chunking', MF, 'Forget the finish. Just run to the next bend.'),
  cue('a-54', 'chunking', MF, 'Break it down. Your only job is this minute.'),
  cue('a-55', 'chunking', MF, "Run to that far tree; we'll pick the next one there."),
  cue('a-56', 'chunking', MF, 'Think in tens: ten easy strides, then ten more.'),
  cue('a-57', 'chunking', MF, 'One segment at a time is how long runs get short.'),
  cue('a-58', 'chunking', MF, 'Give me the next five minutes. Nothing beyond that yet.'),
  cue('a-59', 'chunking', MF, 'Reach the top of this rise, then reset and go again.'),
  cue('a-60', 'chunking', MF, 'The whole run is just a chain of small, doable pieces.'),
  cue('a-61', 'chunking', MF, 'Focus only on the ground between here and that marker.'),
  cue('a-62', 'chunking', MF, 'Shrink the task: right now, one step, then the next.'),

  // — identity_values: who you are / why you run (§5) —
  cue('a-63', 'identity_values', DFC, 'This is who you are now. Someone who shows up.'),
  cue('a-64', 'identity_values', DFC, "Every steady step adds to the runner you're turning into."),
  cue('a-65', 'identity_values', DFC, 'Remember why you laced up today. Let that reason lead.'),
  cue('a-66', 'identity_values', DFC, "You're building something quiet and durable out here."),
  cue('a-67', 'identity_values', DFC, 'Consistency is your signature. This run is you signing it.'),
  cue('a-68', 'identity_values', DFC, "You didn't come this far to only come this far."),
  cue('a-69', 'identity_values', DFC, 'The person you want to be is made on days like this.'),
  cue('a-70', 'identity_values', DFC, "You're proving something to yourself, and it's working."),
  cue('a-71', 'identity_values', DFC, 'This is your practice, your discipline, your ground to stand on.'),
  cue('a-72', 'identity_values', DFC, 'Future you is watching. Give them something to be proud of.'),
  cue('a-73', 'identity_values', DFC, "You're not just running. You're keeping a promise."),
  cue('a-74', 'identity_values', DFC, "Show yourself again what you're actually made of."),

  // — arousal_regulation: long exhale, relax, smile (§5) —
  cue('a-75', 'arousal_regulation', OMDF, 'Take one long, slow breath out and let your pace ease.'),
  cue('a-76', 'arousal_regulation', OMDF, 'Soften your face. A small smile makes the miles cheaper.'),
  cue('a-77', 'arousal_regulation', OMDF, "Relax your hands as if holding a crisp you won't break."),
  cue('a-78', 'arousal_regulation', OMDF, 'Lengthen the exhale and feel your whole system settle.'),
  cue('a-79', 'arousal_regulation', OMDF, 'Let a small smile in; your body reads it as safety.'),
  cue('a-80', 'arousal_regulation', OMDF, 'Unclench your jaw and let your breathing grow quieter.'),
  cue('a-81', 'arousal_regulation', OMDF, 'Slow the breath, calm the mind, and the legs follow.'),
  cue('a-82', 'arousal_regulation', OMDF, 'Shoulders down, chest open, breathe low and slow.'),
  cue('a-83', 'arousal_regulation', OMDF, 'Smile like you mean it and watch the effort shrink.'),
  cue('a-84', 'arousal_regulation', OMDF, 'Loosen your grip, loosen your face, loosen the whole stride.'),
  cue('a-85', 'arousal_regulation', OMDF, "Exhale the tension you didn't know you were carrying."),
  cue('a-86', 'arousal_regulation', OMDF, 'In for three, out for four. Stay smooth.'),
  cue('a-87', 'arousal_regulation', OMDF, 'Ease the shoulders down. Nothing here needs forcing.'),
  cue('a-88', 'arousal_regulation', OMDF, 'Let the next breath be slower than the last.'),

  // — gratitude_awe: privilege of moving, surroundings (§5) —
  cue('a-89', 'gratitude_awe', OMDC, 'Your body gets to do this today. Not everyone can.'),
  cue('a-90', 'gratitude_awe', OMDC, 'Feel lucky for legs that carry you and lungs that fill.'),
  cue('a-91', 'gratitude_awe', OMDC, 'Take a second to thank the quiet, the space, the light.'),
  cue('a-92', 'gratitude_awe', OMDC, 'This freedom to move is a gift. Enjoy spending it.'),
  cue('a-93', 'gratitude_awe', OMDC, "You once wished for exactly this. You're living it now."),
  cue('a-94', 'gratitude_awe', OMDC, 'Notice how good it is to simply be out here moving.'),
  cue('a-95', 'gratitude_awe', OMDC, 'Let a little awe in at what your body quietly manages.'),
  cue('a-96', 'gratitude_awe', OMDC, 'Be grateful for the road, the air, and the chance.'),
  cue('a-97', 'gratitude_awe', OMDC, 'This hour is yours. Few things are so completely yours.'),
  cue('a-98', 'gratitude_awe', OMDC, 'Appreciate the machine beneath you doing extraordinary, ordinary work.'),

  // — process_goal_progress: banked, irreversible progress (§5) —
  cue('a-99', 'process_goal_progress', MD, "You're past the hard start. Momentum is on your side now."),
  cue('a-100', 'process_goal_progress', MD, 'Halfway is closer than the start. The scale just tipped.'),
  cue('a-101', 'process_goal_progress', MDF, 'Every minute banked is a minute you never repeat.'),
  cue('a-102', 'process_goal_progress', MDF, "You're further along than last time you checked. Keep adding."),
  cue('a-103', 'process_goal_progress', DF, "The work is already done; now you're just collecting it."),
  cue('a-104', 'process_goal_progress', DF, 'Look how much is behind you. Let it carry the rest.'),
  cue('a-105', 'process_goal_progress', DF, 'You made the deposit. This last part is the interest.'),
  cue('a-106', 'process_goal_progress', DF, 'More is finished than remains. Ride that math home.'),
  cue('a-107', 'process_goal_progress', MD, "Settle in. You're in the strong middle of your effort."),
  cue('a-108', 'process_goal_progress', F, 'The distance behind you is proof. The distance ahead is small.'),

  // — identity_long_game: long game lines (§6) — early (settle) 1–6 —
  cue('lg-1', 'identity_long_game', O, "Starting was the hard part, and it's done. Now just keep moving."),
  cue('lg-2', 'identity_long_game', O, 'This hour is yours. Nobody handed it to you. You claimed it.'),
  cue('lg-3', 'identity_long_game', O, "Let the first ten minutes be humble. That's the plan working."),
  cue('lg-4', 'identity_long_game', O, "You're not chasing a pace. You're building an engine."),
  cue('lg-5', 'identity_long_game', O, "There's no ego in a heart rate. Let the number lead."),
  cue('lg-6', 'identity_long_game', O, 'You get to run today. Start there.'),
  // aerobic patience 7–12 (early/mid)
  cue('lg-7', 'identity_long_game', OM, 'Slow is the strategy. Let everyone else sprint past.'),
  cue('lg-8', 'identity_long_game', OM, 'Patience is the workout today. Base now, speed later.'),
  cue('lg-9', 'identity_long_game', OM, 'The prize goes to the one who slows down the least.'),
  cue('lg-10', 'identity_long_game', OM, 'Each unhurried kilometer is a deposit. Endurance pays compound interest.'),
  cue('lg-11', 'identity_long_game', OM, 'Months from now, this effort carries a faster pace. Trust the curve.'),
  cue('lg-12', 'identity_long_game', OM, "You're widening the base of the pyramid. The peak comes later."),
  // presence 13–17 (mid)
  cue('lg-13', 'identity_long_game', MD, 'This is your moving meditation. Let thoughts pass like mile markers.'),
  cue('lg-14', 'identity_long_game', MD, 'Breath, footfall, breath. That rhythm is the whole practice.'),
  cue('lg-15', 'identity_long_game', MD, "The destination is an illusion. There's only this stretch of road."),
  cue('lg-16', 'identity_long_game', MD, 'Some of your best ideas are waiting a few kilometers ahead.'),
  cue('lg-17', 'identity_long_game', MD, 'Calm head, loose shoulders. The legs know what to do.'),
  // identity 18–23 (mid)
  cue('lg-18', 'identity_long_game', MD, "You're becoming the kind of person who shows up. Today counts."),
  cue('lg-19', 'identity_long_game', MD, "Every step proves you're the athlete you said you'd be."),
  cue('lg-20', 'identity_long_game', MD, "You're sitting on reservoirs of potential you haven't touched yet."),
  cue('lg-21', 'identity_long_game', MD, "This run is anonymous work. That's exactly why it matters."),
  cue('lg-22', 'identity_long_game', MD, "Nobody's watching. You came anyway. That's the whole game."),
  cue('lg-23', 'identity_long_game', MD, "You're not just training a body. You're authoring a comeback."),
  // long game 24–28 (mid)
  cue('lg-24', 'identity_long_game', MD, 'The tortoise wins. Keep being the tortoise.'),
  cue('lg-25', 'identity_long_game', MD, 'One run feels small. Years of them change everything. Stay in it.'),
  cue('lg-26', 'identity_long_game', MD, 'Little things done daily beat big things done once. This is a little thing.'),
  cue('lg-27', 'identity_long_game', MD, 'Pay now. Love it later.'),
  cue('lg-28', 'identity_long_game', MD, "Consistency is the only superpower on offer. And it's already yours."),
  // discomfort 29–33 (mid/late)
  cue('lg-29', 'identity_long_game', MDF, 'Discomfort is information, not a verdict. Listen, then keep moving.'),
  cue('lg-30', 'identity_long_game', MDF, 'This is the rich texture a shortcut would have robbed you of.'),
  cue('lg-31', 'identity_long_game', MDF, 'Pain can be a teacher. Stay a student a little longer.'),
  cue('lg-32', 'identity_long_game', MDF, 'Hard is the point. Easy never changed anyone.'),
  cue('lg-33', 'identity_long_game', MDF, 'This difficulty is the curriculum, not the interruption.'),
  // self-compassion 34–37 (any, esp. post-pause/fade)
  cue('lg-34', 'identity_long_game', ANY, "A rough patch isn't failure. It's part of the change."),
  cue('lg-35', 'identity_long_game', ANY, "Don't flog yourself over one slow split. The game is long."),
  cue('lg-36', 'identity_long_game', ANY, 'Kindness toward yourself takes more courage than criticism. Practice here.'),
  cue('lg-37', 'identity_long_game', ANY, 'A bad run finished is still a success. Maybe the best kind.'),
  // late intensity 38–43 (final third ONLY; lg-38 max once per run)
  cue('lg-38', 'identity_long_game', F, 'Feeling done is a guess, not a fact. You have more than you think.'),
  cue('lg-39', 'identity_long_game', F, 'The only way out is through. One foot, then the other.'),
  cue('lg-40', 'identity_long_game', F, "You've been here before, and you finished. You know how this ends."),
  cue('lg-41', 'identity_long_game', F, 'Steady head, steady breath. Now see what your legs still have.'),
  cue('lg-42', 'identity_long_game', F, "Love the pain a little. It's loving you back with fitness."),
  cue('lg-43', 'identity_long_game', F, 'This low is weather. Stay steady and let it blow through.'),
  // finishing 44–47 (closing)
  cue('lg-44', 'identity_long_game', C, "End with something left. That's how you guarantee the next run."),
  cue('lg-45', 'identity_long_game', C, 'Celebrate this one. Recovery starts with giving yourself credit.'),
  cue('lg-46', 'identity_long_game', C, "That's another brick laid. The cathedral takes years. You're on schedule."),
  cue('lg-47', 'identity_long_game', C, 'You did the thing. Notice how much better you feel than when you started.'),
];

/**
 * Phase → category emphasis (§2). Weight 0/absent = not scheduled in that
 * phase (signal fires may still reach the category via line-level phases).
 */
const PHASE_CATEGORY_WEIGHTS: Record<RunPhase, Partial<Record<PsychCueCategory, number>>> = {
  opening: {
    arousal_regulation: 1,
    attentional_narrow: 1,
    self_talk_motivational: 0.7,
    gratitude_awe: 0.7,
    identity_long_game: 0.8,
  },
  middle: {
    attentional_wide: 1,
    chunking: 0.8,
    gratitude_awe: 0.8,
    process_goal_progress: 0.8,
    identity_long_game: 0.8,
    attentional_narrow: 0.5,
    effort_reappraisal: 0.4,
    self_talk_motivational: 0.4,
    arousal_regulation: 0.3,
  },
  doldrums: {
    identity_values: 1,
    identity_long_game: 1,
    attentional_wide: 0.9,
    process_goal_progress: 0.9,
    self_talk_motivational: 0.8,
    gratitude_awe: 0.6,
  },
  final: {
    self_talk_motivational: 1,
    effort_reappraisal: 0.9,
    identity_long_game: 0.9,
    chunking: 0.8,
    arousal_regulation: 0.7,
    identity_values: 0.7,
  },
  closing: {
    self_talk_motivational: 1,
    identity_long_game: 1,
    identity_values: 0.9,
    gratitude_awe: 0.8,
  },
};

/** Signal → category preference order (§2); first category with a fresh line wins. */
const SIGNAL_CATEGORY_ORDER: Record<PsychSignal, readonly PsychCueCategory[]> = {
  hr_drift: ['arousal_regulation', 'attentional_narrow', 'effort_reappraisal'],
  pace_fade: ['self_talk_motivational', 'process_goal_progress', 'chunking'],
  climb: ['chunking', 'attentional_narrow', 'effort_reappraisal'],
  post_pause: ['self_talk_motivational', 'attentional_narrow', 'chunking'],
};

/**
 * Phase by fraction of planned duration (§2): opening 0–20%, middle 20–60%,
 * doldrums 60–70%, final 70–95%, closing last 5%. Without a planned duration
 * the boundaries assume a 60-minute session and `closing` is unreachable —
 * the end of an open-ended run is unknowable.
 */
export function runPhase(elapsedMs: number, plannedDurationMs?: number | null): RunPhase {
  if (plannedDurationMs && plannedDurationMs > 0) {
    const frac = elapsedMs / plannedDurationMs;
    if (frac >= 0.95) return 'closing';
    if (frac >= 0.7) return 'final';
    if (frac >= 0.6) return 'doldrums';
    if (frac >= 0.2) return 'middle';
    return 'opening';
  }
  const min = elapsedMs / 60_000;
  if (min >= 42) return 'final';
  if (min >= 36) return 'doldrums';
  if (min >= 12) return 'middle';
  return 'opening';
}

export interface SelectPsychCueInput {
  elapsedMs: number;
  plannedDurationMs: number | null;
  signal: PsychSignal | null;
  /** Line ids already spoken this run — a line never repeats (§3.1). */
  usedLineIds: ReadonlySet<string>;
  /** Category of the previous psych cue — never back-to-back (§3.3). */
  lastCategory: string | null;
  /** Category → elapsedMs when last used, for the cooldown clock (§3.4). */
  categoryLastUsedAt: ReadonlyMap<string, number>;
  /** Texts of the last two spoken cues, for the stem-word guard (§3.6). */
  recentLineTexts: readonly string[];
  /** Whether the once-per-run signature line already fired (§6, §7). */
  signatureUsed: boolean;
  /** Injectable randomness for deterministic tests. */
  rand?: () => number;
}

/**
 * Pick the next psych cue, or null when nothing eligible remains (silence is
 * coaching — §7). Scheduled picks weight categories by phase, cooldown, and
 * recency (§3.5); signal picks walk the §2 preference order and bypass the
 * cooldown, but every pick updates the caller's category clock.
 */
export function selectPsychCue(input: SelectPsychCueInput): PsychCueLine | null {
  const rand = input.rand ?? Math.random;
  const phase = runPhase(input.elapsedMs, input.plannedDurationMs);
  const recentStems = input.recentLineTexts.slice(-2).map(stemWords);

  const eligibleLines = (category: PsychCueCategory): PsychCueLine[] =>
    PSYCH_CUE_LINES.filter(
      (line) =>
        line.category === category &&
        line.phases.includes(phase) &&
        !input.usedLineIds.has(line.id) &&
        !(line.id === SIGNATURE_LINE_ID && input.signatureUsed) &&
        !sharesStem(stemWords(line.text), recentStems)
    );

  if (input.signal) {
    for (const category of SIGNAL_CATEGORY_ORDER[input.signal]) {
      if (category === input.lastCategory) continue;
      const lines = eligibleLines(category);
      if (lines.length > 0) return pickUniform(lines, rand);
    }
    // Signal ordering exhausted → graceful fallback to the scheduled picker.
  }

  const cooldownMs =
    phase === 'doldrums' ? DOLDRUMS_CATEGORY_COOLDOWN_MS : CATEGORY_COOLDOWN_MS;
  const weights = PHASE_CATEGORY_WEIGHTS[phase];

  interface Candidate {
    score: number;
    lines: PsychCueLine[];
  }

  const buildCandidates = (respectCooldown: boolean, respectWeights: boolean): Candidate[] => {
    const out: Candidate[] = [];
    for (const category of PSYCH_CUE_CATEGORIES) {
      if (category === input.lastCategory) continue;
      const weight = respectWeights ? (weights[category] ?? 0) : 1;
      if (weight <= 0) continue;
      const lastUsedAt = input.categoryLastUsedAt.get(category);
      const sinceUse = lastUsedAt === undefined ? Infinity : input.elapsedMs - lastUsedAt;
      if (respectCooldown && sinceUse < cooldownMs) continue;
      const lines = eligibleLines(category);
      if (lines.length === 0) continue;
      // Recency factor of §3.5: fully fresh categories score highest, ones
      // just past cooldown score about half.
      const recency = sinceUse === Infinity ? 1 : Math.min(1, sinceUse / (cooldownMs * 2));
      out.push({ score: weight * Math.max(0.25, recency), lines });
    }
    return out;
  };

  // §3.7 graceful fallback: relax the cooldown first, then the phase weights.
  // Never the same category twice in a row, never a used line, never a line
  // outside its phases.
  const candidates =
    [buildCandidates(true, true), buildCandidates(false, true), buildCandidates(false, false)].find(
      (tier) => tier.length > 0
    ) ?? null;
  if (!candidates) return null;

  const total = candidates.reduce((sum, candidate) => sum + candidate.score, 0);
  let roll = rand() * total;
  let chosen: Candidate | null = null;
  for (const candidate of candidates) {
    roll -= candidate.score;
    if (roll <= 0) {
      chosen = candidate;
      break;
    }
  }
  // Float drift can leave roll a hair above zero after the loop.
  chosen ??= candidates[candidates.length - 1] ?? null;
  return chosen ? pickUniform(chosen.lines, rand) : null;
}

function pickUniform(lines: readonly PsychCueLine[], rand: () => number): PsychCueLine | null {
  return lines[Math.min(lines.length - 1, Math.floor(rand() * lines.length))] ?? null;
}

// ---- stem-word guard (§3.6) ------------------------------------------------

/** Function/filler words that never count as a repeated stem. */
const STEM_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'so', 'that', 'this', 'these', 'those',
  'then', 'than', 'you', 'your', 'yours', 'youre', 'yourself', 'it', 'its',
  'itself', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do',
  'does', 'did', 'have', 'has', 'had', 'will', 'wont', 'would', 'should',
  'could', 'can', 'cant', 'cannot', 'dont', 'didnt', 'isnt', 'youve', 'youll',
  'theres', 'thats', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'as', 'by',
  'from', 'into', 'onto', 'out', 'up', 'down', 'over', 'under', 'off', 'not',
  'no', 'yes', 'let', 'lets', 'just', 'now', 'one', 'two', 'three', 'four',
  'five', 'ten', 'like', 'what', 'who', 'how', 'when', 'where', 'while',
  'until', 'again', 'here', 'there', 'they', 'them', 'their', 'we', 'us',
  'our', 'me', 'my', 'all', 'any', 'some', 'more', 'most', 'much', 'many',
  'only', 'still', 'even', 'ever', 'every', 'each', 'very', 'too', 'also',
  'if', 'because', 'about', 'which', 'right', 'get', 'gets', 'got', 'going',
  'keep', 'keeps', 'make', 'makes', 'made', 'feel', 'feels', 'feeling',
  'run', 'runs', 'running', 'runner', 'today', 'little', 'good', 'whole',
]);

function stemOf(word: string): string {
  for (const suffix of ['ing', 'ed', 's'] as const) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3 && !word.endsWith('ss')) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

function stemWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z']+/)) {
    const word = token.replace(/'/g, '');
    if (word.length < 4 || STEM_STOP_WORDS.has(word)) continue;
    const stem = stemOf(word);
    if (stem.length < 4 || STEM_STOP_WORDS.has(stem)) continue;
    out.add(stem);
  }
  return out;
}

function sharesStem(candidate: ReadonlySet<string>, recent: readonly ReadonlySet<string>[]): boolean {
  for (const stems of recent) {
    for (const stem of candidate) {
      if (stems.has(stem)) return true;
    }
  }
  return false;
}
