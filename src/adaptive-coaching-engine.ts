import type { ActivitySummary, DailyMetricRecord, HrvRecord, ScheduledWorkout, SleepRecord } from "./coros-api.js";
import type { AthleteProfile } from "./athlete-profile.js";

export type AdaptiveDecision = "stop_and_assess" | "rest" | "recover" | "reduce" | "maintain" | "progress" | "insufficient_data";
export type Confidence = "low" | "moderate" | "high";

export interface SubjectiveState {
  perceivedFatigue?: number;
  soreness?: number;
  pain?: number;
  sleepQuality?: number;
  illnessSymptoms?: boolean;
  motivation?: number;
  notes?: string;
}

export interface ObjectiveContext {
  name: string;
  eventDate?: string;
  priority?: "A" | "B" | "C";
  discipline?: string;
}

export interface AdaptiveEngineInput {
  date: string;
  profile: AthleteProfile;
  sleep: SleepRecord[];
  hrv: HrvRecord[];
  metrics: DailyMetricRecord[];
  activities: ActivitySummary[];
  planned: ScheduledWorkout[];
  subjective?: SubjectiveState;
  objective?: ObjectiveContext;
  sourceErrors?: Array<{ source: string; error: string }>;
}

export interface ProposedTrainingChange {
  date: string;
  name: string;
  sportType: number;
  durationSeconds: number;
  trainingLoadEstimate?: number | null;
  replacingIdInPlan?: string;
}

function round(value: number, digits = 1): number { return Number(value.toFixed(digits)); }
function compact(value: string): string { return value.replaceAll("-", ""); }
function avg(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function daysBetween(a: string, b: string): number {
  const parse = (v: string) => Date.UTC(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)));
  return Math.round((parse(compact(b)) - parse(compact(a))) / 86_400_000);
}
function addDays(value: string, days: number): string {
  const v = compact(value);
  const d = new Date(Date.UTC(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)) + days));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}
function sportKind(sportType: number, name = ""): string {
  const n = name.toLowerCase();
  if (n.includes("recuper")) return "recovery";
  if ([4, 402].includes(sportType)) return "strength";
  if ([1, 100].includes(sportType)) return "running";
  if ([102, 103].includes(sportType)) return "trail";
  if ([2, 200, 201, 202].includes(sportType)) return "cycling";
  if ([900].includes(sportType)) return "walking";
  return "other";
}

export function buildLongitudinalAthleteModel(input: AdaptiveEngineInput): Record<string, unknown> {
  const date = compact(input.date);
  const metrics = [...input.metrics].filter((m) => m.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const activities = [...input.activities].filter((a) => a.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const recentActivities = activities.filter((a) => daysBetween(a.date, date) <= 56);
  const endurance = recentActivities.filter((a) => ["cycling", "running", "trail"].includes(sportKind(a.sportType ?? 0, a.name ?? "")));
  const longSessions = endurance.filter((a) => (a.durationSeconds ?? 0) >= 3 * 3600);
  const weeklyLoads: number[] = [];
  for (let start = -55; start <= 0; start += 7) {
    const ws = addDays(date, start);
    const we = addDays(ws, 6);
    weeklyLoads.push(recentActivities.filter((a) => a.date >= ws && a.date <= we).reduce((sum, a) => sum + (a.trainingLoad ?? 0), 0));
  }
  const nonZeroLoads = weeklyLoads.filter((v) => v > 0);
  const hrvRatios = metrics.map((m) => m.hrvBaseline && m.avgSleepHrv ? m.avgSleepHrv / m.hrvBaseline : null).filter((v): v is number => v != null && Number.isFinite(v));
  const rhrValues = metrics.map((m) => m.restingHeartRate).filter((v): v is number => v != null && Number.isFinite(v));
  const loadRatios = metrics.map((m) => m.trainingLoadRatio).filter((v): v is number => v != null && Number.isFinite(v));
  const tlPerHour = endurance.map((a) => (a.durationSeconds ?? 0) > 0 ? (a.trainingLoad ?? 0) / ((a.durationSeconds ?? 1) / 3600) : null).filter((v): v is number => v != null && Number.isFinite(v));

  const samples = { metricDays: metrics.length, activities: recentActivities.length, enduranceActivities: endurance.length, longSessions: longSessions.length };
  const confidence: Confidence = metrics.length >= 28 && endurance.length >= 8 ? "high" : metrics.length >= 14 && endurance.length >= 4 ? "moderate" : "low";
  return {
    modelVersion: "2.1",
    asOfDate: date,
    confidence,
    samples,
    observedBaselines: {
      restingHeartRateMedian: median(rhrValues) == null ? null : round(median(rhrValues)!),
      hrvToBaselineMedian: median(hrvRatios) == null ? null : round(median(hrvRatios)!, 2),
      loadRatioMedian: median(loadRatios) == null ? null : round(median(loadRatios)!, 2),
      weeklyTrainingLoadMedian: median(nonZeroLoads) == null ? null : round(median(nonZeroLoads)!),
      enduranceLoadPerHourMedian: median(tlPerHour) == null ? null : round(median(tlPerHour)!),
      longestRecentSessionHours: longSessions.length ? round(Math.max(...longSessions.map((a) => (a.durationSeconds ?? 0) / 3600)), 2) : null,
    },
    disciplineExposure: Object.fromEntries(["cycling", "running", "trail", "strength", "walking", "other"].map((kind) => [kind, recentActivities.filter((a) => sportKind(a.sportType ?? 0, a.name ?? "") === kind).length])),
    learningContract: [
      "The model describes this athlete's observed history; it does not claim causation.",
      "Missing sensor fields remain missing and are not imputed.",
      "Thresholds for recommendations combine individual baselines with conservative safety guards.",
    ],
  };
}

export function buildAdaptiveCoachingDecision(input: AdaptiveEngineInput): Record<string, unknown> {
  const date = compact(input.date);
  const todayMetric = [...input.metrics].filter((m) => m.date <= date).sort((a,b)=>b.date.localeCompare(a.date))[0] ?? null;
  const todaySleep = [...input.sleep].filter((s) => s.date <= date).sort((a,b)=>b.date.localeCompare(a.date))[0] ?? null;
  const todayHrv = [...input.hrv].filter((h) => h.date <= date).sort((a,b)=>b.date.localeCompare(a.date))[0] ?? null;
  const recentMetrics = input.metrics.filter((m) => m.date < date && daysBetween(m.date, date) <= 14);
  const recentSleep = input.sleep.filter((s) => s.date < date && daysBetween(s.date, date) <= 14);
  const rhrBaseline = avg(recentMetrics.map((m) => m.restingHeartRate));
  const sleepBaseline = avg(recentSleep.map((s) => s.totalDurationMinutes));
  const hrvBaseline = todayHrv?.baseline ?? todayMetric?.hrvBaseline ?? avg(input.hrv.filter((h) => h.date < date).slice(-14).map((h) => h.average));
  const todayHrvValue = todayHrv?.average ?? todayMetric?.avgSleepHrv ?? null;
  const subjective = input.subjective ?? {};
  const warnings: string[] = [];
  const favorable: string[] = [];
  const uncertainty: string[] = [];
  let score = 0;

  if (input.sourceErrors?.length) uncertainty.push(...input.sourceErrors.map((e) => `${e.source}: ${e.error}`));
  if (subjective.illnessSymptoms) { warnings.push("Illness symptoms reported."); score += 100; }
  if ((subjective.pain ?? 0) >= 7) { warnings.push(`High pain reported (${subjective.pain}/10).`); score += 100; }
  else if ((subjective.pain ?? 0) >= 4) { warnings.push(`Meaningful pain reported (${subjective.pain}/10).`); score += 5; }
  if ((subjective.perceivedFatigue ?? 0) >= 8) { warnings.push(`Very high perceived fatigue (${subjective.perceivedFatigue}/10).`); score += 5; }
  else if ((subjective.perceivedFatigue ?? 0) >= 6) { warnings.push(`Elevated perceived fatigue (${subjective.perceivedFatigue}/10).`); score += 2; }

  if (todaySleep?.totalDurationMinutes != null && sleepBaseline != null) {
    const ratio = todaySleep.totalDurationMinutes / sleepBaseline;
    if (ratio < 0.65 || todaySleep.totalDurationMinutes < 300) { warnings.push("Sleep is severely below the athlete's recent baseline."); score += 5; }
    else if (ratio < 0.8) { warnings.push("Sleep is materially below the athlete's recent baseline."); score += 2; }
    else if (ratio >= 0.95) favorable.push("Sleep is close to or above the athlete's recent baseline.");
  } else uncertainty.push("Sleep baseline is incomplete.");

  if (todayHrvValue != null && hrvBaseline != null && hrvBaseline > 0) {
    const ratio = todayHrvValue / hrvBaseline;
    if (ratio < 0.8) { warnings.push("HRV is markedly below baseline."); score += 3; }
    else if (ratio < 0.9) { warnings.push("HRV is below baseline."); score += 1; }
    else if (ratio >= 1) favorable.push("HRV is at or above baseline.");
  } else uncertainty.push("HRV baseline is incomplete.");

  if (todayMetric?.restingHeartRate != null && rhrBaseline != null) {
    const delta = todayMetric.restingHeartRate - rhrBaseline;
    if (delta >= 8) { warnings.push("Resting heart rate is substantially above recent baseline."); score += 3; }
    else if (delta >= 5) { warnings.push("Resting heart rate is above recent baseline."); score += 1; }
    else if (delta <= 2) favorable.push("Resting heart rate is close to recent baseline.");
  }
  if ((todayMetric?.trainingLoadRatio ?? 0) >= 1.5) { warnings.push("Training-load ratio is high."); score += 3; }
  else if ((todayMetric?.trainingLoadRatio ?? 0) >= 1.3) { warnings.push("Training-load ratio is elevated."); score += 1; }

  const residual = input.activities.filter((a) => {
    const age = daysBetween(a.date, date);
    return age >= 0 && age <= 2 && (((a.durationSeconds ?? 0) >= 4 * 3600) || ((a.trainingLoad ?? 0) >= 180));
  });
  if (residual.length) { warnings.push("A long/high-load session remains inside a conservative 48-hour residual-stress window."); score += 2; }

  let decision: AdaptiveDecision;
  if (score >= 90) decision = "stop_and_assess";
  else if (score >= 7) decision = "rest";
  else if (score >= 4) decision = "recover";
  else if (score >= 2) decision = "reduce";
  else if (!todayMetric && !todaySleep && !todayHrv && Object.keys(subjective).length === 0) decision = "insufficient_data";
  else decision = "maintain";

  const objectiveDays = input.objective?.eventDate ? daysBetween(date, input.objective.eventDate) : null;
  const plannedToday = input.planned.filter((p) => p.date === date);
  const plannedNext3 = input.planned.filter((p) => { const d = daysBetween(date, p.date); return d >= 0 && d <= 3; });
  if (objectiveDays != null && objectiveDays >= 0 && objectiveDays <= 10 && decision === "maintain") {
    favorable.push("The event is close; maintaining freshness takes priority over adding unplanned load.");
  }

  const longitudinal = buildLongitudinalAthleteModel(input) as Record<string, any>;
  const confidence: Confidence = uncertainty.length === 0 && longitudinal.confidence === "high" ? "high" : longitudinal.confidence === "low" || uncertainty.length >= 2 ? "low" : "moderate";
  return {
    engineVersion: "2.1",
    date,
    decision,
    confidence,
    decisionScore: score,
    observedSignals: {
      sleepMinutes: todaySleep?.totalDurationMinutes ?? null,
      sleepBaselineMinutes: sleepBaseline == null ? null : round(sleepBaseline),
      hrv: todayHrvValue,
      hrvBaseline,
      restingHeartRate: todayMetric?.restingHeartRate ?? null,
      restingHeartRateBaseline: rhrBaseline == null ? null : round(rhrBaseline),
      trainingLoadRatio: todayMetric?.trainingLoadRatio ?? null,
      fatigueRate: todayMetric?.fatigueRate ?? null,
      residualStressActivities: residual.map((a) => ({ activityId: a.activityId, date: a.date, name: a.name, durationSeconds: a.durationSeconds, trainingLoad: a.trainingLoad })),
    },
    interpretation: { warningEvidence: warnings, favorableEvidence: favorable, uncertainty },
    calendarContext: { plannedToday, plannedNext3Days: plannedNext3, objective: input.objective ?? null, daysToObjective: objectiveDays },
    athleteModel: longitudinal,
    recommendation: decision === "stop_and_assess" ? "Do not prescribe a hard or long session until the reported symptoms are clarified."
      : decision === "rest" ? "Use rest today and protect the next key session; do not compensate the missed load later."
      : decision === "recover" ? "Prefer rest or short easy recovery work; avoid adding meaningful cardiovascular or impact load."
      : decision === "reduce" ? "Preserve the session purpose but reduce volume/intensity; use the warm-up as a final check."
      : decision === "maintain" ? (plannedToday.length ? "Maintain the planned purpose; do not add unplanned load." : "No reduction signal is strong enough to override the calendar, but no workout is invented on an empty day.")
      : "Collect missing recovery and subjective data before changing training confidently.",
    contract: "This is coaching decision support, not a medical diagnosis. It uses individual history where available and never invents missing metrics.",
  };
}

export function simulateTrainingChange(input: AdaptiveEngineInput, proposed: ProposedTrainingChange): Record<string, unknown> {
  const date = compact(input.date);
  const pdate = compact(proposed.date);
  const baseline = input.planned.filter((p) => daysBetween(date, p.date) >= 0 && daysBetween(date, p.date) <= 14);
  const replaced = proposed.replacingIdInPlan ? baseline.filter((p) => p.idInPlan !== proposed.replacingIdInPlan) : baseline;
  const projected = [...replaced, {
    planId: "simulation", idInPlan: "simulation", planProgramId: "simulation", sortNo: 999,
    workoutId: "simulation", date: pdate, name: proposed.name, sportType: proposed.sportType,
    duration: proposed.durationSeconds, distance: 0,
  } satisfies ScheduledWorkout].sort((a,b)=>a.date.localeCompare(b.date));
  const issues: Array<{ severity: "block" | "warning" | "info"; code: string; message: string }> = [];
  const sameDay = projected.filter((p) => p.date === pdate);
  if (sameDay.length > 1) issues.push({ severity: "warning", code: "same_day_stack", message: `The simulation leaves ${sameDay.length} planned sessions on ${pdate}.` });
  const previousDay = addDays(pdate, -1);
  const longPrior = [
    ...input.activities.filter((a) => a.date === previousDay).map((a) => ({ name: a.name ?? "activity", duration: a.durationSeconds ?? 0, kind: sportKind(a.sportType ?? 0, a.name ?? "") })),
    ...projected.filter((p) => p.date === previousDay).map((p) => ({ name: p.name, duration: p.duration, kind: sportKind(p.sportType, p.name) })),
  ].find((x) => x.kind === "cycling" && x.duration >= 5 * 3600);
  const proposedKind = sportKind(proposed.sportType, proposed.name);
  if (longPrior && !["recovery", "walking"].includes(proposedKind)) issues.push({ severity: ["strength","running","trail"].includes(proposedKind) ? "block" : "warning", code: "post_long_recovery", message: `The proposed ${proposedKind} session follows a ${round(longPrior.duration / 3600,1)} h ride.` });
  const objectiveDays = input.objective?.eventDate ? daysBetween(pdate, input.objective.eventDate) : null;
  if (objectiveDays != null && objectiveDays >= 0 && proposed.durationSeconds >= 3 * 3600) {
    const isPriorityA = input.objective?.priority === "A";
    if (isPriorityA && objectiveDays <= 10) issues.push({ severity: "block", code: "late_long_session", message: "A long session is blocked inside the final ten days before a priority-A objective unless the plan is deliberately redesigned outside this guard." });
    else if (objectiveDays <= 7) issues.push({ severity: "warning", code: "late_long_session", message: "A long session is proposed inside the final seven days before the objective." });
  }
  const baselineDuration = baseline.reduce((s,p)=>s+p.duration,0);
  const projectedDuration = projected.reduce((s,p)=>s+p.duration,0);
  const baselineEstimatedLoad = baseline.reduce((s,p)=>s + (p.duration / 3600) * 55, 0);
  const projectedEstimatedLoad = projected.reduce((s,p)=>s + (p.idInPlan === "simulation" && proposed.trainingLoadEstimate != null ? proposed.trainingLoadEstimate : (p.duration / 3600) * 55), 0);
  const blocks = issues.filter((i)=>i.severity === "block");
  const warnings = issues.filter((i)=>i.severity === "warning");
  return {
    engineVersion: "2.1.1",
    simulationOnly: true,
    referenceDate: date,
    proposedChange: { ...proposed, date: pdate, kind: proposedKind },
    baseline: { workoutCount: baseline.length, durationHours: round(baselineDuration / 3600, 2), heuristicLoad: round(baselineEstimatedLoad) },
    projected: { workoutCount: projected.length, durationHours: round(projectedDuration / 3600, 2), heuristicLoad: round(projectedEstimatedLoad), calendar: projected },
    delta: { durationHours: round((projectedDuration - baselineDuration)/3600, 2), heuristicLoad: round(projectedEstimatedLoad - baselineEstimatedLoad) },
    guard: { outcome: blocks.length ? "block" : warnings.length ? "warning" : "allow", canWrite: blocks.length === 0, issues },
    limitations: ["Projected training load is a planning heuristic unless an explicit estimate is supplied.", "Simulation does not write to COROS."],
  };
}

export function buildSeasonStrategy(input: AdaptiveEngineInput): Record<string, unknown> {
  const date = compact(input.date);
  const objective = input.objective ?? (input.profile.objectives[0] ? {
    name: input.profile.objectives[0].name,
    eventDate: input.profile.objectives[0].eventDate ?? undefined,
    discipline: input.profile.objectives[0].discipline,
    priority: "A" as const,
  } : undefined);
  const days = objective?.eventDate ? daysBetween(date, objective.eventDate) : null;
  let phase = "general_preparation";
  if (days != null) {
    if (days < 0) phase = "transition_recovery";
    else if (days <= 14) phase = "taper";
    else if (days <= 42) phase = "specific";
    else if (days <= 84) phase = "build";
    else phase = "base";
  }
  const prioritiesByPhase: Record<string,string[]> = {
    base: ["Aerobic volume consistency", "Strength foundation", "Technique/economy", "Avoid premature specificity"],
    build: ["Progressive overload", "Sport-specific intensity", "Maintain strength", "Protect recovery between key sessions"],
    specific: ["Event-specific durability", "Pacing/fueling rehearsal", "Terrain and environmental specificity", "Reduce non-specific fatigue"],
    taper: ["Reduce volume", "Preserve selected intensity", "Maximize freshness", "Avoid introducing new training stress"],
    transition_recovery: ["Recovery", "Low-pressure movement", "Review season response", "Delay structured build until recovered"],
    general_preparation: ["Build consistent routine", "Develop broad aerobic and strength capacity", "Define objectives before forcing periodization"],
  };
  return {
    engineVersion: "2.1",
    asOfDate: date,
    objective: objective ?? null,
    daysToObjective: days,
    inferredPhase: phase,
    priorities: prioritiesByPhase[phase],
    athleteModel: buildLongitudinalAthleteModel(input),
    planningPrinciples: [
      "The season strategy sets constraints for weekly planning; daily readiness does not replace long-term progression.",
      "Missed sessions are not automatically repaid later.",
      "Specificity increases as the objective approaches while unnecessary fatigue decreases.",
      "Strength, running impact and endurance cardiovascular load are tracked separately where data permits.",
    ],
  };
}

export function evaluatePriorDecision(args: {
  priorDecision: AdaptiveDecision;
  priorDate: string;
  evaluationDate: string;
  priorSignals?: Record<string, unknown>;
  currentMetrics: DailyMetricRecord[];
  activities: ActivitySummary[];
}): Record<string, unknown> {
  const priorDate = compact(args.priorDate);
  const evaluationDate = compact(args.evaluationDate);
  const after = args.currentMetrics.filter((m) => m.date > priorDate && m.date <= evaluationDate).sort((a,b)=>a.date.localeCompare(b.date));
  const activities = args.activities.filter((a) => a.date > priorDate && a.date <= evaluationDate);
  const first = after[0] ?? null;
  const last = after[after.length-1] ?? null;
  const loadAdded = activities.reduce((s,a)=>s+(a.trainingLoad ?? 0),0);
  const observations: string[] = [];
  if (first && last && first.trainingLoadRatio != null && last.trainingLoadRatio != null) {
    const delta = last.trainingLoadRatio - first.trainingLoadRatio;
    observations.push(delta < -0.1 ? "Load ratio declined after the decision window." : delta > 0.1 ? "Load ratio increased after the decision window." : "Load ratio remained broadly stable.");
  }
  if (first && last && first.restingHeartRate != null && last.restingHeartRate != null) {
    const delta = last.restingHeartRate - first.restingHeartRate;
    observations.push(delta <= -3 ? "Resting heart rate decreased across the evaluation window." : delta >= 3 ? "Resting heart rate increased across the evaluation window." : "Resting heart rate remained broadly stable.");
  }
  return {
    engineVersion: "2.1",
    priorDecision: args.priorDecision,
    priorDate,
    evaluationDate,
    observedAfterDecision: { metricDays: after.length, activities: activities.length, trainingLoadAdded: loadAdded, firstMetric: first, lastMetric: last },
    observations,
    verdict: after.length < 2 ? "insufficient_followup" : "observed_not_causal",
    learningRule: "The engine may use this result as evidence for future individual baselines, but it must not claim that the prior decision caused the observed change.",
  };
}
