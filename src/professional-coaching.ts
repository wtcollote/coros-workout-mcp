import type { ActivitySummary, DailyMetricRecord, HrvRecord, ScheduledWorkout, SleepRecord } from "./coros-api.js";
import { analyzeActivityContext } from "./activity-context.js";
import { buildMultisportLoadReport } from "./performance-calibration.js";
import { COACHING_KNOWLEDGE_LAST_REVIEWED, COACHING_KNOWLEDGE_VERSION, selectRelevantCoachingMethods } from "./coaching-methodology.js";

export type PrimaryDiscipline = "cycling" | "running" | "trail_running" | "ultra_endurance" | "multisport";
export type AnalysisScope = "daily" | "weekly" | "event_preparation" | "post_activity";

export interface ProfessionalCoachingInput {
  date: string;
  primaryDiscipline: PrimaryDiscipline;
  analysisScope: AnalysisScope;
  eventDate?: string;
  objective?: string;
  trainingPhase?: "base" | "build" | "specific" | "taper" | "recovery" | "unknown";
  methodologyPreference?: "polarized" | "pyramidal" | "threshold" | "block" | "mixed" | "unspecified";
  availableMinutes?: number;
  constraints: string[];
  subjective: {
    perceivedFatigue?: number;
    soreness?: number;
    pain?: number;
    sleepQuality?: number;
    illnessSymptoms?: boolean;
    notes?: string;
  };
}

export interface ProfessionalCoachingSources {
  sleep: SleepRecord[];
  hrv: HrvRecord[];
  dailyMetrics: DailyMetricRecord[];
  activities: ActivitySummary[];
  plannedWorkouts: ScheduledWorkout[];
  sourceErrors: Array<{ source: string; error: string }>;
  activitySource?: { returned: number; total: number; truncated: boolean };
}

type Decision = "stop_and_assess" | "recovery_or_rest" | "reduce" | "maintain" | "insufficient_data";

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function splitTrend<T>(records: T[], select: (record: T) => number | null): Record<string, unknown> {
  const values = records.map(select).filter((value): value is number => value != null && Number.isFinite(value));
  const recent = values.slice(-7);
  const previous = values.slice(-14, -7);
  const recentAverage = average(recent);
  const previousAverage = average(previous);
  return {
    recent7dAverage: recentAverage == null ? null : round(recentAverage),
    previous7dAverage: previousAverage == null ? null : round(previousAverage),
    changePercent: recentAverage == null || previousAverage == null || previousAverage === 0
      ? null
      : round((recentAverage - previousAverage) / previousAverage * 100),
    samples: values.length,
  };
}

function utcDaysBetween(start: string, end: string): number | null {
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) return null;
  const parse = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.round((parse(end) - parse(start)) / 86_400_000);
}

function disciplinePriorities(discipline: PrimaryDiscipline, constraints: string[]): string[] {
  const common = [
    "Judge the session against its purpose and the surrounding week, not as an isolated score.",
    "Use heart rate only in context: heat, dehydration, terrain, fatigue and sensor quality can alter it.",
  ];
  const specific: Record<PrimaryDiscipline, string[]> = {
    cycling: [
      "Prioritize aerobic durability, cadence control, climbing cost and late-session heart-rate drift.",
      "Do not infer power targets when reliable power data is absent; use known heart-rate zones, cadence and perceived effort.",
    ],
    running: [
      "Balance cardiovascular stimulus with impact exposure, tissue tolerance and recent running frequency.",
      "Interpret pace together with grade, surface, weather and heart rate; pace alone is not effort.",
    ],
    trail_running: [
      "Weight elevation, technical terrain and eccentric descent cost more heavily than road pace.",
      "Separate uphill effort, runnable terrain and descending tolerance when detailed data exists.",
    ],
    ultra_endurance: [
      "Prioritize durability, sustainable intensity, fueling tolerance, hydration, pacing discipline and recovery between long sessions.",
      "Evaluate time-on-feet or time-in-saddle, elevation, stops, night exposure and late-session efficiency when available.",
    ],
    multisport: [
      "Separate cardiovascular load from running impact, strength stress and low-intensity recovery work.",
      "Assess interference and sequencing between strength, running, trail and cycling sessions.",
    ],
  };
  const injury = constraints.length
    ? [`Apply the declared constraints (${constraints.join(", ")}); any reproduced or worsening pain overrides wearable readiness.`]
    : [];
  return [...specific[discipline], ...common, ...injury];
}

function actionGuidance(decision: Decision, planned: ScheduledWorkout[], completed: ActivitySummary[], input: ProfessionalCoachingInput): Record<string, unknown> {
  const plannedNames = planned.map((item) => item.name);
  const normalizedCompletedNames = new Set(completed.map((item) => (item.name ?? "").trim().toLocaleLowerCase()).filter(Boolean));
  const completedPlanned = planned.filter((item) => normalizedCompletedNames.has(item.name.trim().toLocaleLowerCase()));
  const remainingPlanned = planned.filter((item) => !completedPlanned.includes(item));
  const durationCap = input.availableMinutes ?? null;
  if (completedPlanned.length && remainingPlanned.length === 0) return {
    action: decision === "maintain"
      ? "Today's planned session appears completed. Do not repeat it; use the remainder of the day for normal recovery."
      : "Today's planned session appears completed. Do not repeat or compensate for it; apply the recovery warning to the remainder of today and reassess before the next session.",
    completedPlannedWorkouts: completedPlanned.map((item) => item.name),
    remainingPlannedWorkouts: [],
    nextStep: "Reassess subjective fatigue, pain/illness, sleep and warm-up response before the next planned workout.",
  };
  if (decision === "stop_and_assess") return {
    action: "Do not execute a hard or long session. Clarify symptoms and seek qualified assessment when pain, illness or neurological/cardiopulmonary warning signs are present.",
    calendarGuidance: "Do not automatically delete the workout; reschedule only after the athlete confirms the decision.",
    plannedWorkouts: plannedNames,
  };
  if (decision === "recovery_or_rest") return {
    action: "Choose complete rest or short symptom-free active recovery. Keep intensity conversational and stop if symptoms worsen.",
    volumeGuidance: planned.length ? "Replace the planned load rather than trying to compensate later in the week." : "No extra training is required to fill an empty calendar day.",
    durationCapMinutes: durationCap == null ? null : Math.min(durationCap, 60),
    plannedWorkouts: plannedNames,
  };
  if (decision === "reduce") return {
    action: "Preserve the session purpose only if it can be completed easily; otherwise convert it to aerobic endurance or active recovery.",
    volumeGuidance: "Use about 60% of planned duration and remove high-intensity repetitions; reassess during the warm-up.",
    plannedWorkouts: plannedNames,
  };
  if (decision === "maintain") return {
    action: planned.length ? "Proceed with the planned session, using the warm-up as a final readiness check." : "Recovery signals do not require a reduction, but no workout is invented when the calendar is empty.",
    volumeGuidance: durationCap == null ? "Respect the planned duration and purpose." : `Respect the planned purpose within the available ${durationCap} minutes.`,
    plannedWorkouts: plannedNames,
  };
  return {
    action: "Collect missing recovery and subjective information before making a confident training change.",
    plannedWorkouts: plannedNames,
  };
}

export function buildProfessionalCoachingAnalysis(
  input: ProfessionalCoachingInput,
  sources: ProfessionalCoachingSources
): Record<string, unknown> {
  const orderedSleep = [...sources.sleep].sort((a, b) => a.date.localeCompare(b.date));
  const orderedHrv = [...sources.hrv].sort((a, b) => a.date.localeCompare(b.date));
  const orderedMetrics = [...sources.dailyMetrics].sort((a, b) => a.date.localeCompare(b.date));
  const currentSleep = [...orderedSleep].reverse().find((item) => item.date <= input.date) ?? null;
  const currentHrv = [...orderedHrv].reverse().find((item) => item.date <= input.date) ?? null;
  const currentMetrics = [...orderedMetrics].reverse().find((item) => item.date <= input.date) ?? null;
  const currentHrvBaseline = currentHrv?.baseline ?? currentMetrics?.hrvBaseline ?? null;
  const restingBaseline = average(orderedMetrics.filter((item) => item.date < input.date).slice(-7).map((item) => item.restingHeartRate));
  const todayActivities = sources.activities.filter((item) => item.date === input.date);
  const analyzedActivities = sources.activities.map((activity) => analyzeActivityContext(activity));
  const todayAnalysis = analyzedActivities.filter((_, index) => sources.activities[index].date === input.date);
  const warnings: string[] = [];
  const favorable: string[] = [];
  const uncertainties: string[] = [];
  let severity = 0;
  let physiologicalSignals = 0;

  if (input.subjective.illnessSymptoms) {
    severity = 99;
    warnings.push("The athlete reports illness symptoms; subjective health overrides wearable metrics.");
  }
  if ((input.subjective.pain ?? 0) >= 7) {
    severity = 99;
    warnings.push(`Reported pain is high (${input.subjective.pain}/10).`);
  } else if ((input.subjective.pain ?? 0) >= 4) {
    severity += 4;
    warnings.push(`Reported pain is clinically relevant for training decisions (${input.subjective.pain}/10).`);
  } else if ((input.subjective.pain ?? 0) > 0) {
    severity += 1;
    warnings.push(`Pain is present (${input.subjective.pain}/10); location and response to warm-up matter.`);
  }
  if ((input.subjective.perceivedFatigue ?? 0) >= 8) {
    severity += 4;
    warnings.push(`Perceived fatigue is very high (${input.subjective.perceivedFatigue}/10).`);
  } else if ((input.subjective.perceivedFatigue ?? 0) >= 6) {
    severity += 2;
    warnings.push(`Perceived fatigue is elevated (${input.subjective.perceivedFatigue}/10).`);
  }
  if ((input.subjective.soreness ?? 0) >= 7) {
    severity += 2;
    warnings.push(`Muscle soreness is high (${input.subjective.soreness}/10).`);
  }
  if (currentSleep?.totalDurationMinutes != null) {
    physiologicalSignals++;
    if (currentSleep.totalDurationMinutes < 360) {
      severity += 2;
      warnings.push(`Latest sleep is below 6 h (${currentSleep.totalDurationMinutes} min).`);
    } else if (currentSleep.totalDurationMinutes < 420) {
      severity += 1;
      warnings.push(`Latest sleep is below 7 h (${currentSleep.totalDurationMinutes} min).`);
    } else favorable.push(`Latest sleep duration is ${currentSleep.totalDurationMinutes} min.`);
  }
  if (currentHrv?.average != null && currentHrvBaseline != null && currentHrvBaseline > 0) {
    physiologicalSignals++;
    const difference = (currentHrv.average / currentHrvBaseline - 1) * 100;
    if (difference < -20) {
      severity += 2;
      warnings.push(`Latest HRV is ${Math.abs(round(difference))}% below its COROS baseline.`);
    } else if (difference < -10) {
      severity += 1;
      warnings.push(`Latest HRV is ${Math.abs(round(difference))}% below its COROS baseline.`);
    } else favorable.push(`Latest HRV is within 10% of or above its COROS baseline (${round(difference)}%).`);
  }
  if (currentMetrics?.restingHeartRate != null && restingBaseline != null) {
    physiologicalSignals++;
    const difference = currentMetrics.restingHeartRate - restingBaseline;
    if (difference >= 8) {
      severity += 2;
      warnings.push(`Resting HR is ${round(difference)} bpm above the available seven-day average.`);
    } else if (difference >= 5) {
      severity += 1;
      warnings.push(`Resting HR is ${round(difference)} bpm above the available seven-day average.`);
    } else favorable.push("Resting HR does not cross the conservative elevation threshold.");
  }
  if (currentMetrics?.trainingLoadRatio != null) {
    physiologicalSignals++;
    if (currentMetrics.trainingLoadRatio > 1.5) {
      severity += 2;
      warnings.push(`COROS training-load ratio is high (${currentMetrics.trainingLoadRatio}).`);
    } else if (currentMetrics.trainingLoadRatio > 1.3) {
      severity += 1;
      warnings.push(`COROS training-load ratio is elevated (${currentMetrics.trainingLoadRatio}).`);
    } else favorable.push(`COROS training-load ratio does not cross 1.3 (${currentMetrics.trainingLoadRatio}).`);
  }

  const subjectiveSignals = Object.values(input.subjective).filter((value) => value !== undefined && value !== "").length;
  if (physiologicalSignals < 2) uncertainties.push("Fewer than two usable physiological recovery signals are available.");
  if (subjectiveSignals === 0) uncertainties.push("No subjective fatigue, soreness, pain, sleep-quality or illness input was supplied.");
  if (sources.activitySource?.truncated) uncertainties.push("The COROS activity list was truncated, so workload interpretation is incomplete.");
  for (const error of sources.sourceErrors) uncertainties.push(`${error.source}: ${error.error}`);
  if (analyzedActivities.some((item) => item.activityKind === "strength")) {
    uncertainties.push("Strength stress is only partially represented by cardiovascular training load; resistance, proximity to failure and muscle groups are required for a full muscular-load assessment.");
  }
  if (analyzedActivities.some((item) => ["trail-running", "hiking"].includes(item.activityKind))) {
    uncertainties.push("Trail/hiking summaries do not fully capture surface, technicality or eccentric descent damage.");
  }

  let decision: Decision;
  if (severity >= 99) decision = "stop_and_assess";
  else if (physiologicalSignals < 2 && subjectiveSignals === 0) decision = "insufficient_data";
  else if (severity >= 4) decision = "recovery_or_rest";
  else if (severity >= 2) decision = "reduce";
  else decision = "maintain";
  const confidence = sources.sourceErrors.length > 1 || physiologicalSignals < 2 || subjectiveSignals === 0
    ? "low"
    : sources.sourceErrors.length === 0 && physiologicalSignals >= 3 && subjectiveSignals >= 2
      ? "high"
      : "moderate";
  const daysToEvent = input.eventDate ? utcDaysBetween(input.date, input.eventDate) : null;
  const impactSessions = analyzedActivities.filter((item) => ["running", "trail-running", "hiking"].includes(item.activityKind)).length;
  const strengthSessions = analyzedActivities.filter((item) => item.activityKind === "strength").length;
  const recoverySessions = analyzedActivities.filter((item) => item.activeRecovery.candidate).length;
  const relevantMethods = selectRelevantCoachingMethods(input.primaryDiscipline, input.trainingPhase);

  return {
    framework: {
      role: "Professional endurance-coaching decision support for cycling, road running, trail running, strength integration and ultra-endurance.",
      hierarchy: ["reported pain or illness", "acute recovery", "multisport load and impact", "calendar and session purpose", "event proximity and sport specificity"],
      methodology: {
        knowledgeVersion: COACHING_KNOWLEDGE_VERSION,
        lastEvidenceReview: COACHING_KNOWLEDGE_LAST_REVIEWED,
        principles: ["specificity", "progressive overload", "recovery and adaptation", "individual response", "periodization", "durability", "skill and economy"],
        supportedModels: ["traditional/linear periodization", "block periodization", "polarized intensity distribution", "pyramidal intensity distribution", "threshold-focused blocks", "event-specific taper"],
        applicationRule: "No methodology is selected from fashion or a single metric. Use training phase, event demands, history, available time, injury tolerance and observed response.",
        historicalContext: "Classical volume/progression and periodization concepts are retained where useful, but recommendations must be updated by current evidence and the athlete's measured response.",
        relevantMethods: relevantMethods.map(({ id, name, category, evidenceStatus, currentUse, selectionSignals, cautions }) => ({ id, name, category, evidenceStatus, currentUse, selectionSignals, cautions })),
      },
      boundary: "This is coaching decision support, not medical diagnosis. Red flags and worsening pain require qualified clinical assessment.",
    },
    context: { ...input, daysToEvent },
    observedEvidence: {
      current: { sleep: currentSleep, hrv: currentHrv, dailyMetrics: currentMetrics, completedActivities: todayActivities, plannedWorkouts: sources.plannedWorkouts },
      trends: {
        sleepDuration: splitTrend(orderedSleep, (item) => item.totalDurationMinutes),
        sleepQuality: splitTrend(orderedSleep, (item) => item.qualityScore),
        hrv: splitTrend(orderedHrv, (item) => item.average),
        restingHeartRate: splitTrend(orderedMetrics, (item) => item.restingHeartRate),
        trainingLoad: splitTrend(orderedMetrics, (item) => item.trainingLoad),
        fatigueRate: splitTrend(orderedMetrics, (item) => item.fatigueRate),
        baseFitness: splitTrend(orderedMetrics, (item) => item.fitnessLevel),
      },
      workload: buildMultisportLoadReport(sources.activities),
      activityContext: {
        sessionsAnalyzed: analyzedActivities.length,
        impactSessions,
        strengthSessions,
        activeRecoveryCandidates: recoverySessions,
        today: todayAnalysis,
      },
      dataCoverage: {
        sleepDays: orderedSleep.length,
        hrvDays: orderedHrv.length,
        metricDays: orderedMetrics.length,
        activities: sources.activitySource ?? { returned: sources.activities.length, total: sources.activities.length, truncated: false },
        calendarItems: sources.plannedWorkouts.length,
      },
    },
    coachingInterpretation: {
      decision,
      confidence,
      severityIndex: { value: severity >= 99 ? null : severity, purpose: "Transparent rule tally, not a physiological readiness score." },
      warningEvidence: warnings,
      favorableEvidence: favorable,
      sportSpecificPriorities: disciplinePriorities(input.primaryDiscipline, input.constraints),
      eventContext: daysToEvent == null
        ? "No event date supplied; no taper or event-proximity conclusion is made."
        : daysToEvent < 0
          ? `The supplied event date passed ${Math.abs(daysToEvent)} days ago.`
          : `${daysToEvent} days to the event; interpret load against the event phase and objective, not by an automatic taper formula.`,
      methodologyApplication: input.methodologyPreference && input.methodologyPreference !== "unspecified"
        ? `The athlete supplied '${input.methodologyPreference}' as a preference. Treat it as context, not as an automatic prescription; retain it only when phase, sport demands, recovery and observed response support it.`
        : "No preferred methodology was imposed. Select the smallest effective method from the relevant catalog according to objective, phase, response and constraints.",
    },
    practicalRecommendation: actionGuidance(decision, sources.plannedWorkouts.filter((item) => item.date === input.date), todayActivities, input),
    uncertaintyAndMissingData: uncertainties,
    interpretationContract: [
      "Observed evidence is kept separate from coaching inference and recommendation.",
      "Missing values remain null and are never estimated.",
      "Subjective symptoms and declared constraints override apparently favorable wearable metrics.",
      "Calendar changes require a separate confirmed write operation.",
    ],
  };
}
