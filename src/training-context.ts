import type { ActivitySummary, ScheduledWorkout } from "./coros-api.js";
import type { AthleteProfile } from "./athlete-profile.js";

export interface ProposedCalendarItem {
  date: string;
  name: string;
  sportType: number;
  durationSeconds: number;
  sourceId?: string;
  ignoreIdInPlan?: string;
}

export interface TrainingContextInput {
  referenceDate: string;
  window: { startDate: string; endDate: string; lookbackDays: number; lookaheadDays: number };
  profile: AthleteProfile;
  activities: ActivitySummary[];
  planned: ScheduledWorkout[];
  proposed?: ProposedCalendarItem;
  sourceErrors?: Array<{ source: string; error: string }>;
}

type SportKind = "cycling" | "running" | "trail" | "strength" | "recovery" | "other";

function compact(value: string): string {
  return value.replaceAll("-", "").slice(0, 8);
}

function daysBetween(start: string, end: string): number {
  const parse = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.round((parse(compact(end)) - parse(compact(start))) / 86_400_000);
}

function kind(sportType: number, name = ""): SportKind {
  const normalized = name.toLowerCase();
  if (/(recuper|regener|recovery|movilidad|easy|suave)/i.test(normalized)) return "recovery";
  if ([2, 200, 201, 203, 204, 9807].includes(sportType)) return "cycling";
  if ([1, 100, 103].includes(sportType)) return "running";
  if (sportType === 102) return "trail";
  if ([4, 402].includes(sportType)) return "strength";
  return "other";
}

function keySession(item: { sportType: number; name: string; durationSeconds: number }): boolean {
  const itemKind = kind(item.sportType, item.name);
  if (/(fondo|long|espec|interval|umbral|threshold|tempo|sweet.?spot|vo2|test|race|compet)/i.test(item.name)) return true;
  if (itemKind === "cycling" && item.durationSeconds >= 3 * 3600) return true;
  if (["running", "trail"].includes(itemKind) && item.durationSeconds >= 90 * 60) return true;
  return false;
}

function demanding(item: { sportType: number; name: string; durationSeconds: number; trainingLoad?: number | null }): boolean {
  if (kind(item.sportType, item.name) === "recovery") return false;
  if ((item.trainingLoad ?? 0) >= 100) return true;
  return keySession(item) || /(intens|series|interval|umbral|threshold|tempo|sweet.?spot|vo2)/i.test(item.name);
}

function normalizedName(value: string | null): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

function planActualComparison(planned: ScheduledWorkout[], activities: ActivitySummary[], referenceDate: string) {
  const pastPlans = planned.filter((item) => item.date <= referenceDate);
  return pastPlans.map((plan) => {
    const sameDay = activities.filter((activity) => activity.date === plan.date);
    const exact = sameDay.find((activity) => normalizedName(activity.name) === normalizedName(plan.name));
    const compatible = exact ?? sameDay.find((activity) => kind(activity.sportType ?? 0, activity.name ?? "") === kind(plan.sportType, plan.name));
    return {
      date: plan.date,
      planned: { idInPlan: plan.idInPlan, name: plan.name, sportType: plan.sportType, durationSeconds: plan.duration },
      status: exact ? "matched_by_name" : compatible ? "matched_by_sport" : "not_matched",
      completed: compatible ? { activityId: compatible.activityId, name: compatible.name, sportType: compatible.sportType, durationSeconds: compatible.durationSeconds, trainingLoad: compatible.trainingLoad } : null,
      limitation: compatible && !exact ? "Same-day sport match is provisional; COROS did not provide an explicit plan/activity link." : null,
    };
  });
}

function residualStress(activities: ActivitySummary[], referenceDate: string) {
  return activities.flatMap((activity) => {
    const ageDays = daysBetween(activity.date, referenceDate);
    if (ageDays < 0 || ageDays > 3) return [];
    const duration = activity.durationSeconds ?? 0;
    const itemKind = kind(activity.sportType ?? 0, activity.name ?? "");
    let recoveryHours = 0;
    const bases: string[] = [];
    if (itemKind === "cycling" && duration >= 6 * 3600) { recoveryHours = 72; bases.push("cycling duration >= 6 h"); }
    else if (itemKind === "cycling" && duration >= 4 * 3600) { recoveryHours = 48; bases.push("cycling duration >= 4 h"); }
    if (itemKind === "trail" && duration >= 90 * 60) { recoveryHours = Math.max(recoveryHours, 72); bases.push("trail duration/eccentric exposure"); }
    else if (itemKind === "running" && duration >= 90 * 60) { recoveryHours = Math.max(recoveryHours, 48); bases.push("running impact duration"); }
    if ((activity.trainingLoad ?? 0) >= 150) { recoveryHours = Math.max(recoveryHours, 48); bases.push("COROS training load >= 150"); }
    if (itemKind === "strength") { recoveryHours = Math.max(recoveryHours, 36); bases.push("strength stress not represented by HR alone"); }
    if (!recoveryHours || ageDays * 24 >= recoveryHours) return [];
    return [{ activityId: activity.activityId, date: activity.date, name: activity.name, kind: itemKind, recoveryWindowHours: recoveryHours, elapsedCalendarHours: ageDays * 24, bases }];
  });
}

export function buildTrainingContextAnalysis(input: TrainingContextInput): Record<string, unknown> {
  const referenceDate = compact(input.referenceDate);
  const planned = [...input.planned].sort((a, b) => a.date.localeCompare(b.date) || a.sortNo - b.sortNo);
  const completed = [...input.activities].sort((a, b) => a.date.localeCompare(b.date));
  const proposed = input.proposed ? { ...input.proposed, date: compact(input.proposed.date) } : undefined;
  const issues: Array<{ severity: "block" | "warning" | "info"; code: string; message: string; evidence: Record<string, unknown> }> = [];

  if (proposed) {
    if ((input.sourceErrors ?? []).length > 0) {
      issues.push({
        severity: "block",
        code: "insufficient_context",
        message: "The calendar write cannot be evaluated safely because the complete activity/calendar context was not available.",
        evidence: { sourceErrors: input.sourceErrors },
      });
    }
    const targetKind = kind(proposed.sportType, proposed.name);
    const previousDay = new Date(Date.UTC(Number(proposed.date.slice(0, 4)), Number(proposed.date.slice(4, 6)) - 1, Number(proposed.date.slice(6, 8)) - 1)).toISOString().slice(0, 10).replaceAll("-", "");
    const priorPlans = planned.filter((item) => item.date === previousDay && item.idInPlan !== proposed.ignoreIdInPlan);
    const priorActual = completed.filter((item) => item.date === previousDay);
    const longPrior = [
      ...priorPlans.map((item) => ({ source: "planned", name: item.name, durationSeconds: item.duration, sportType: item.sportType })),
      ...priorActual.map((item) => ({ source: "completed", name: item.name ?? "Unnamed", durationSeconds: item.durationSeconds ?? 0, sportType: item.sportType ?? 0 })),
    ].find((item) => kind(item.sportType, item.name) === "cycling" && item.durationSeconds >= 5 * 3600);
    if (longPrior && targetKind !== "recovery") {
      issues.push({ severity: targetKind === "strength" || targetKind === "running" || targetKind === "trail" ? "block" : "warning", code: "post_long_recovery", message: `The proposed ${targetKind} session follows a cycling session of ${(longPrior.durationSeconds / 3600).toFixed(1)} h.`, evidence: longPrior });
    }
    const targetExisting = planned.filter((item) => item.date === proposed.date && item.idInPlan !== proposed.ignoreIdInPlan);
    if (targetExisting.length) issues.push({ severity: "warning", code: "same_day_stack", message: `The target day already contains ${targetExisting.length} planned workout(s).`, evidence: { workouts: targetExisting.map((item) => item.name) } });
    const targetCompleted = completed.filter((item) => item.date === proposed.date);
    if (targetCompleted.length) issues.push({ severity: "warning", code: "training_already_completed", message: "A completed activity already exists on the target date.", evidence: { activities: targetCompleted.map((item) => item.name) } });
    const nextKey = planned.find((item) => daysBetween(proposed.date, item.date) >= 0 && daysBetween(proposed.date, item.date) <= 2 && keySession({ sportType: item.sportType, name: item.name, durationSeconds: item.duration }));
    if (targetKind === "strength" && nextKey) issues.push({ severity: "warning", code: "strength_before_key_session", message: `Strength is placed within 48 h before key session '${nextKey.name}'.`, evidence: { keyDate: nextKey.date, keyDurationSeconds: nextKey.duration } });
    const previousDemanding = planned.find((item) => item.date === previousDay && demanding({ sportType: item.sportType, name: item.name, durationSeconds: item.duration }));
    if (previousDemanding && demanding(proposed)) issues.push({ severity: "warning", code: "consecutive_demanding_days", message: "The proposal creates consecutive demanding days.", evidence: { previous: previousDemanding.name } });
    if (input.profile.constraints.some((item) => item.id === "hip_cam") && ["running", "trail"].includes(targetKind)) {
      const recentImpact = completed.filter((item) => ["running", "trail"].includes(kind(item.sportType ?? 0, item.name ?? "")) && daysBetween(item.date, proposed.date) >= 0 && daysBetween(item.date, proposed.date) <= 2);
      if (recentImpact.length) issues.push({ severity: "warning", code: "impact_density_warning", message: "Running/trail impact is repeated within 48 h while an impact-sensitive constraint is active.", evidence: { recentImpact: recentImpact.map((item) => ({ date: item.date, name: item.name })) } });
    }
  }

  const blocks = issues.filter((item) => item.severity === "block");
  const warnings = issues.filter((item) => item.severity === "warning");
  return {
    engineVersion: "1",
    referenceDate,
    window: input.window,
    athleteProfile: input.profile,
    panorama: {
      completedActivities: completed,
      plannedWorkouts: planned,
      keyPlannedSessions: planned.filter((item) => keySession({ sportType: item.sportType, name: item.name, durationSeconds: item.duration })),
      planVsActual: planActualComparison(planned, completed, referenceDate),
      residualStress: residualStress(completed, referenceDate),
    },
    proposedChange: proposed ?? null,
    guard: {
      outcome: blocks.length ? "block" : warnings.length ? "warning" : "allow",
      canWrite: blocks.length === 0,
      issues,
      rule: "A block prevents the calendar write. Warnings remain visible but do not silently rewrite the athlete's plan.",
    },
    dataQuality: {
      activities: completed.length,
      plannedWorkouts: planned.length,
      sourceErrors: input.sourceErrors ?? [],
      limitations: [
        "Residual-stress windows are conservative coaching heuristics, not medical recovery predictions.",
        "Strength interference cannot be fully resolved without muscle groups, sets, resistance and effort.",
        "Plan/activity matching by same-day sport is provisional when COROS provides no explicit link.",
      ],
    },
  };
}
