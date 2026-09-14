import { getOfficialRecoveryNormalized } from "./official-oauth.js";
import { OfficialSleepSchema, resolveSleepRecords, sleepMetadata } from "./sleep-source.js";
import type { OfficialSleepRecord } from "./sleep-source.js";
import { z } from "zod";
import {
  addDaysToScheduleDate,
  deleteWorkout,
  fetchActivities,
  fetchDailyMetrics,
  fetchHrv,
  getValidAuth,
  listScheduledWorkouts,
  moveScheduledWorkout,
  normalizeScheduleDate,
  removeScheduledWorkout,
} from "./coros-api.js";
import { buildMultisportLoadReport, calibrateSportPerformance } from "./performance-calibration.js";
import { buildProfessionalCoachingAnalysis } from "./professional-coaching.js";
import { getCoachingMethodologyCatalog } from "./coaching-methodology.js";
import { loadAthleteProfile, publicAthleteProfile } from "./athlete-profile.js";
import { analyzeTrainingContext, guardedAssignWorkoutToCalendar, guardedMoveScheduledWorkout } from "./training-context-service.js";
import { buildAdaptiveCoachingDecision, buildLongitudinalAthleteModel, buildSeasonStrategy, evaluatePriorDecision, simulateTrainingChange } from "./adaptive-coaching-engine.js";
import { coachStateStorageInfo, readCoachState, updateCoachState } from "./coach-state.js";
import { buildAthleteIntelligence, buildRecoveryModel, buildResidualFatigueModel, buildSessionFingerprints, buildPerformanceTrend, buildDoseOptimizer, buildEventReadiness, buildAnomalyAndQuality } from "./athlete-intelligence.js";
import { trainingDataStatus, setupCheck, listProviderActivities, trainingTrends, compareActivities, importActivityFile } from "./providers/training-data-analytics.js";
import { getProviderActivity, weeklyTrainingSummary, trainingLoadBalance, activityAnomalies, personalBests, sportProgression, similarActivities, activityEfficiency, dataQualityReport, athleteSnapshot, routeCheckpointPlan, eventProjection } from "./providers/training-data-insights.js";

export const CONNECTOR_VERSION = "2.2.4";
export const EXPECTED_TOOL_COUNT = 56;
export const COMPATIBILITY_BRIDGE_VERSION = "2";

export const CONNECTOR_FEATURES = [
  "workout-library",
  "calendar",
  "sleep-hrv-recovery",
  "completed-activities",
  "general-activity-analysis",
  "active-recovery-analysis",
  "multisport-load",
  "personal-performance-calibration",
  "activity-export",
  "fit-analysis",
  "physiological-profile",
  "gpx-route-analysis",
  "route-weather",
  "ultra-simulation",
  "multisport-operational-route-planning",
  "aerobic-decoupling",
  "daily-adjustment",
  "fueling",
  "historical-comparison",
  "weekly-report",
  "workout-execution",
  "taper-readiness",
  "stable-compatibility-bridge",
  "professional-coaching-analysis",
  "coaching-methodology-catalog",
  "persistent-athlete-profile",
  "full-training-context",
  "professional-calendar-guard",
  "mobile-session-safe",
  "official-oauth-recovery-ingestion",
  "adaptive-coaching-engine",
  "longitudinal-athlete-learning",
  "season-strategy",
  "training-change-simulation",
  "decision-outcome-evaluation",
  "athlete-intelligence-suite",
  "personal-recovery-model",
  "residual-fatigue-model",
  "training-dose-optimizer",
  "session-fingerprints",
  "performance-trend-detection",
  "event-readiness-index",
  "anomaly-and-data-quality",
  "dashboard-snapshot",
  "persistent-coach-state",
  "coach-state-app-sync",
] as const;

type JsonObject = Record<string, unknown>;

interface OperationDescriptor {
  name: string;
  description: string;
  input: JsonObject;
  confirmation?: "CONFIRM" | "DELETE";
}

export const READ_OPERATIONS: OperationDescriptor[] = [
  { name: "get_provider_activity", description: "Read one activity detail from any provider implementing activity_detail.", input: { providerId: "coros|strava|garmin", activityId: "string", sportType: "optional integer" } },
  { name: "weekly_training_summary", description: "Summarize the current seven days and compare them with the previous four weeks.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD" } },
  { name: "training_load_balance", description: "Aggregate provider-supplied training load over configurable windows and by sport.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD", windows: "optional integer[]" } },
  { name: "activity_anomalies", description: "Flag statistically unusual training metrics within each sport without medical interpretation.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD", lookbackDays: "optional 14..365" } },
  { name: "personal_bests", description: "Find observed best distance, duration, elevation, average speed, average power and training load by sport.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD", lookbackDays: "optional 30..730" } },
  { name: "sport_progression", description: "Compare recent and prior halves of a lookback period separately by sport.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD", lookbackDays: "optional 28..365" } },
  { name: "similar_activities", description: "Find historically similar sessions within the same sport using normalized distance, duration, elevation and load differences.", input: { providerId: "coros|strava|garmin", activityId: "string", endDate: "YYYY-MM-DD", lookbackDays: "optional", limit: "optional 1..20" } },
  { name: "activity_efficiency", description: "Return derived speed/HR, power/HR, load/hour and elevation/hour efficiency metrics without inventing missing data.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD", lookbackDays: "optional" } },
  { name: "data_quality_report", description: "Report normalized activity field completeness before analysis.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD", lookbackDays: "optional" } },
  { name: "athlete_snapshot", description: "Return one provider-neutral current snapshot: latest activity, week, load, bests, progression, anomalies and data quality.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD" } },
  { name: "route_checkpoint_plan", description: "Build GPX checkpoints, timing scenarios and route plan using the existing operational route engine.", input: { gpx: "GPX XML string", startTimeIso: "ISO 8601 with timezone", options: "optional operational-route options" } },
  { name: "event_projection", description: "Project optimistic, probable and conservative event timing from a GPX route and activity type.", input: { gpx: "GPX XML string", startTimeIso: "ISO 8601 with timezone", activityType: "cycling|road_running|trail_running|walking|hiking", options: "optional operational-route options" } },
  { name: "training_data_status", description: "Return provider availability, capabilities and the default training-data provider without exposing secrets.", input: {} },
  { name: "setup_check", description: "Run a safe installation/configuration diagnostic for Node, COROS, optional providers and file analysis.", input: {} },
  { name: "list_training_providers", description: "List configured training-data providers, their availability and capabilities.", input: {} },
  { name: "list_provider_activities", description: "List normalized activities from any provider implementing the activities capability.", input: { providerId: "coros|strava|garmin", startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", page: "optional integer", size: "optional integer" } },
  { name: "training_trends", description: "Aggregate normalized training volume/load trends over configurable 7/28/90-style windows for any activity provider.", input: { providerId: "coros|strava|garmin", endDate: "YYYY-MM-DD", windows: "optional integer[] 1..365" } },
  { name: "compare_activities", description: "Compare up to 10 normalized activities from any activity provider using a first-activity baseline.", input: { providerId: "coros|strava|garmin", startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", activityIds: "optional string[]" } },
  { name: "import_activity_file", description: "Analyze a base64 FIT file and return detailed FIT analysis plus a neutral activity summary; no platform account required.", input: { fitBase64: "base64 FIT bytes", name: "optional display name" } },
  { name: "get_official_recovery", description: "Read current official COROS recovery using the existing stored official session.", input: {} },
  { name: "coach_state", description: "Return the persistent trainer state written by ChatGPT: daily assessment, current plan and recent trainer changes for the external app.", input: {} },
  { name: "connector_status", description: "Return server version, authentication and feature metadata.", input: {} },
  { name: "dashboard_snapshot", description: "Return one aggregated dashboard snapshot from a single COROS history fetch: athlete intelligence, adaptive coaching decision, calendar, season strategy and athlete model.", input: { date: "YYYY-MM-DD", objective: "optional object", plannedDurationSeconds: "optional positive number", officialSleepRecords: "optional normalized COROS MCP OAuth sleep records" } },
  { name: "athlete_intelligence", description: "Run the complete v2.1.1 Athlete Intelligence suite over COROS history: recovery response, residual fatigue, session fingerprints, performance trend, dose optimization, event readiness, anomalies and data quality.", input: { date: "YYYY-MM-DD", lookbackDays: "28..168 (optional; 112)", objective: "optional object", plannedDurationSeconds: "optional positive number", officialSleepRecords: "optional normalized COROS MCP OAuth sleep records" } },
  { name: "personal_recovery_model", description: "Learn observed 24/48/72h recovery response by session type from COROS history.", input: { date: "YYYY-MM-DD", lookbackDays: "28..168 (optional; 112)", officialSleepRecords: "optional normalized sleep records" } },
  { name: "residual_fatigue_model", description: "Estimate remaining planning stress from recent COROS activities using duration, load and sport impact.", input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", date: "YYYY-MM-DD" } },
  { name: "session_fingerprints", description: "Build personal fingerprints for cycling, running, trail, strength and walking sessions.", input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", date: "YYYY-MM-DD", lookbackDays: "28..168 (optional; 112)" } },
  { name: "performance_trend", description: "Compare recent and prior endurance performance separately by discipline; never mixes cycling/running/trail speeds.", input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", date: "YYYY-MM-DD", lookbackDays: "84 (recommended)" } },
  { name: "training_dose_optimizer", description: "Return a personalized dose factor and optional adjusted duration using residual stress and personal-baseline anomalies.", input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", date: "YYYY-MM-DD", plannedDurationSeconds: "optional positive number" } },
  { name: "event_readiness", description: "Build separate current and event-date projected readiness indices from COROS-derived state and objective proximity.", input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", date: "YYYY-MM-DD", objective: "optional object" } },
  { name: "anomaly_data_quality", description: "Detect deviations from personal baselines and expose source completeness before coaching decisions.", input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", date: "YYYY-MM-DD" } },

  {
    name: "adaptive_coaching_engine",
    description: "Run the v2 adaptive coaching engine. Combines individual baselines, recovery, recent load, residual stress, calendar context, subjective state and objective proximity into one explainable decision without writing to COROS.",
    input: {
      date: "YYYY-MM-DD",
      objective: "optional object: name, eventDate, priority A|B|C, discipline",
      subjective: "optional object: perceivedFatigue, soreness, pain, sleepQuality, illnessSymptoms, motivation, notes",
      officialSleepRecords: "optional normalized COROS MCP OAuth sleep records"
    },
  },
  {
    name: "longitudinal_athlete_model",
    description: "Build the v2 athlete-specific longitudinal model from observed history. Reports baselines and confidence without claiming causation.",
    input: { date: "YYYY-MM-DD", lookbackDays: "28..168 (optional; 84)", officialSleepRecords: "optional normalized COROS MCP OAuth sleep records" },
  },
  {
    name: "simulate_training_change",
    description: "Simulate one proposed calendar change across the next 14 days before writing it. Returns volume/load deltas and guard findings; never writes to COROS.",
    input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records",
      referenceDate: "YYYY-MM-DD", date: "YYYY-MM-DD", name: "string", sportType: "COROS sport integer", durationSeconds: "positive number", trainingLoadEstimate: "optional number", replacingIdInPlan: "optional string", objective: "optional object"
    },
  },
  {
    name: "season_strategy",
    description: "Build a long-horizon season strategy from the athlete profile, current history and an optional A/B/C objective. Daily readiness remains subordinate to long-term progression.",
    input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", date: "YYYY-MM-DD", objective: "optional object: name, eventDate, priority A|B|C, discipline" },
  },
  {
    name: "evaluate_prior_decision",
    description: "Evaluate what happened after a prior coaching decision. Reports observed follow-up only and explicitly avoids causal claims.",
    input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", priorDecision: "stop_and_assess|rest|recover|reduce|maintain|progress|insufficient_data", priorDate: "YYYY-MM-DD", evaluationDate: "YYYY-MM-DD" },
  },
  { name: "check_coros_auth", description: "Check whether the server currently has valid COROS authentication.", input: {} },
  { name: "get_hrv_data", description: "Read the recent COROS HRV series.", input: {} },
  { name: "get_sleep_data", description: "MANDATORY: first call COROS_MCP_2 querySleepData for the requested wake-up dates, normalize the official result, and pass it as officialSleepRecords; only report unavailable if that official read fails.", input: { officialSleepRecords: "optional normalized COROS MCP OAuth sleep records", startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" } },
  { name: "get_daily_metrics", description: "Read recovery, load and fitness metrics for a date range.", input: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" } },
  { name: "list_activities", description: "List completed COROS activities.", input: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", page: "integer 1..1000 (optional)", size: "integer 1..100 (optional)" } },
  { name: "list_scheduled_workouts", description: "List COROS calendar occurrences and their management IDs.", input: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" } },
  { name: "calibrate_sport_performance", description: "Fit planning speed/pace and ascent cost from comparable COROS activities.", input: { sport: "cycling | road_running | trail_running | walking | hiking", endDate: "YYYY-MM-DD", lookbackDays: "integer 30..365 (optional)" } },
  { name: "analyze_multisport_load", description: "Aggregate cardiovascular load, impact exposure, strength and active recovery.", input: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" } },
  {
    name: "professional_coaching_analysis",
    description: "Use this when COROS metrics need an exhaustive professional coaching interpretation for cycling, running, trail, strength integration or ultra-endurance. Separates evidence, inference, uncertainty and practical advice.",
    input: {
      date: "YYYY-MM-DD",
      primaryDiscipline: "cycling | running | trail_running | ultra_endurance | multisport (optional; persistent profile by default)",
      analysisScope: "daily | weekly | event_preparation | post_activity (optional; daily by default)",
      eventDate: "YYYY-MM-DD (optional)",
      objective: "string (optional)",
      trainingPhase: "base | build | specific | taper | recovery | unknown (optional)",
      methodologyPreference: "polarized | pyramidal | threshold | block | mixed | unspecified (optional)",
      availableMinutes: "positive integer (optional)",
      constraints: "string[] (optional; include known injuries or limitations)",
      subjective: "object (optional): perceivedFatigue 0..10, soreness 0..10, pain 0..10, sleepQuality 0..10, illnessSymptoms boolean, notes string",
      officialSleepRecords: "optional normalized records from COROS MCP OAuth: date, totalDurationMinutes, deepMinutes, lightMinutes, remMinutes, awakeMinutes, napMinutes, averageHeartRate, minimumHeartRate, maximumHeartRate, qualityScore",
    },
  },
  {
    name: "coaching_methodology_catalog",
    description: "Use this to inspect the versioned professional coaching knowledge base: historical and current methods, evidence maturity, sport/phase applicability, selection signals and cautions.",
    input: {
      sport: "cycling | running | trail_running | ultra_endurance | multisport (optional)",
      category: "foundation | periodization | intensity_distribution | session_method | strength | recovery | environment | monitoring (optional)",
      evidenceStatus: "established | context_dependent | emerging | historical (optional)",
    },
  },
  { name: "get_athlete_profile", description: "Use this when training analysis or planning needs the persistent server-side athlete profile rather than chat memory.", input: {} },
  {
    name: "training_context_analysis",
    description: "Use this before planning or changing training. Reviews completed work, residual stress, key sessions and plan-versus-actual across 14 days before and after the reference date.",
    input: { referenceDate: "YYYY-MM-DD", lookbackDays: "7..28 (optional; 14)", lookaheadDays: "7..28 (optional; 14)" },
  },
  {
    name: "validate_calendar_change",
    description: "Use this before a calendar write to validate one proposed workout against the full training panorama and persistent athlete constraints.",
    input: { date: "YYYY-MM-DD", name: "string", sportType: "COROS sport type integer", durationSeconds: "non-negative number", sourceId: "optional string", ignoreIdInPlan: "optional string when moving/replacing" },
  },
];

export const WRITE_OPERATIONS: OperationDescriptor[] = [
  { name: "update_coach_state", description: "Persist the trainer state that the external app displays. Use after a coaching assessment, recommendation or plan/calendar change.", input: { headline: "optional string", dailyAssessment: "optional object", currentPlan: "optional object", appendChange: "optional change object" }, confirmation: "CONFIRM" },
  { name: "assign_workout_to_calendar", description: "Assign an existing library workout after a fail-closed professional context check.", input: { workoutId: "string", date: "YYYY-MM-DD" }, confirmation: "CONFIRM" },
  { name: "move_scheduled_workout", description: "Move one scheduled occurrence after a fail-closed professional context check.", input: { sourceDate: "YYYY-MM-DD", idInPlan: "string", newDate: "YYYY-MM-DD" }, confirmation: "CONFIRM" },
  { name: "remove_scheduled_workout", description: "Remove one occurrence from the COROS calendar.", input: { planId: "string", idInPlan: "string", planProgramId: "string (optional)" }, confirmation: "DELETE" },
  { name: "delete_workout", description: "Delete one saved workout from the COROS library.", input: { workoutId: "string" }, confirmation: "DELETE" },
];

const DateRangeSchema = z.object({ startDate: z.string().min(1), endDate: z.string().min(1) });
const ListActivitiesSchema = DateRangeSchema.extend({
  page: z.number().int().min(1).max(1000).default(1),
  size: z.number().int().min(1).max(100).default(30),
});
const ProviderActivityDetailSchema = z.object({ providerId: z.string().min(1).default("coros"), activityId: z.string().min(1), sportType: z.number().int().optional() });
const ProviderEndDateSchema = z.object({ providerId: z.string().min(1).default("coros"), endDate: z.string().min(1) });
const LoadBalanceSchema = ProviderEndDateSchema.extend({ windows: z.array(z.number().int().min(1).max(365)).min(1).max(12).default([7,28,42]) });
const LookbackSchema = ProviderEndDateSchema.extend({ lookbackDays: z.number().int().min(14).max(730).optional() });
const SimilarActivitiesSchema = ProviderEndDateSchema.extend({ activityId: z.string().min(1), lookbackDays: z.number().int().min(30).max(730).default(365), limit: z.number().int().min(1).max(20).default(5) });
const RouteToolkitSchema = z.object({ gpx: z.string().min(1), startTimeIso: z.string().min(1), options: z.record(z.string(), z.unknown()).default({}) });
const EventProjectionSchema = RouteToolkitSchema.extend({ activityType: z.enum(["cycling","road_running","trail_running","walking","hiking"]).default("cycling") });
const ProviderActivitiesSchema = z.object({ providerId: z.string().min(1).default("coros"), startDate: z.string().min(1), endDate: z.string().min(1), page: z.number().int().min(1).max(1000).default(1), size: z.number().int().min(1).max(100).default(100) });
const TrainingTrendsSchema = z.object({ providerId: z.string().min(1).default("coros"), endDate: z.string().min(1), windows: z.array(z.number().int().min(1).max(365)).min(1).max(12).default([7,28,90]) });
const CompareActivitiesSchema = z.object({ providerId: z.string().min(1).default("coros"), startDate: z.string().min(1), endDate: z.string().min(1), activityIds: z.array(z.string().min(1)).max(10).optional() });
const ImportActivityFileSchema = z.object({ fitBase64: z.string().min(1), name: z.string().min(1).max(200).optional() });

const CalibrationSchema = z.object({
  sport: z.enum(["cycling", "road_running", "trail_running", "walking", "hiking"]),
  endDate: z.string().min(1),
  lookbackDays: z.number().int().min(30).max(365).default(90),
});
const ProfessionalCoachingSchema = z.object({
  date: z.string().min(1),
  primaryDiscipline: z.enum(["cycling", "running", "trail_running", "ultra_endurance", "multisport"]).optional(),
  analysisScope: z.enum(["daily", "weekly", "event_preparation", "post_activity"]).default("daily"),
  eventDate: z.string().min(1).optional(),
  objective: z.string().max(500).optional(),
  trainingPhase: z.enum(["base", "build", "specific", "taper", "recovery", "unknown"]).optional(),
  methodologyPreference: z.enum(["polarized", "pyramidal", "threshold", "block", "mixed", "unspecified"]).optional(),
  availableMinutes: z.number().int().positive().max(2880).optional(),
  constraints: z.array(z.string().min(1).max(200)).max(20).default([]),
  subjective: z.object({
    perceivedFatigue: z.number().min(0).max(10).optional(),
    soreness: z.number().min(0).max(10).optional(),
    pain: z.number().min(0).max(10).optional(),
    sleepQuality: z.number().min(0).max(10).optional(),
    illnessSymptoms: z.boolean().optional(),
    notes: z.string().max(1000).optional(),
  }).default({}),
  officialSleepRecords: OfficialSleepSchema,
});
const CoachingMethodologySchema = z.object({
  sport: z.enum(["cycling", "running", "trail_running", "ultra_endurance", "multisport"]).optional(),
  category: z.enum(["foundation", "periodization", "intensity_distribution", "session_method", "strength", "recovery", "environment", "monitoring"]).optional(),
  evidenceStatus: z.enum(["established", "context_dependent", "emerging", "historical"]).optional(),
});
const TrainingContextSchema = z.object({
  referenceDate: z.string().min(1),
  lookbackDays: z.number().int().min(7).max(28).default(14),
  lookaheadDays: z.number().int().min(7).max(28).default(14),
});
const ValidateCalendarSchema = z.object({
  date: z.string().min(1),
  name: z.string().min(1).max(200),
  sportType: z.number().int(),
  durationSeconds: z.number().nonnegative(),
  sourceId: z.string().optional(),
  ignoreIdInPlan: z.string().optional(),
});

const ObjectiveSchema = z.object({
  name: z.string().min(1).max(300),
  eventDate: z.string().min(1).optional(),
  priority: z.enum(["A", "B", "C"]).optional(),
  discipline: z.string().max(100).optional(),
}).optional();
const SubjectiveStateSchema = z.object({
  perceivedFatigue: z.number().min(0).max(10).optional(), soreness: z.number().min(0).max(10).optional(),
  pain: z.number().min(0).max(10).optional(), sleepQuality: z.number().min(0).max(10).optional(),
  illnessSymptoms: z.boolean().optional(), motivation: z.number().min(0).max(10).optional(), notes: z.string().max(1000).optional(),
}).optional();
const AdaptiveEngineSchema = z.object({ date: z.string().min(1), objective: ObjectiveSchema, subjective: SubjectiveStateSchema, officialSleepRecords: OfficialSleepSchema });
const LongitudinalSchema = z.object({ date: z.string().min(1), lookbackDays: z.number().int().min(28).max(168).default(84), officialSleepRecords: OfficialSleepSchema });
const SimulationSchema = z.object({ officialSleepRecords: OfficialSleepSchema, referenceDate: z.string().min(1), date: z.string().min(1), name: z.string().min(1), sportType: z.number().int(), durationSeconds: z.number().positive(), trainingLoadEstimate: z.number().nonnegative().nullable().optional(), replacingIdInPlan: z.string().optional(), objective: ObjectiveSchema });
const SeasonSchema = z.object({ officialSleepRecords: OfficialSleepSchema, date: z.string().min(1), objective: ObjectiveSchema });
const EvaluateDecisionSchema = z.object({ officialSleepRecords: OfficialSleepSchema, priorDecision: z.enum(["stop_and_assess","rest","recover","reduce","maintain","progress","insufficient_data"]), priorDate: z.string().min(1), evaluationDate: z.string().min(1) });
const DashboardSnapshotSchema = z.object({ date: z.string().min(1), objective: ObjectiveSchema, plannedDurationSeconds: z.number().positive().optional().default(3600), officialSleepRecords: OfficialSleepSchema });

const AssignSchema = z.object({ workoutId: z.string().min(1), date: z.string().min(1) });
const MoveSchema = z.object({ sourceDate: z.string().min(1), idInPlan: z.string().min(1), newDate: z.string().min(1) });
const RemoveSchema = z.object({ planId: z.string().min(1), idInPlan: z.string().min(1), planProgramId: z.string().min(1).optional() });
const DeleteSchema = z.object({ workoutId: z.string().min(1) });

function bridgeEnvelope(operation: string, result: unknown): JsonObject {
  return {
    bridgeVersion: COMPATIBILITY_BRIDGE_VERSION,
    connectorVersion: CONNECTOR_VERSION,
    operation,
    result,
  };
}

function unknownOperation(kind: "read" | "write", operation: string): never {
  const available = (kind === "read" ? READ_OPERATIONS : WRITE_OPERATIONS).map((item) => item.name);
  throw new Error(`Unsupported ${kind} operation '${operation}'. Call coros_capabilities first. Available: ${available.join(", ")}`);
}

async function requireAuth() {
  const auth = await getValidAuth();
  if (!auth) throw new Error("Not authenticated with COROS.");
  return auth;
}

export async function getCompatibilityCapabilities(): Promise<JsonObject> {
  const auth = await getValidAuth();
  return {
    name: "coros-workout-chatgpt",
    connectorVersion: CONNECTOR_VERSION,
    expectedToolCount: EXPECTED_TOOL_COUNT,
    bridgeVersion: COMPATIBILITY_BRIDGE_VERSION,
    bridgeStableSince: "1.13.0",
    authenticated: Boolean(auth),
    region: auth?.region ?? null,
    purpose: "Stable operations can be added server-side without changing the coros_read or coros_write tool schemas.",
    usage: {
      read: "Call coros_read with an operation name and an input object.",
      write: "Call coros_write with an operation name, input object and the exact confirmation shown below.",
    },
    readOperations: READ_OPERATIONS,
    writeOperations: WRITE_OPERATIONS,
  };
}

export async function executeCompatibilityRead(operation: string, rawInput: JsonObject): Promise<JsonObject> {
  if (!READ_OPERATIONS.some((item) => item.name === operation)) unknownOperation("read", operation);

  if (operation === "connector_status") {
    const auth = await getValidAuth();
    return bridgeEnvelope(operation, {
      name: "coros-workout-chatgpt",
      version: CONNECTOR_VERSION,
      expectedToolCount: EXPECTED_TOOL_COUNT,
      authenticated: Boolean(auth),
      region: auth?.region ?? null,
      features: CONNECTOR_FEATURES,
      compatibilityBridge: { version: COMPATIBILITY_BRIDGE_VERSION, readOperations: READ_OPERATIONS.length, writeOperations: WRITE_OPERATIONS.length },
    });
  }

  if (operation === "check_coros_auth") {
    const auth = await getValidAuth();
    return bridgeEnvelope(operation, { authenticated: Boolean(auth), userId: auth?.userId ?? null, region: auth?.region ?? null });
  }
  if (operation === "coaching_methodology_catalog") {
    return bridgeEnvelope(operation, getCoachingMethodologyCatalog(CoachingMethodologySchema.parse(rawInput)));
  }
  if (operation === "get_athlete_profile") return bridgeEnvelope(operation, publicAthleteProfile());

  if (operation === "get_official_recovery") return bridgeEnvelope(operation, await getOfficialRecoveryNormalized());

  if (operation === "get_sleep_data") {
    const auth = process.env.COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN === "true" && rawInput.officialSleepRecords === undefined ? await getValidAuth() : null;
    const input = DateRangeSchema.extend({ officialSleepRecords: OfficialSleepSchema }).parse(rawInput);
    const resolution = await resolveSleepRecords({ ...input, auth });
    return bridgeEnvelope(operation, { ...resolution, ...sleepMetadata(resolution), count: resolution.records.length });
  }
  if (operation === "get_provider_activity") { const i=ProviderActivityDetailSchema.parse(rawInput); return bridgeEnvelope(operation, await getProviderActivity(i.providerId,i.activityId,i.sportType)); }
  if (operation === "weekly_training_summary") { const i=ProviderEndDateSchema.parse(rawInput); return bridgeEnvelope(operation, await weeklyTrainingSummary(i.providerId,i.endDate)); }
  if (operation === "training_load_balance") { const i=LoadBalanceSchema.parse(rawInput); return bridgeEnvelope(operation, await trainingLoadBalance(i.providerId,i.endDate,i.windows)); }
  if (operation === "activity_anomalies") { const i=LookbackSchema.parse(rawInput); return bridgeEnvelope(operation, await activityAnomalies(i.providerId,i.endDate,i.lookbackDays ?? 90)); }
  if (operation === "personal_bests") { const i=LookbackSchema.parse(rawInput); return bridgeEnvelope(operation, await personalBests(i.providerId,i.endDate,i.lookbackDays ?? 365)); }
  if (operation === "sport_progression") { const i=LookbackSchema.parse(rawInput); return bridgeEnvelope(operation, await sportProgression(i.providerId,i.endDate,i.lookbackDays ?? 84)); }
  if (operation === "similar_activities") { const i=SimilarActivitiesSchema.parse(rawInput); return bridgeEnvelope(operation, await similarActivities(i.providerId,i.activityId,i.endDate,i.lookbackDays,i.limit)); }
  if (operation === "activity_efficiency") { const i=LookbackSchema.parse(rawInput); return bridgeEnvelope(operation, await activityEfficiency(i.providerId,i.endDate,i.lookbackDays ?? 90)); }
  if (operation === "data_quality_report") { const i=LookbackSchema.parse(rawInput); return bridgeEnvelope(operation, await dataQualityReport(i.providerId,i.endDate,i.lookbackDays ?? 90)); }
  if (operation === "athlete_snapshot") { const i=ProviderEndDateSchema.parse(rawInput); return bridgeEnvelope(operation, await athleteSnapshot(i.providerId,i.endDate)); }
  if (operation === "route_checkpoint_plan") { const i=RouteToolkitSchema.parse(rawInput); return bridgeEnvelope(operation, await routeCheckpointPlan(i.gpx,i.startTimeIso,i.options)); }
  if (operation === "event_projection") { const i=EventProjectionSchema.parse(rawInput); return bridgeEnvelope(operation, await eventProjection(i.gpx,i.startTimeIso,i.activityType,i.options)); }
  if (operation === "training_data_status" || operation === "list_training_providers") return bridgeEnvelope(operation, await trainingDataStatus());
  if (operation === "setup_check") return bridgeEnvelope(operation, await setupCheck());
  if (operation === "list_provider_activities") { const input = ProviderActivitiesSchema.parse(rawInput); return bridgeEnvelope(operation, await listProviderActivities(input)); }
  if (operation === "training_trends") { const input = TrainingTrendsSchema.parse(rawInput); return bridgeEnvelope(operation, await trainingTrends(input.providerId, input.endDate, input.windows)); }
  if (operation === "compare_activities") { const input = CompareActivitiesSchema.parse(rawInput); return bridgeEnvelope(operation, await compareActivities(input.providerId, input.startDate, input.endDate, input.activityIds)); }
  if (operation === "import_activity_file") { const input = ImportActivityFileSchema.parse(rawInput); return bridgeEnvelope(operation, await importActivityFile(input.fitBase64, input.name)); }

  const auth = await requireAuth();

  if (operation === "dashboard_snapshot") {
    const parsed = DashboardSnapshotSchema.parse(rawInput);
    const profile = loadAthleteProfile();
    const date = normalizeScheduleDate(parsed.date);
    const startDate = addDaysToScheduleDate(date, -111);
    const calendarEnd = addDaysToScheduleDate(date, 14);
    const sleepResolution = await resolveSleepRecords({ officialSleepRecords: parsed.officialSleepRecords, auth, startDate, endDate: date });
    const officialSleep = sleepResolution.records;
    const settled = await Promise.allSettled([
      Promise.resolve(officialSleep),
      fetchHrv(auth),
      fetchDailyMetrics(auth, startDate, date),
      fetchActivities(auth, startDate, date, 1, 100),
      listScheduledWorkouts(auth, date, calendarEnd),
    ]);
    const val = <T>(i: number, fallback: T): T => settled[i].status === "fulfilled" ? settled[i].value as T : fallback;
    const activityResult = val<Awaited<ReturnType<typeof fetchActivities>>>(3, { activities: [], total: 0 });
    const names = ["sleep", "hrv", "dailyMetrics", "activities", "calendar"];
    const sourceErrors = settled.flatMap((x, i) => x.status === "rejected" ? [{ source: names[i], error: x.reason instanceof Error ? x.reason.message : String(x.reason) }] : []);
    const base = {
      date, profile,
      sleep: val<any[]>(0, []),
      hrv: val<Awaited<ReturnType<typeof fetchHrv>>>(1, []),
      metrics: val<Awaited<ReturnType<typeof fetchDailyMetrics>>>(2, []),
      activities: activityResult.activities,
      planned: val<Awaited<ReturnType<typeof listScheduledWorkouts>>>(4, []),
      sourceErrors,
      objective: parsed.objective,
    };
    const intel = buildAthleteIntelligence(base, parsed.plannedDurationSeconds);
    const coach = buildAdaptiveCoachingDecision(base);
    const season = buildSeasonStrategy(base);
    return bridgeEnvelope(operation, {
      ...sleepMetadata(sleepResolution),
      snapshotVersion: "1",
      generatedAt: new Date().toISOString(),
      date,
      intel,
      coach,
      calendar: base.planned,
      season,
      model: (season as any).athleteModel ?? null,
      dataSources: {
        historyStartDate: startDate,
        calendarEndDate: calendarEnd,
        returnedActivities: activityResult.activities.length,
        totalActivitiesReportedByCoros: activityResult.total,
        sourceErrors,
      },
    });
  }

  if (["adaptive_coaching_engine", "longitudinal_athlete_model", "simulate_training_change", "season_strategy", "evaluate_prior_decision", "athlete_intelligence", "personal_recovery_model", "residual_fatigue_model", "session_fingerprints", "performance_trend", "training_dose_optimizer", "event_readiness", "anomaly_data_quality"].includes(operation)) {
    const profile = loadAthleteProfile();
    const baseInputFor = async (dateRaw: string, lookbackDays = 84, officialSleepRecords?: OfficialSleepRecord[]) => {
      const date = normalizeScheduleDate(dateRaw);
      const startDate = addDaysToScheduleDate(date, -(lookbackDays - 1));
      const calendarEnd = addDaysToScheduleDate(date, 14);
      const sleepResolution = await resolveSleepRecords({ officialSleepRecords, auth, startDate, endDate: date });
      const settled = await Promise.allSettled([
        Promise.resolve(sleepResolution.records),
        fetchHrv(auth), fetchDailyMetrics(auth, startDate, date), fetchActivities(auth, startDate, date, 1, 100), listScheduledWorkouts(auth, date, calendarEnd),
      ]);
      const val = <T>(i: number, fallback: T): T => settled[i].status === "fulfilled" ? settled[i].value as T : fallback;
      const activityResult = val<Awaited<ReturnType<typeof fetchActivities>>>(3, { activities: [], total: 0 });
      const names = ["sleep", "hrv", "dailyMetrics", "activities", "calendar"];
      const sourceErrors = settled.flatMap((x, i) => x.status === "rejected" ? [{ source: names[i], error: x.reason instanceof Error ? x.reason.message : String(x.reason) }] : []);
      return { ...sleepMetadata(sleepResolution), date, profile, sleep: val<any[]>(0, []), hrv: val<Awaited<ReturnType<typeof fetchHrv>>>(1, []), metrics: val<Awaited<ReturnType<typeof fetchDailyMetrics>>>(2, []), activities: activityResult.activities, planned: val<Awaited<ReturnType<typeof listScheduledWorkouts>>>(4, []), sourceErrors };
    };
    if (["athlete_intelligence", "personal_recovery_model", "residual_fatigue_model", "session_fingerprints", "performance_trend", "training_dose_optimizer", "event_readiness", "anomaly_data_quality"].includes(operation)) {
      const parsed = z.object({ date: z.string(), lookbackDays: z.number().int().min(28).max(168).optional().default(112), objective: z.any().optional(), plannedDurationSeconds: z.number().positive().optional(), officialSleepRecords: OfficialSleepSchema }).parse(rawInput);
      const base = await baseInputFor(parsed.date, parsed.lookbackDays, parsed.officialSleepRecords);
      const full = { ...base, objective: parsed.objective };
      const result = operation === "athlete_intelligence" ? buildAthleteIntelligence(full, parsed.plannedDurationSeconds)
        : operation === "personal_recovery_model" ? buildRecoveryModel(full)
        : operation === "residual_fatigue_model" ? buildResidualFatigueModel(full)
        : operation === "session_fingerprints" ? buildSessionFingerprints(full)
        : operation === "performance_trend" ? buildPerformanceTrend(full)
        : operation === "training_dose_optimizer" ? buildDoseOptimizer(full, parsed.plannedDurationSeconds)
        : operation === "event_readiness" ? buildEventReadiness(full, parsed.objective)
        : buildAnomalyAndQuality(full);
      return bridgeEnvelope(operation, { ...result, sleepStatus: base.sleepStatus, sleepSource: base.sleepSource });
    }
    if (operation === "adaptive_coaching_engine") {
      const parsed = AdaptiveEngineSchema.parse(rawInput);
      const base = await baseInputFor(parsed.date, 84, parsed.officialSleepRecords);
      return bridgeEnvelope(operation, { ...buildAdaptiveCoachingDecision({ ...base, subjective: parsed.subjective, objective: parsed.objective }), sleepStatus: base.sleepStatus, sleepSource: base.sleepSource });
    }
    if (operation === "longitudinal_athlete_model") {
      const parsed = LongitudinalSchema.parse(rawInput);
      const base = await baseInputFor(parsed.date, parsed.lookbackDays, parsed.officialSleepRecords);
      return bridgeEnvelope(operation, { ...buildLongitudinalAthleteModel(base), sleepStatus: base.sleepStatus, sleepSource: base.sleepSource });
    }
    if (operation === "simulate_training_change") {
      const parsed = SimulationSchema.parse(rawInput);
      const base = await baseInputFor(parsed.referenceDate, 84, parsed.officialSleepRecords);
      return bridgeEnvelope(operation, { ...simulateTrainingChange({ ...base, objective: parsed.objective }, { date: parsed.date, name: parsed.name, sportType: parsed.sportType, durationSeconds: parsed.durationSeconds, trainingLoadEstimate: parsed.trainingLoadEstimate, replacingIdInPlan: parsed.replacingIdInPlan }), sleepStatus: base.sleepStatus, sleepSource: base.sleepSource });
    }
    if (operation === "season_strategy") {
      const parsed = SeasonSchema.parse(rawInput);
      const base = await baseInputFor(parsed.date, 112, parsed.officialSleepRecords);
      return bridgeEnvelope(operation, { ...buildSeasonStrategy({ ...base, objective: parsed.objective }), sleepStatus: base.sleepStatus, sleepSource: base.sleepSource });
    }
    const parsed = EvaluateDecisionSchema.parse(rawInput);
    const base = await baseInputFor(parsed.evaluationDate, 84, parsed.officialSleepRecords);
    return bridgeEnvelope(operation, { ...evaluatePriorDecision({ priorDecision: parsed.priorDecision, priorDate: parsed.priorDate, evaluationDate: parsed.evaluationDate, currentMetrics: base.metrics, activities: base.activities }), sleepStatus: base.sleepStatus, sleepSource: base.sleepSource });
  }

  if (operation === "training_context_analysis") {
    const input = TrainingContextSchema.parse(rawInput);
    return bridgeEnvelope(operation, await analyzeTrainingContext(auth, input.referenceDate, undefined, input.lookbackDays, input.lookaheadDays));
  }
  if (operation === "validate_calendar_change") {
    const proposed = ValidateCalendarSchema.parse(rawInput);
    return bridgeEnvelope(operation, await analyzeTrainingContext(auth, proposed.date, proposed));
  }
  if (operation === "get_hrv_data") return bridgeEnvelope(operation, await fetchHrv(auth));

  if (operation === "get_daily_metrics") {
    const input = DateRangeSchema.parse(rawInput);
    return bridgeEnvelope(operation, await fetchDailyMetrics(auth, input.startDate, input.endDate));
  }
  if (operation === "list_activities") {
    const input = ListActivitiesSchema.parse(rawInput);
    return bridgeEnvelope(operation, await fetchActivities(auth, input.startDate, input.endDate, input.page, input.size));
  }
  if (operation === "list_scheduled_workouts") {
    const input = DateRangeSchema.parse(rawInput);
    return bridgeEnvelope(operation, await listScheduledWorkouts(auth, input.startDate, input.endDate));
  }
  if (operation === "calibrate_sport_performance") {
    const input = CalibrationSchema.parse(rawInput);
    const endDate = normalizeScheduleDate(input.endDate);
    const startDate = addDaysToScheduleDate(endDate, -(input.lookbackDays - 1));
    const history = await fetchActivities(auth, startDate, endDate, 1, 100);
    return bridgeEnvelope(operation, {
      requestedRange: { startDate, endDate, lookbackDays: input.lookbackDays },
      returnedActivities: history.activities.length,
      totalActivitiesReportedByCoros: history.total,
      truncated: history.total > history.activities.length,
      calibration: calibrateSportPerformance(history.activities, input.sport),
    });
  }
  if (operation === "analyze_multisport_load") {
    const input = DateRangeSchema.parse(rawInput);
    const history = await fetchActivities(auth, input.startDate, input.endDate, 1, 100);
    return bridgeEnvelope(operation, {
      ...buildMultisportLoadReport(history.activities),
      source: { returnedActivities: history.activities.length, totalActivitiesReportedByCoros: history.total, truncated: history.total > history.activities.length },
    });
  }
  if (operation === "professional_coaching_analysis") {
    const parsed = ProfessionalCoachingSchema.parse(rawInput);
    const profile = loadAthleteProfile();
    const date = normalizeScheduleDate(parsed.date);
    const startDate = addDaysToScheduleDate(date, -27);
    const calendarEndDate = addDaysToScheduleDate(date, 7);
    const names = ["sleep", "hrv", "dailyMetrics", "activities", "calendar"] as const;
    const sleepResolution = await resolveSleepRecords({ officialSleepRecords: parsed.officialSleepRecords, auth, startDate, endDate: date });
    const officialSleep = parsed.officialSleepRecords !== undefined ? sleepResolution.records : undefined;
    const settled = await Promise.allSettled([
      Promise.resolve(sleepResolution.records),
      fetchHrv(auth),
      fetchDailyMetrics(auth, startDate, date),
      fetchActivities(auth, startDate, date, 1, 100),
      listScheduledWorkouts(auth, date, calendarEndDate),
    ]);
    const value = <T>(index: number, fallback: T): T => settled[index].status === "fulfilled" ? settled[index].value as T : fallback;
    const activityResult = value<Awaited<ReturnType<typeof fetchActivities>>>(3, { activities: [], total: 0 });
    const sourceErrors = settled.flatMap((source, index) => source.status === "rejected"
      ? [{ source: names[index], error: source.reason instanceof Error ? source.reason.message : String(source.reason) }]
      : []);
    const analysis = buildProfessionalCoachingAnalysis({
      ...parsed,
      date,
      primaryDiscipline: parsed.primaryDiscipline ?? (profile.primaryDiscipline === "ultra_cycling" ? "ultra_endurance" : "multisport"),
      objective: parsed.objective ?? (profile.objectives.map((item) => item.name).join("; ") || undefined),
      constraints: [...new Set([...profile.constraints.map((item) => item.label), ...parsed.constraints])],
      eventDate: parsed.eventDate ? normalizeScheduleDate(parsed.eventDate) : undefined,
    }, {
      sleep: value<OfficialSleepRecord[]>(0, []).filter((item) => item.date >= startDate && item.date <= date),
      hrv: value<Awaited<ReturnType<typeof fetchHrv>>>(1, []).filter((item) => item.date >= startDate && item.date <= date),
      dailyMetrics: value<Awaited<ReturnType<typeof fetchDailyMetrics>>>(2, []),
      activities: activityResult.activities,
      plannedWorkouts: value<Awaited<ReturnType<typeof listScheduledWorkouts>>>(4, []),
      sourceErrors,
      activitySource: { returned: activityResult.activities.length, total: activityResult.total, truncated: activityResult.total > activityResult.activities.length },
    });
    return bridgeEnvelope(operation, {
      ...analysis,
      ...sleepMetadata(sleepResolution),
      recoveryDataSource: officialSleep
        ? { provider: "COROS MCP official", authentication: "OAuth 2.0 managed by the calling AI platform", sleepRecords: officialSleep.length }
        : { provider: "none", reason: "No officialSleepRecords supplied; unofficial mobile login remains disabled by default." },
    });
  }

  if (operation === "coach_state") {
    return bridgeEnvelope(operation, { ...(await readCoachState()), storage: coachStateStorageInfo() });
  }

  return unknownOperation("read", operation);
}

export async function executeCompatibilityWrite(operation: string, rawInput: JsonObject, confirmation: string): Promise<JsonObject> {
  const descriptor = WRITE_OPERATIONS.find((item) => item.name === operation);
  if (!descriptor) unknownOperation("write", operation);
  if (confirmation !== descriptor.confirmation) {
    throw new Error(`Operation '${operation}' requires confirmation='${descriptor.confirmation}'.`);
  }

  if (operation === "update_coach_state") {
    const input = rawInput as any;
    const state = await updateCoachState({
      headline: typeof input.headline === "string" ? input.headline : undefined,
      dailyAssessment: input.dailyAssessment && typeof input.dailyAssessment === "object" ? input.dailyAssessment : undefined,
      currentPlan: input.currentPlan && typeof input.currentPlan === "object" ? input.currentPlan : undefined,
      appendChange: input.appendChange && typeof input.appendChange === "object" ? input.appendChange : undefined,
    });
    return bridgeEnvelope(operation, state);
  }

  const auth = await requireAuth();
  if (operation === "assign_workout_to_calendar") {
    const input = AssignSchema.parse(rawInput);
    return bridgeEnvelope(operation, await guardedAssignWorkoutToCalendar(auth, input.workoutId, input.date));
  }
  if (operation === "move_scheduled_workout") {
    const input = MoveSchema.parse(rawInput);
    const result = await guardedMoveScheduledWorkout(auth, input.sourceDate, input.idInPlan, input.newDate);
    return bridgeEnvelope(operation, { moved: true, idInPlan: input.idInPlan, sourceDate: normalizeScheduleDate(input.sourceDate), newDate: normalizeScheduleDate(input.newDate), coachingGuard: result.coachingGuard });
  }
  if (operation === "remove_scheduled_workout") {
    const input = RemoveSchema.parse(rawInput);
    await removeScheduledWorkout(auth, input.planId, input.idInPlan, input.planProgramId);
    return bridgeEnvelope(operation, { removed: true, idInPlan: input.idInPlan });
  }
  if (operation === "delete_workout") {
    const input = DeleteSchema.parse(rawInput);
    await deleteWorkout(auth, input.workoutId);
    return bridgeEnvelope(operation, { deleted: true, workoutId: input.workoutId });
  }

  return unknownOperation("write", operation);
}
