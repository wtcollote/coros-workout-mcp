import type { AuthData } from "./types.js";
import {
  addDaysToScheduleDate,
  assignWorkoutToCalendar,
  fetchActivities,
  getWorkoutDetail,
  listScheduledWorkouts,
  moveScheduledWorkout,
  normalizeScheduleDate,
  type ScheduledWorkout,
} from "./coros-api.js";
import { loadAthleteProfile } from "./athlete-profile.js";
import { buildTrainingContextAnalysis, type ProposedCalendarItem } from "./training-context.js";

export async function analyzeTrainingContext(
  auth: AuthData,
  referenceDate: string,
  proposed?: ProposedCalendarItem,
  lookbackDays = 14,
  lookaheadDays = 14
): Promise<Record<string, unknown>> {
  const reference = normalizeScheduleDate(referenceDate);
  const startDate = addDaysToScheduleDate(reference, -lookbackDays);
  const endDate = addDaysToScheduleDate(reference, lookaheadDays);
  const names = ["activities", "calendar"] as const;
  const settled = await Promise.allSettled([
    fetchActivities(auth, startDate, reference, 1, 100),
    listScheduledWorkouts(auth, startDate, endDate),
  ]);
  const activityResult = settled[0].status === "fulfilled" ? settled[0].value : { activities: [], total: 0 };
  const planned = settled[1].status === "fulfilled" ? settled[1].value : [];
  const sourceErrors = settled.flatMap((result, index) => result.status === "rejected"
    ? [{ source: names[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
    : []);
  return buildTrainingContextAnalysis({
    referenceDate: reference,
    window: { startDate, endDate, lookbackDays, lookaheadDays },
    profile: loadAthleteProfile(),
    activities: activityResult.activities,
    planned,
    proposed,
    sourceErrors,
  });
}

export function requireWritableCalendarContext(validation: Record<string, unknown>, action: string): void {
  const guard = validation.guard as { canWrite?: boolean; issues?: unknown[] } | undefined;
  if (!guard?.canWrite) {
    throw new Error(`Professional calendar guard blocked ${action}: ${JSON.stringify(guard?.issues ?? [])}`);
  }
}

function numberField(record: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    const value = Number(record[name]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

export async function proposedWorkoutFromLibrary(auth: AuthData, workoutId: string, date: string): Promise<ProposedCalendarItem> {
  const detail = await getWorkoutDetail(auth, workoutId);
  return {
    date: normalizeScheduleDate(date),
    name: String(detail.name ?? `Workout ${workoutId}`),
    sportType: numberField(detail, ["sportType"]),
    durationSeconds: numberField(detail, ["estimatedTime", "duration"]),
    sourceId: workoutId,
  };
}

export async function validateWorkoutAssignment(auth: AuthData, workoutId: string, date: string): Promise<Record<string, unknown>> {
  const proposed = await proposedWorkoutFromLibrary(auth, workoutId, date);
  return analyzeTrainingContext(auth, proposed.date, proposed);
}

export async function guardedAssignWorkoutToCalendar(auth: AuthData, workoutId: string, date: string) {
  const validation = await validateWorkoutAssignment(auth, workoutId, date);
  const guard = validation.guard as { outcome: string; canWrite: boolean; issues: unknown[] };
  requireWritableCalendarContext(validation, "assignment");
  const assignment = await assignWorkoutToCalendar(auth, workoutId, date);
  return { ...assignment, coachingGuard: guard };
}

export function proposedFromScheduled(item: ScheduledWorkout, date: string): ProposedCalendarItem {
  return {
    date: normalizeScheduleDate(date),
    name: item.name,
    sportType: item.sportType,
    durationSeconds: item.duration,
    sourceId: item.workoutId,
    ignoreIdInPlan: item.idInPlan,
  };
}

export async function validateScheduledMove(auth: AuthData, sourceDate: string, idInPlan: string, newDate: string): Promise<Record<string, unknown>> {
  const source = await listScheduledWorkouts(auth, sourceDate, sourceDate);
  const item = source.find((candidate) => candidate.idInPlan === idInPlan);
  if (!item) throw new Error(`Scheduled entry ${idInPlan} not found on ${sourceDate}.`);
  return analyzeTrainingContext(auth, newDate, proposedFromScheduled(item, newDate));
}

export async function guardedMoveScheduledWorkout(auth: AuthData, sourceDate: string, idInPlan: string, newDate: string) {
  const validation = await validateScheduledMove(auth, sourceDate, idInPlan, newDate);
  const guard = validation.guard as { outcome: string; canWrite: boolean; issues: unknown[] };
  requireWritableCalendarContext(validation, "move");
  await moveScheduledWorkout(auth, sourceDate, idInPlan, newDate);
  return { moved: true, coachingGuard: guard };
}
