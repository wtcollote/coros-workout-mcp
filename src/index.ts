#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import {
  login,
  getValidAuth,
  loadAuth,
  resolveExercises,
  calculateWorkout,
  addWorkout,
  queryWorkouts,
  queryExerciseCatalog,
  fetchI18nStrings,
  buildCatalogFromRaw,
  getWorkoutDetail,
  createStructuredWorkout,
  deleteWorkout,
  listScheduledWorkouts,
  removeScheduledWorkout,
  cloneWorkout,
  replaceStructuredWorkout,
  detectCalendarConflicts,
  summarizePlannedWorkouts,
  swapScheduledWorkouts,
  querySchedule,
  buildStructuredWorkoutPayload,
  normalizeScheduleDate,
  addDaysToScheduleDate,
  buildShiftPreview,
  replaceScheduledWorkout,
  shiftCalendarRange,
  createWorkoutFromRaw,
  fetchHrv,
  fetchDailyMetrics,
  fetchActivities,
  fetchActivityDetail,
  fetchAerobicDecoupling,
  fetchCompactActivityAnalysis,
  previewDailyAdjustment,
  calculateFuelingPlan,
  fetchWorkoutExecutionAnalysis,
  fetchActivityExportUrl,
  fetchAndAnalyzeFitActivity,
  buildAthleteProfileMetrics,
} from "./coros-api.js";
import { OfficialSleepSchema, resolveSleepRecords, sleepMetadata } from "./sleep-source.js";
import type { OfficialSleepRecord } from "./sleep-source.js";
import type { StructuredStep } from "./coros-api.js";
import {
  searchExercises,
  findByName,
  getAllExercises,
  reloadCatalog,
  getCatalogPath,
} from "./exercise-catalog.js";
import type { Region } from "./types.js";
import { analyzeGpxRoute, analyzeRouteWeather, simulateUltraRoute } from "./route-analysis.js";
import { planOperationalRoute } from "./operational-route.js";
import { analyzeActivityContext, classifyTrainingDay } from "./activity-context.js";
import { buildMultisportLoadReport, calibrateSportPerformance } from "./performance-calibration.js";
import type { CalibratedSport } from "./performance-calibration.js";
import { analyzeTrainingContext, guardedAssignWorkoutToCalendar, guardedMoveScheduledWorkout, requireWritableCalendarContext, validateScheduledMove, validateWorkoutAssignment } from "./training-context-service.js";
import {
  CONNECTOR_FEATURES,
  CONNECTOR_VERSION,
  EXPECTED_TOOL_COUNT,
  executeCompatibilityRead,
  executeCompatibilityWrite,
  getCompatibilityCapabilities,
} from "./compatibility-bridge.js";

export function createCorosWorkoutServer(): McpServer {
const server = new McpServer(
  { name: "coros-workout-chatgpt", version: CONNECTOR_VERSION },
  {
    instructions:
      "This private plugin manages and analyzes COROS training for cycling, road running, trail running, strength integration and ultra-endurance. Analyze all available metrics exhaustively, then interpret them as professional coaching decision support: distinguish observed data, inference, uncertainty and practical recommendation; consider sport specificity, session purpose, the preceding and following 14-day panorama, residual stress, recovery and event context; never invent missing values, zones or diagnoses. Use the persistent athlete profile instead of relying on chat memory. MANDATORY SLEEP ROUTING: whenever the user asks for sleep, recovery, readiness, daily briefing, weekly report, daily adjustment, taper readiness, or any analysis that uses sleep, FIRST call the installed official COROS MCP OAuth sleep tool (COROS_MCP_2 querySleepData) for the required wake-up date range. Normalize that result and pass it as officialSleepRecords to the COROS Workout tool. NEVER call a sleep-dependent COROS Workout tool without first attempting the official COROS MCP sleep read. Never trigger unofficial mobile login. If the official COROS MCP read itself fails, report sleep as unavailable. Use training_context_analysis before planning. Calendar assignments and moves pass through the professional guard; a block must not be bypassed silently. Pass current pain, illness and subjective fatigue because these can change and are not stored by COROS. Search the exercise catalog before creating a strength workout. Any calendar or workout write requires explicit confirmation and may sync to the user's watch.",
  }
);

// --- Tool: authenticate_coros ---
server.tool(
  "authenticate_coros",
  "Log in to COROS Training Hub. Stores auth token for subsequent calls. Also checks COROS_EMAIL/COROS_PASSWORD env vars for auto-login. WARNING: Logging in via API invalidates the web app session.",
  {
    email: z.string().email().optional().describe("COROS account email (optional if env vars set)"),
    password: z.string().optional().describe("COROS account password (optional if env vars set)"),
    region: z.enum(["us", "eu"]).default("eu").describe("API region: 'us' or 'eu'"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ email, password, region }) => {
    try {
      // Use provided credentials or fall back to env vars
      const loginEmail = email || process.env.COROS_EMAIL;
      const loginPassword = password || process.env.COROS_PASSWORD;
      const loginRegion = (region || process.env.COROS_REGION || "eu") as Region;

      if (!loginEmail || !loginPassword) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No credentials provided. Set COROS_EMAIL and COROS_PASSWORD environment variables, or provide email and password parameters.",
            },
          ],
        };
      }

      const auth = await login(loginEmail, loginPassword, loginRegion);
      return {
        content: [
          {
            type: "text" as const,
            text: `Authenticated successfully. User ID: ${auth.userId}, Region: ${auth.region}. Token stored at ~/.config/coros-workout-mcp/auth.json`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: check_coros_auth ---
server.tool(
  "check_coros_auth",
  "Check if COROS authentication is available (from stored token or env vars).",
  {},
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async () => {
    const auth = await getValidAuth();
    if (auth) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Authenticated. User ID: ${auth.userId}, Region: ${auth.region}`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: "Not authenticated. Use authenticate_coros tool or set COROS_EMAIL/COROS_PASSWORD env vars.",
        },
      ],
    };
  }
);

// --- Tool: search_exercises ---
server.tool(
  "search_exercises",
  "Search the COROS exercise catalog (~383 strength exercises). Filter by name, muscle group, body part, and/or equipment. Returns exercise names, muscles, equipment, and default sets/reps.",
  {
    query: z.string().optional().describe("Search by exercise name (partial match, e.g. 'bench press')"),
    muscle: z.string().optional().describe("Filter by muscle group (e.g. 'chest', 'biceps', 'glutes', 'quadriceps')"),
    bodyPart: z.string().optional().describe("Filter by body part (e.g. 'legs', 'arms', 'core', 'chest', 'back', 'shoulders')"),
    equipment: z.string().optional().describe("Filter by equipment (e.g. 'bodyweight', 'dumbbells', 'barbells', 'kettlebell', 'bands')"),
    limit: z.number().int().min(1).max(50).default(20).describe("Max results to return"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ query, muscle, bodyPart, equipment, limit }) => {
    const results = searchExercises({ query, muscle, bodyPart, equipment });
    const limited = results.slice(0, limit);

    if (limited.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No exercises found matching your search criteria.",
          },
        ],
      };
    }

    const formatted = limited.map((e) => {
      const lines = [
        `**${e.name}**`,
        `  Muscles: ${e.muscleText}${e.secondaryMuscleText ? ` (secondary: ${e.secondaryMuscleText})` : ""}`,
        `  Body parts: ${e.partText}`,
        `  Equipment: ${e.equipmentText}`,
        `  Defaults: ${e.sets} sets x ${e.targetValue} ${e.targetType === 3 ? "reps" : "seconds"}, ${e.restValue}s rest`,
      ];
      return lines.join("\n");
    });

    const header = `Found ${results.length} exercises${results.length > limit ? ` (showing first ${limit})` : ""}:\n`;
    return {
      content: [
        {
          type: "text" as const,
          text: header + formatted.join("\n\n"),
        },
      ],
    };
  }
);

// --- Tool: create_workout ---
const ExerciseInputSchema = z.object({
  name: z.string().describe("Exercise name (must match catalog exactly, e.g. 'Push-ups', 'Squats')"),
  sets: z.number().int().min(1).optional().describe("Number of sets (defaults to catalog value)"),
  reps: z.number().int().min(1).optional().describe("Reps per set (defaults to catalog value)"),
  duration: z.number().int().min(1).optional().describe("Duration in seconds per set (alternative to reps)"),
  restSeconds: z.number().int().min(0).optional().describe("Rest between sets in seconds (defaults to catalog value)"),
  weightKg: z.number().min(0).optional().describe("Weight in kg (e.g. 20 for 20kg)"),
});

server.tool(
  "create_workout",
  "Create a strength workout on COROS Training Hub. Resolves exercise names from the catalog, builds the full API payload, calculates metrics, and saves the workout. The workout will sync to the user's COROS watch.",
  {
    name: z.string().describe("Workout name (e.g. 'Upper Body Push')"),
    overview: z.string().default("").describe("Workout description"),
    exercises: z.array(ExerciseInputSchema).min(1).describe("Array of exercises with optional overrides"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ name, overview, exercises }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not authenticated. Use authenticate_coros first.",
            },
          ],
          isError: true,
        };
      }

      // Validate all exercise names first
      const missing: string[] = [];
      for (const ex of exercises) {
        if (!findByName(ex.name)) {
          missing.push(ex.name);
        }
      }
      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Exercises not found in catalog: ${missing.map((n) => `"${n}"`).join(", ")}. Use search_exercises to find the correct names.`,
            },
          ],
          isError: true,
        };
      }

      // Build payloads
      const exercisePayloads = resolveExercises(exercises);

      // Calculate metrics
      const calculated = await calculateWorkout(
        auth,
        name,
        overview,
        exercisePayloads
      );

      // Create the workout
      await addWorkout(auth, name, overview, exercisePayloads, calculated);

      const totalSets = exercises.reduce(
        (sum, ex) => sum + (ex.sets ?? findByName(ex.name)!.sets),
        0
      );
      const exerciseSummary = exercises
        .map((ex) => {
          const catalog = findByName(ex.name)!;
          const sets = ex.sets ?? catalog.sets;
          const target = ex.reps ?? ex.duration ?? catalog.targetValue;
          const unit = (ex.reps || (!ex.duration && catalog.targetType === 3)) ? "reps" : "s";
          const weight = ex.weightKg ? ` @ ${ex.weightKg}kg` : "";
          return `  ${ex.name}: ${sets}x${target}${unit}${weight}`;
        })
        .join("\n");

      const durationMin = Math.round(calculated.duration / 60);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Workout "${name}" created successfully!`,
              `Duration: ~${durationMin} min | Sets: ${calculated.totalSets} | Training load: ${calculated.trainingLoad}`,
              ``,
              `Exercises:`,
              exerciseSummary,
              ``,
              `The workout will sync to your COROS watch.`,
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to create workout: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: update_exercises ---
server.tool(
  "update_exercises",
  "Fetch the latest exercise catalog from COROS APIs and rebuild the local catalog. Requires authentication. Fetches exercises from the COROS API and i18n strings for human-readable names.",
  {
    sportType: z
      .number()
      .int()
      .default(4)
      .describe("Sport type to fetch exercises for (default 4 = strength)"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ sportType }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not authenticated. Use authenticate_coros first.",
            },
          ],
          isError: true,
        };
      }

      // Get current catalog for comparison and as fallback for names
      let oldExercises: ReturnType<typeof getAllExercises> = [];
      let oldNames: Set<string>;
      try {
        oldExercises = getAllExercises();
        oldNames = new Set(oldExercises.map((e) => e.name));
      } catch {
        oldNames = new Set();
      }

      // Fetch exercises and i18n in parallel
      const [rawExercises, i18n] = await Promise.all([
        queryExerciseCatalog(auth, sportType),
        fetchI18nStrings(),
      ]);

      // Build catalog (pass existing catalog for name fallback)
      const { catalog, i18nMisses } = buildCatalogFromRaw(
        rawExercises,
        i18n,
        oldExercises
      );

      // Compare with old catalog
      const newNames = new Set(catalog.map((e) => e.name));
      const added = [...newNames].filter((n) => !oldNames.has(n));
      const removed = [...oldNames].filter((n) => !newNames.has(n));

      // Write to disk
      const catalogPath = getCatalogPath();
      writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

      // Reload in-memory cache
      reloadCatalog();

      // Build summary
      const lines = [
        `Exercise catalog updated successfully.`,
        `Total exercises: ${catalog.length}`,
      ];
      if (added.length > 0) {
        lines.push(`New exercises (${added.length}): ${added.join(", ")}`);
      }
      if (removed.length > 0) {
        lines.push(
          `Removed exercises (${removed.length}): ${removed.join(", ")}`
        );
      }
      if (added.length === 0 && removed.length === 0) {
        lines.push("No changes in exercise list.");
      }
      if (i18nMisses.length > 0) {
        lines.push(
          `i18n misses (${i18nMisses.length}): ${i18nMisses.slice(0, 10).join(", ")}${i18nMisses.length > 10 ? "..." : ""}`
        );
      }
      lines.push(`Catalog written to: ${catalogPath}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to update exercises: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: list_workouts ---
server.tool(
  "list_workouts",
  "List workouts from COROS Training Hub.",
  {
    name: z.string().default("").describe("Filter by workout name (optional)"),
    sportType: z.number().int().default(0).describe("Filter by sport type (0=all, 4=strength)"),
    limit: z.number().int().min(1).max(50).default(10).describe("Number of workouts to return"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ name, sportType, limit }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not authenticated. Use authenticate_coros first.",
            },
          ],
          isError: true,
        };
      }

      const result = (await queryWorkouts(auth, {
        name,
        sportType,
        limitSize: limit,
      })) as { data: Array<{ id: string; name: string; overview: string; sportType: number; duration: number; totalSets: number; exerciseNum: number; estimatedTime: number }> };

      const workouts = result.data || [];
      if (workouts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No workouts found.",
            },
          ],
        };
      }

      const formatted = workouts
        .map((w) => {
          const durationMin = Math.round((w.estimatedTime || w.duration || 0) / 60);
          return `- **${w.name}** — ID: \`${w.id}\` (${durationMin} min, ${w.totalSets || 0} sets, ${w.exerciseNum || 0} exercises)${w.overview ? `\n  ${w.overview}` : ""}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${workouts.length} workout(s):\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to list workouts: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: assign_workout_to_calendar ---
server.tool(
  "assign_workout_to_calendar",
  "Assign an existing COROS Training Hub workout to a date in the COROS training calendar. Use list_workouts first to obtain the workout ID.",
  {
    workoutId: z.string().min(1).describe("COROS workout ID returned by list_workouts"),
    date: z.string().describe("Calendar date in YYYY-MM-DD or YYYYMMDD format"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ workoutId, date }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) {
        return {
          content: [{ type: "text" as const, text: "Not authenticated. Use authenticate_coros first." }],
          isError: true,
        };
      }

      const result = await guardedAssignWorkoutToCalendar(auth, workoutId, date);
      const displayDate = `${result.date.slice(0, 4)}-${result.date.slice(4, 6)}-${result.date.slice(6, 8)}`;
      return {
        content: [
          {
            type: "text" as const,
            text: `Workout ${workoutId} assigned to the COROS calendar on ${displayDate}.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to assign workout to calendar: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

const SegmentSchema = z.object({
  kind: z.enum(["warmup", "training", "interval", "recovery", "rest", "cooldown"]),
  name: z.string().optional(),
  targetType: z.enum(["time", "distance", "open"]),
  durationSeconds: z.number().int().positive().optional(),
  distanceMeters: z.number().positive().optional(),
  intensityType: z.enum(["open", "heart_rate", "pace", "power", "cadence", "speed"]).optional(),
  intensityMin: z.number().positive().optional(),
  intensityMax: z.number().positive().optional(),
});
const RepeatSchema = z.object({
  repeat: z.number().int().min(2),
  name: z.string().optional(),
  steps: z.array(SegmentSchema).min(1),
});

server.tool(
  "create_structured_workout",
  "Create a structured running or cycling workout with time, distance or open steps, optional HR/pace/power/cadence/speed targets, and repeat groups. Optionally schedule it on a COROS calendar date.",
  {
    name: z.string().min(1),
    sport: z.enum(["running", "cycling"]),
    overview: z.string().default(""),
    steps: z.array(z.union([SegmentSchema, RepeatSchema])).min(1),
    date: z.string().optional().describe("Optional YYYY-MM-DD or YYYYMMDD calendar date"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ name, sport, overview, steps, date }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const payload = buildStructuredWorkoutPayload(name, sport, steps as StructuredStep[], overview);
      if (date) {
        requireWritableCalendarContext(await analyzeTrainingContext(auth, date, {
          date,
          name,
          sportType: sport === "running" ? 1 : 2,
          durationSeconds: Number(payload.duration ?? 0),
        }), "structured workout creation and assignment");
      }
      const workoutId = await createStructuredWorkout(auth, name, sport, steps as StructuredStep[], overview);
      if (date) await guardedAssignWorkoutToCalendar(auth, workoutId, date);
      return {
        content: [{
          type: "text" as const,
          text: `Structured ${sport} workout "${name}" created with ID ${workoutId}${date ? ` and assigned to ${date}` : ""}.`,
        }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to create structured workout: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "delete_workout",
  "Delete a saved workout from the COROS Training Hub library. This does not remove already scheduled calendar entries.",
  { workoutId: z.string().min(1) },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ workoutId }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      await deleteWorkout(auth, workoutId);
      return { content: [{ type: "text" as const, text: `Workout ${workoutId} deleted from the COROS library.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to delete workout: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "list_scheduled_workouts",
  "List workouts scheduled in the COROS calendar, including IDs required to move or remove them.",
  { startDate: z.string(), endDate: z.string() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const items = await listScheduledWorkouts(auth, startDate, endDate);
      const text = items.length
        ? items.map((item) => `- ${item.date}: **${item.name}** (sport ${item.sportType}) — planId=${item.planId}, idInPlan=${item.idInPlan}, planProgramId=${item.planProgramId}`).join("\n")
        : "No scheduled workouts found.";
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to list calendar: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "remove_scheduled_workout",
  "Remove one workout occurrence from the COROS calendar. Use list_scheduled_workouts first.",
  { planId: z.string(), idInPlan: z.string(), planProgramId: z.string().optional() },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ planId, idInPlan, planProgramId }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      await removeScheduledWorkout(auth, planId, idInPlan, planProgramId);
      return { content: [{ type: "text" as const, text: `Scheduled entry ${idInPlan} removed.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to remove scheduled workout: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "move_scheduled_workout",
  "Move a COROS calendar workout to another date without changing its contents. Use list_scheduled_workouts first.",
  { sourceDate: z.string(), idInPlan: z.string(), newDate: z.string() },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ sourceDate, idInPlan, newDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      await guardedMoveScheduledWorkout(auth, sourceDate, idInPlan, newDate);
      return { content: [{ type: "text" as const, text: `Scheduled entry ${idInPlan} moved to ${newDate}.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to move scheduled workout: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "duplicate_workout",
  "Duplicate any COROS library workout. Optionally rename it, change its description, and schedule the copy.",
  {
    workoutId: z.string().min(1),
    newName: z.string().min(1).optional(),
    overview: z.string().optional(),
    date: z.string().optional(),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ workoutId, newName, overview, date }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      if (date) requireWritableCalendarContext(await validateWorkoutAssignment(auth, workoutId, date), "workout duplication and assignment");
      const newId = await cloneWorkout(auth, workoutId, { name: newName, overview });
      if (date) await guardedAssignWorkoutToCalendar(auth, newId, date);
      return { content: [{ type: "text" as const, text: `Workout ${workoutId} duplicated as ${newId}${date ? ` and assigned to ${date}` : ""}.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to duplicate workout: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "update_workout",
  "Safely edit a workout by creating an updated clone. For running/cycling, steps can be replaced. The original is retained unless deleteOriginal=true.",
  {
    workoutId: z.string().min(1),
    name: z.string().min(1).optional(),
    overview: z.string().optional(),
    sport: z.enum(["running", "cycling"]).optional(),
    steps: z.array(z.union([SegmentSchema, RepeatSchema])).min(1).optional(),
    deleteOriginal: z.boolean().default(false),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ workoutId, name, overview, sport, steps, deleteOriginal }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const source = await getWorkoutDetail(auth, workoutId);
      let newId: string;
      if (steps) {
        const inferredSport = sport ?? (Number(source.sportType) === 1 ? "running" : Number(source.sportType) === 2 ? "cycling" : undefined);
        if (!inferredSport) throw new Error("Replacing steps is currently supported only for running and cycling workouts.");
        newId = await replaceStructuredWorkout(
          auth,
          workoutId,
          name ?? String(source.name ?? "Updated workout"),
          inferredSport,
          steps as StructuredStep[],
          overview ?? String(source.overview ?? ""),
          deleteOriginal
        );
      } else {
        newId = await cloneWorkout(auth, workoutId, { name, overview });
        if (deleteOriginal) await deleteWorkout(auth, workoutId);
      }
      return { content: [{ type: "text" as const, text: `Updated clone created with ID ${newId}. Original ${deleteOriginal ? "deleted" : "retained"}.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to update workout: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

const WeekWorkoutSchema = z.object({
  date: z.string(),
  name: z.string().min(1),
  sport: z.enum(["running", "cycling"]),
  overview: z.string().default(""),
  steps: z.array(z.union([SegmentSchema, RepeatSchema])).min(1),
});

server.tool(
  "create_week_plan",
  "Create and schedule several structured running/cycling workouts in one request. All entries are validated and calendar conflicts are checked before writing.",
  {
    workouts: z.array(WeekWorkoutSchema).min(1).max(14),
    conflictPolicy: z.enum(["reject", "allow"]).default("reject"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ workouts, conflictPolicy }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const prepared = workouts.map((item) => ({
        item,
        payload: buildStructuredWorkoutPayload(item.name, item.sport, item.steps as StructuredStep[], item.overview),
      }));
      const sortedDates = workouts.map((item) => item.date).sort();
      const existing = await listScheduledWorkouts(auth, sortedDates[0], sortedDates[sortedDates.length - 1]);
      const requestedDates = new Set(workouts.map((item) => item.date.replaceAll("-", "")));
      const occupied = existing.filter((item) => requestedDates.has(item.date));
      if (conflictPolicy === "reject" && occupied.length) {
        throw new Error(`Calendar conflict: ${occupied.map((item) => `${item.date} (${item.name})`).join(", ")}. Use conflictPolicy=allow to keep both.`);
      }
      for (const { item, payload } of prepared) {
        requireWritableCalendarContext(await analyzeTrainingContext(auth, item.date, {
          date: item.date,
          name: item.name,
          sportType: item.sport === "running" ? 1 : 2,
          durationSeconds: Number(payload.duration ?? 0),
        }), `week-plan item '${item.name}'`);
      }
      const created: Array<{ date: string; name: string; workoutId: string }> = [];
      for (const item of workouts) {
        const workoutId = await createStructuredWorkout(auth, item.name, item.sport, item.steps as StructuredStep[], item.overview);
        await guardedAssignWorkoutToCalendar(auth, workoutId, item.date);
        created.push({ date: item.date, name: item.name, workoutId });
      }
      return { content: [{ type: "text" as const, text: `Created and scheduled ${created.length} workouts:\n${created.map((item) => `- ${item.date}: ${item.name} — ${item.workoutId}`).join("\n")}` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to create week plan: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "check_calendar_conflicts",
  "Find dates containing more than one scheduled COROS workout.",
  { startDate: z.string(), endDate: z.string() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const conflicts = detectCalendarConflicts(await listScheduledWorkouts(auth, startDate, endDate));
      const text = conflicts.length
        ? conflicts.map((conflict) => `- ${conflict.date}: ${conflict.workouts.map((workout) => workout.name).join(" + ")}`).join("\n")
        : "No calendar conflicts found.";
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to check conflicts: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "summarize_planned_load",
  "Summarize planned workout count, duration and distance by sport for a date range. This is planned volume, not physiological COROS Training Load.",
  { startDate: z.string(), endDate: z.string() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const summary = summarizePlannedWorkouts(await listScheduledWorkouts(auth, startDate, endDate));
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to summarize planned volume: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "swap_calendar_workouts",
  "Swap two scheduled COROS workout occurrences between dates while preserving their calendar identities.",
  {
    firstDate: z.string(),
    firstIdInPlan: z.string(),
    secondDate: z.string(),
    secondIdInPlan: z.string(),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ firstDate, firstIdInPlan, secondDate, secondIdInPlan }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const validations = await Promise.all([
        validateScheduledMove(auth, firstDate, firstIdInPlan, secondDate),
        validateScheduledMove(auth, secondDate, secondIdInPlan, firstDate),
      ]);
      const blocked = validations.flatMap((validation) => {
        const guard = validation.guard as { canWrite: boolean; issues: unknown[] };
        return guard.canWrite ? [] : guard.issues;
      });
      if (blocked.length) throw new Error(`Professional calendar guard blocked swap: ${JSON.stringify(blocked)}`);
      await swapScheduledWorkouts(auth, firstDate, firstIdInPlan, secondDate, secondIdInPlan);
      return { content: [{ type: "text" as const, text: `Scheduled entries ${firstIdInPlan} and ${secondIdInPlan} swapped.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to swap workouts: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "validate_structured_workout",
  "Validate and calculate a structured workout locally without writing anything to COROS.",
  {
    name: z.string().min(1),
    sport: z.enum(["running", "cycling"]),
    overview: z.string().default(""),
    steps: z.array(z.union([SegmentSchema, RepeatSchema])).min(1),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ name, sport, overview, steps }) => {
    try {
      const payload = buildStructuredWorkoutPayload(name, sport, steps as StructuredStep[], overview);
      return { content: [{ type: "text" as const, text: JSON.stringify({ valid: true, sport, durationSeconds: payload.duration, distanceMeters: Number(payload.distance || 0) / 100, exerciseCount: payload.exerciseNum }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Invalid workout: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "export_coros_backup",
  "Export COROS workout-library metadata and raw calendar data as JSON for backup or inspection. Does not include account credentials.",
  { startDate: z.string(), endDate: z.string(), workoutLimit: z.number().int().min(1).max(500).default(200) },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate, workoutLimit }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const [workoutResult, calendar] = await Promise.all([
        queryWorkouts(auth, { limitSize: workoutLimit }),
        querySchedule(auth, startDate, endDate),
      ]);
      const backup = { format: "coros-workout-backup-v1", generatedAt: new Date().toISOString(), range: { startDate, endDate }, workouts: (workoutResult as { data?: unknown }).data ?? [], calendar };
      return { content: [{ type: "text" as const, text: JSON.stringify(backup, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to export backup: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "get_workout_details",
  "Return the complete COROS definition of one library workout, including every step and target.",
  { workoutId: z.string().min(1) },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ workoutId }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const workout = await getWorkoutDetail(auth, workoutId);
      return { content: [{ type: "text" as const, text: JSON.stringify(workout, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to get workout details: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "replace_scheduled_workout",
  "Replace one calendar occurrence with another library workout. The replacement is scheduled before the old occurrence is removed.",
  { sourceDate: z.string(), idInPlan: z.string(), replacementWorkoutId: z.string().min(1) },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ sourceDate, idInPlan, replacementWorkoutId }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const validation = await validateWorkoutAssignment(auth, replacementWorkoutId, sourceDate);
      const guard = validation.guard as { canWrite: boolean; issues: unknown[] };
      if (!guard.canWrite) throw new Error(`Professional calendar guard blocked replacement: ${JSON.stringify(guard.issues)}`);
      const result = await replaceScheduledWorkout(auth, sourceDate, idInPlan, replacementWorkoutId);
      return { content: [{ type: "text" as const, text: `Scheduled entry ${idInPlan} replaced by workout ${replacementWorkoutId}. New calendar ID: ${result.newIdInPlan}.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to replace scheduled workout: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "shift_calendar_range",
  "Preview or move every scheduled workout in a date range by a fixed number of days.",
  {
    startDate: z.string(),
    endDate: z.string(),
    days: z.number().int().refine((value) => value !== 0, "days must not be zero"),
    apply: z.boolean().default(false).describe("False previews only; true writes the changes to COROS"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate, days, apply }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const preview = buildShiftPreview(await listScheduledWorkouts(auth, startDate, endDate), days);
      if (apply) {
        for (const move of preview) await validateScheduledMove(auth, move.from, move.idInPlan, move.to).then((validation) => {
          const guard = validation.guard as { canWrite: boolean; issues: unknown[] };
          if (!guard.canWrite) throw new Error(`Professional calendar guard blocked range shift: ${JSON.stringify(guard.issues)}`);
        });
      }
      const moves = apply ? await shiftCalendarRange(auth, startDate, endDate, days) : preview;
      const label = apply ? "Moved" : "Preview";
      return { content: [{ type: "text" as const, text: `${label} (${moves.length}):\n${moves.map((move) => `- ${move.name}: ${move.from} → ${move.to}`).join("\n") || "No workouts found."}` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to shift calendar range: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "copy_calendar_range",
  "Preview or copy all scheduled workouts from one date range to dates shifted by a fixed number of days. Copies are new library workouts.",
  {
    startDate: z.string(),
    endDate: z.string(),
    days: z.number().int().refine((value) => value !== 0, "days must not be zero"),
    nameSuffix: z.string().default(""),
    apply: z.boolean().default(false),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate, days, nameSuffix, apply }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const [items, schedule] = await Promise.all([
        listScheduledWorkouts(auth, startDate, endDate),
        querySchedule(auth, startDate, endDate),
      ]);
      const preview = items.map((item) => ({ ...item, targetDate: addDaysToScheduleDate(item.date, days) }));
      if (!apply) {
        return { content: [{ type: "text" as const, text: `Preview (${preview.length}):\n${preview.map((item) => `- ${item.name}: ${item.date} → ${item.targetDate}`).join("\n") || "No workouts found."}` }] };
      }
      for (const item of preview) {
        requireWritableCalendarContext(
          await validateScheduledMove(auth, item.date, item.idInPlan, item.targetDate),
          `calendar copy '${item.name}'`
        );
      }
      const created: Array<{ name: string; date: string; workoutId: string }> = [];
      for (const item of preview) {
        let program = (schedule.programs ?? []).find((candidate) =>
          String(candidate.idInPlan ?? "") === item.idInPlan || String(candidate.id ?? "") === item.planProgramId
        );
        if (!program) program = await getWorkoutDetail(auth, item.workoutId);
        const newName = `${String(program.name ?? item.name)}${nameSuffix}`;
        const workoutId = await createWorkoutFromRaw(auth, program, { name: newName });
        await guardedAssignWorkoutToCalendar(auth, workoutId, item.targetDate);
        created.push({ name: newName, date: item.targetDate, workoutId });
      }
      return { content: [{ type: "text" as const, text: `Copied ${created.length} workouts:\n${created.map((item) => `- ${item.date}: ${item.name} — ${item.workoutId}`).join("\n")}` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to copy calendar range: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "clear_calendar_range",
  "Preview or remove every scheduled workout occurrence in a date range. Applying requires confirm=DELETE.",
  {
    startDate: z.string(),
    endDate: z.string(),
    apply: z.boolean().default(false),
    confirm: z.literal("DELETE").optional(),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ startDate, endDate, apply, confirm }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const items = await listScheduledWorkouts(auth, startDate, endDate);
      if (!apply) return { content: [{ type: "text" as const, text: `Preview only (${items.length}):\n${items.map((item) => `- ${item.date}: ${item.name} — ${item.idInPlan}`).join("\n") || "No workouts found."}` }] };
      if (confirm !== "DELETE") throw new Error("Refusing to clear calendar: apply=true requires confirm=DELETE.");
      for (const item of items) {
        await removeScheduledWorkout(auth, item.planId, item.idInPlan, item.planProgramId);
      }
      return { content: [{ type: "text" as const, text: `Removed ${items.length} scheduled workout occurrences from ${startDate} to ${endDate}. Library workouts were retained.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to clear calendar range: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "audit_calendar",
  "Audit a calendar range for duplicate days, missing management IDs and planned-volume totals without changing COROS.",
  { startDate: z.string(), endDate: z.string() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const items = await listScheduledWorkouts(auth, startDate, endDate);
      const result = {
        range: { startDate, endDate },
        scheduledCount: items.length,
        conflicts: detectCalendarConflicts(items),
        entriesMissingManagementIds: items.filter((item) => !item.planId || !item.idInPlan).map((item) => ({ date: item.date, name: item.name })),
        plannedVolume: summarizePlannedWorkouts(items),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to audit calendar: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "get_hrv_data",
  "Read recent nightly HRV, baseline and variability from the COROS Training Hub dashboard.",
  {},
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async () => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify({ records: await fetchHrv(auth) }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to read HRV: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "get_daily_metrics",
  "Read COROS daily HRV, resting heart rate, fatigue, training load, load ratio and fitness metrics for a date range.",
  { startDate: z.string(), endDate: z.string() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const records = await fetchDailyMetrics(auth, startDate, endDate);
      return { content: [{ type: "text" as const, text: JSON.stringify({ startDate, endDate, count: records.length, records }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to read daily metrics: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "get_sleep_data",
  "MANDATORY: before calling this tool, first read the same date range with the installed official COROS MCP OAuth sleep tool (COROS_MCP_2 querySleepData), normalize its result, and supply it as officialSleepRecords. Do not call this tool with officialSleepRecords omitted unless the official COROS MCP read failed.",
  { officialSleepRecords: OfficialSleepSchema, startDate: z.string(), endDate: z.string() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ officialSleepRecords, startDate, endDate }) => {
    try {
      const auth = officialSleepRecords !== undefined || process.env.COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN !== "true" ? null : await getValidAuth();
      const sleepResolution = await resolveSleepRecords({ officialSleepRecords, auth, startDate, endDate });
      const records = sleepResolution.records;
      return { content: [{ type: "text" as const, text: JSON.stringify({ ...sleepResolution, ...sleepMetadata(sleepResolution), startDate, endDate, count: records.length, records }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to read sleep: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "list_activities",
  "List completed COROS activities with duration, distance, heart rate, training load, power and elevation.",
  {
    startDate: z.string(),
    endDate: z.string(),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(100).default(30),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate, page, size }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const result = await fetchActivities(auth, startDate, endDate, page, size);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to list activities: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "get_activity_detail",
  "Read the detailed metrics, laps and zones for one completed COROS activity. Large graph arrays are omitted.",
  { activityId: z.string().min(1), sportType: z.number().int() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ activityId, sportType }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify(await fetchActivityDetail(auth, activityId, sportType), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to read activity detail: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "analyze_aerobic_decoupling",
  "Calculate aerobic decoupling for a completed running or cycling activity by comparing time-weighted speed/heart-rate efficiency in both halves. Trims warm-up and cool-down by default and reports when data is insufficient.",
  {
    activityId: z.string().min(1),
    sportType: z.number().int(),
    trimPercent: z.number().min(0).max(39).default(10).describe("Percentage removed from both the start and end; default 10"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ activityId, sportType, trimPercent }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const result = await fetchAerobicDecoupling(auth, activityId, sportType, trimPercent);
      return { content: [{ type: "text" as const, text: JSON.stringify({ activityId, sportType, ...result }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to analyze aerobic decoupling: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "analyze_completed_activity",
  "Return a compact coach-ready analysis of any completed activity. Supports endurance metrics and explicit context for strength, walking, hiking, mobility and active recovery. Supply date to allow summary fallback if COROS rejects detailed strength data.",
  { activityId: z.string().min(1), sportType: z.number().int(), date: z.string().optional().describe("Optional YYYY-MM-DD or YYYYMMDD date used for summary fallback") },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ activityId, sportType, date }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      try {
        const result = await fetchCompactActivityAnalysis(auth, activityId, sportType);
        return { content: [{ type: "text" as const, text: JSON.stringify({ activityId, sportType, detailSource: "COROS activity detail", ...result }, null, 2) }] };
      } catch (detailError) {
        if (!date) throw detailError;
        const compactDate = normalizeScheduleDate(date);
        const summary = (await fetchActivities(auth, compactDate, compactDate, 1, 100)).activities.find((activity) => activity.activityId === activityId);
        if (!summary) throw detailError;
        return { content: [{ type: "text" as const, text: JSON.stringify({
          activityId,
          sportType,
          detailSource: "COROS activity-list summary fallback",
          detailError: detailError instanceof Error ? detailError.message : String(detailError),
          summary,
          activityContext: analyzeActivityContext(summary),
        }, null, 2) }] };
      }
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to analyze completed activity: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "analyze_training_day",
  "Analyze every completed COROS activity on one date, including strength, walking, hiking, mobility and recovery sessions. Classifies only the recorded training day using transparent rules and also returns the planned calendar.",
  { date: z.string().describe("Target date in YYYY-MM-DD or YYYYMMDD format") },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ date }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const compactDate = normalizeScheduleDate(date);
      const [completedResult, plannedResult] = await Promise.allSettled([
        fetchActivities(auth, compactDate, compactDate, 1, 100),
        listScheduledWorkouts(auth, compactDate, compactDate),
      ]);
      const completed = completedResult.status === "fulfilled" ? completedResult.value.activities : [];
      const analyses = completed.map((activity) => analyzeActivityContext(activity));
      const errors = [
        ...(completedResult.status === "rejected" ? [{ source: "activities", error: completedResult.reason instanceof Error ? completedResult.reason.message : String(completedResult.reason) }] : []),
        ...(plannedResult.status === "rejected" ? [{ source: "calendar", error: plannedResult.reason instanceof Error ? plannedResult.reason.message : String(plannedResult.reason) }] : []),
      ];
      return { content: [{ type: "text" as const, text: JSON.stringify({
        date: compactDate,
        dayAnalysis: classifyTrainingDay(analyses),
        completedActivities: analyses,
        plannedWorkouts: plannedResult.status === "fulfilled" ? plannedResult.value : [],
        errors,
        note: "Active recovery is a transparent candidate classification, not proof of physiological recovery. Strength muscular load is not inferred when sets, repetitions or resistance are absent.",
      }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to analyze training day: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "daily_training_briefing",
  "MANDATORY SLEEP ROUTING: first call COROS_MCP_2 querySleepData for the last seven wake-up days and pass normalized results as officialSleepRecords. Then build the daily briefing from sleep, HRV, resting heart rate, load, activities and calendar.",
  { officialSleepRecords: OfficialSleepSchema, date: z.string().describe("Target date in YYYY-MM-DD or YYYYMMDD format") },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ officialSleepRecords, date }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const compactDate = normalizeScheduleDate(date);
      const startDate = addDaysToScheduleDate(compactDate, -6);
      const sourceNames = ["sleep", "hrv", "dailyMetrics", "activities", "calendar"] as const;
      const sleepResolution = await resolveSleepRecords({ officialSleepRecords, auth, startDate, endDate: compactDate });
      const sources = await Promise.allSettled([
        Promise.resolve(sleepResolution.records),
        fetchHrv(auth),
        fetchDailyMetrics(auth, startDate, compactDate),
        fetchActivities(auth, startDate, compactDate, 1, 100),
        listScheduledWorkouts(auth, compactDate, compactDate),
      ]);
      const value = <T>(index: number, fallback: T): T => sources[index].status === "fulfilled" ? sources[index].value as T : fallback;
      const errors: Array<{ source: string; error: string }> = sources.flatMap((source, index) => source.status === "rejected"
        ? [{ source: sourceNames[index], error: source.reason instanceof Error ? source.reason.message : String(source.reason) }]
        : []);
      const sleep = value<OfficialSleepRecord[]>(0, []).filter((record) => record.date >= startDate && record.date <= compactDate);
      const hrv = value<Awaited<ReturnType<typeof fetchHrv>>>(1, []).filter((record) => record.date >= startDate && record.date <= compactDate);
      const dailyMetrics = value<Awaited<ReturnType<typeof fetchDailyMetrics>>>(2, []);
      const activities = value<Awaited<ReturnType<typeof fetchActivities>>>(3, { activities: [], total: 0 }).activities;
      const plannedToday = value<Awaited<ReturnType<typeof listScheduledWorkouts>>>(4, []);
      const average = (values: Array<number | null>) => {
        const valid = values.filter((item): item is number => item != null && Number.isFinite(item));
        return valid.length ? Number((valid.reduce((sum, item) => sum + item, 0) / valid.length).toFixed(1)) : null;
      };
      const latestEndurance = [...activities]
        .filter((activity) => activity.sportType != null && [100, 102, 103, 200, 201, 203, 204, 9807].includes(activity.sportType))
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      let latestAerobicDecoupling: Record<string, unknown> | null = null;
      if (latestEndurance?.sportType != null) {
        try {
          latestAerobicDecoupling = {
            activityId: latestEndurance.activityId,
            date: latestEndurance.date,
            name: latestEndurance.name,
            sportType: latestEndurance.sportType,
            ...(await fetchAerobicDecoupling(auth, latestEndurance.activityId, latestEndurance.sportType, 10)),
          };
        } catch (error) {
          errors.push({ source: "aerobicDecoupling", error: error instanceof Error ? error.message : String(error) });
        }
      }
      const todaySleep = [...sleep].reverse().find((record) => record.date <= compactDate) ?? null;
      const todayHrv = hrv.find((record) => record.date === compactDate) ?? hrv.at(-1) ?? null;
      const todayMetrics = dailyMetrics.find((record) => record.date === compactDate) ?? null;
      const completedToday = activities.filter((activity) => activity.date === compactDate);
      const completedActivityAnalysis = completedToday.map((activity) => analyzeActivityContext(activity));
      const result = {
        ...sleepMetadata(sleepResolution),
        date: compactDate,
        range: { startDate, endDate: compactDate, days: 7 },
        current: {
          sleep: todaySleep,
          hrv: todayHrv,
          dailyMetrics: todayMetrics,
          completedActivities: completedToday,
          completedActivityAnalysis,
          trainingDayClassification: classifyTrainingDay(completedActivityAnalysis),
          plannedWorkouts: plannedToday,
        },
        sevenDayTrends: {
          sleepDurationMinutesAverage: average(sleep.map((record) => record.totalDurationMinutes)),
          sleepQualityAverage: average(sleep.map((record) => record.qualityScore)),
          sleepHrvAverage: average(hrv.map((record) => record.average)),
          restingHeartRateAverage: average(dailyMetrics.map((record) => record.restingHeartRate)),
          fatigueRateAverage: average(dailyMetrics.map((record) => record.fatigueRate)),
          trainingLoadRatioAverage: average(dailyMetrics.map((record) => record.trainingLoadRatio)),
          completedWorkoutCount: activities.length,
          completedDurationSeconds: activities.reduce((sum, activity) => sum + (activity.durationSeconds ?? 0), 0),
          completedTrainingLoad: activities.reduce((sum, activity) => sum + (activity.trainingLoad ?? 0), 0),
        },
        latestAerobicDecoupling,
        dataAvailability: {
          sleepDays: sleep.length,
          hrvDays: hrv.length,
          metricDays: dailyMetrics.length,
          activityCount: activities.length,
          errors,
        },
        note: "Raw COROS data and calculated trends only; no synthetic readiness score is generated.",
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to build daily training briefing: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "preview_daily_adjustment",
  "MANDATORY SLEEP ROUTING: first call COROS_MCP_2 querySleepData for the required recent wake-up days and pass normalized results as officialSleepRecords. Then preview the daily adjustment. Never change the calendar.",
  { officialSleepRecords: OfficialSleepSchema, date: z.string().describe("Target date in YYYY-MM-DD or YYYYMMDD format") },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ officialSleepRecords, date }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const compactDate = normalizeScheduleDate(date);
      const startDate = addDaysToScheduleDate(compactDate, -6);
      const sleepResolution = await resolveSleepRecords({ officialSleepRecords, auth, startDate, endDate: compactDate });
      const [sleepResult, hrvResult, metricsResult, plannedResult] = await Promise.allSettled([
        Promise.resolve(sleepResolution.records),
        fetchHrv(auth),
        fetchDailyMetrics(auth, startDate, compactDate),
        listScheduledWorkouts(auth, compactDate, compactDate),
      ]);
      const sleep = sleepResult.status === "fulfilled" ? sleepResult.value : [];
      const hrv = hrvResult.status === "fulfilled" ? hrvResult.value.filter((item) => item.date >= startDate && item.date <= compactDate) : [];
      const metrics = metricsResult.status === "fulfilled" ? metricsResult.value : [];
      const planned = plannedResult.status === "fulfilled" ? plannedResult.value : [];
      const currentSleep = [...sleep].reverse().find((item) => item.date <= compactDate) ?? null;
      const currentHrv = hrv.find((item) => item.date === compactDate) ?? hrv.at(-1) ?? null;
      const currentMetrics = metrics.find((item) => item.date === compactDate) ?? null;
      const restingValues = metrics.map((item) => item.restingHeartRate).filter((item): item is number => item != null && Number.isFinite(item));
      const restingAverage = restingValues.length ? restingValues.reduce((sum, item) => sum + item, 0) / restingValues.length : null;
      const preview = previewDailyAdjustment({
        sleepMinutes: currentSleep?.totalDurationMinutes ?? null,
        currentHrv: currentHrv?.average ?? null,
        hrvBaseline: currentHrv?.baseline ?? currentMetrics?.hrvBaseline ?? null,
        restingHeartRate: currentMetrics?.restingHeartRate ?? null,
        restingHeartRate7dAverage: restingAverage,
        trainingLoadRatio: currentMetrics?.trainingLoadRatio ?? null,
        plannedWorkoutCount: planned.length,
      });
      const errors: Array<{ source: string; error: string }> = [];
      const addSourceError = (source: string, result: PromiseSettledResult<unknown>) => {
        if (result.status === "rejected") {
          errors.push({ source, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
        }
      };
      addSourceError("sleep", sleepResult);
      addSourceError("hrv", hrvResult);
      addSourceError("dailyMetrics", metricsResult);
      addSourceError("calendar", plannedResult);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        ...sleepMetadata(sleepResolution),
        date: compactDate,
        preview,
        inputs: {
          sleepMinutes: currentSleep?.totalDurationMinutes ?? null,
          currentHrv: currentHrv?.average ?? null,
          hrvBaseline: currentHrv?.baseline ?? currentMetrics?.hrvBaseline ?? null,
          restingHeartRate: currentMetrics?.restingHeartRate ?? null,
          restingHeartRate7dAverage: restingAverage == null ? null : Number(restingAverage.toFixed(1)),
          trainingLoadRatio: currentMetrics?.trainingLoadRatio ?? null,
          plannedWorkouts: planned,
        },
        errors,
      }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to preview daily adjustment: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "calculate_fueling_plan",
  "Calculate practical carbohydrate, fluid and sodium ranges for an endurance session. Uses duration, intensity, temperature and optional measured sweat/sodium loss. This is a planning estimate, not medical advice.",
  {
    durationMinutes: z.number().positive().max(2880),
    intensity: z.enum(["recovery", "endurance", "tempo", "race"]),
    temperatureC: z.number().min(-20).max(60).optional(),
    sweatRateMlPerHour: z.number().min(200).max(3000).optional(),
    sodiumLossMgPerLiter: z.number().min(100).max(3000).optional(),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async (input) => ({ content: [{ type: "text" as const, text: JSON.stringify(calculateFuelingPlan(input), null, 2) }] })
);

server.tool(
  "compare_activity_history",
  "Compare up to eight similar completed COROS activities over a date range using normalized summary metrics and aerobic decoupling. Filter by exact COROS sport type and optional name text.",
  {
    startDate: z.string(),
    endDate: z.string(),
    sportType: z.number().int(),
    nameContains: z.string().default(""),
    maxActivities: z.number().int().min(2).max(8).default(6),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate, sportType, nameContains, maxActivities }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const listed = await fetchActivities(auth, startDate, endDate, 1, 100);
      const needle = nameContains.trim().toLowerCase();
      const selected = listed.activities
        .filter((activity) => activity.sportType === sportType && (!needle || (activity.name ?? "").toLowerCase().includes(needle)))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, maxActivities)
        .reverse();
      const analyses = await Promise.allSettled(selected.map((activity) => fetchCompactActivityAnalysis(auth, activity.activityId, sportType)));
      const comparison = selected.map((activity, index) => {
        const analysis = analyses[index];
        if (analysis.status === "rejected") return { date: activity.date, activityId: activity.activityId, name: activity.name, error: analysis.reason instanceof Error ? analysis.reason.message : String(analysis.reason) };
        const summary = analysis.value.summary as Record<string, unknown>;
        const decoupling = analysis.value.aerobicDecoupling as Record<string, unknown>;
        return {
          date: activity.date,
          activityId: activity.activityId,
          name: activity.name,
          durationSeconds: summary.durationSeconds,
          distanceMeters: summary.distanceMeters,
          averageHeartRate: summary.averageHeartRate,
          averageCadence: summary.averageCadence,
          paceSecondsPerKm: summary.paceSecondsPerKm,
          averageSpeedKmh: summary.averageSpeedKmh,
          elevationGainMeters: summary.elevationGainMeters,
          trainingLoad: summary.trainingLoad,
          aerobicEffect: summary.aerobicEffect,
          decouplingPercent: decoupling.decouplingPercent ?? null,
          decouplingClassification: decoupling.classification ?? null,
        };
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ startDate, endDate, sportType, nameContains, count: comparison.length, comparison }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to compare activity history: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "weekly_training_report",
  "MANDATORY SLEEP ROUTING: first call COROS_MCP_2 querySleepData for the required wake-up-date range and pass normalized results as officialSleepRecords. Then build the seven-day report and comparison.",
  { officialSleepRecords: OfficialSleepSchema, endDate: z.string().describe("Final day of the report in YYYY-MM-DD or YYYYMMDD format") },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ officialSleepRecords, endDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const currentEnd = normalizeScheduleDate(endDate);
      const currentStart = addDaysToScheduleDate(currentEnd, -6);
      const previousEnd = addDaysToScheduleDate(currentStart, -1);
      const previousStart = addDaysToScheduleDate(previousEnd, -6);
      const sourceNames = ["sleep", "hrv", "dailyMetrics", "activities", "calendar"] as const;
      const sleepResolution = await resolveSleepRecords({ officialSleepRecords, auth, startDate: previousStart, endDate: currentEnd });
      const sources = await Promise.allSettled([
        Promise.resolve(sleepResolution.records),
        fetchHrv(auth),
        fetchDailyMetrics(auth, previousStart, currentEnd),
        fetchActivities(auth, previousStart, currentEnd, 1, 100),
        listScheduledWorkouts(auth, currentStart, currentEnd),
      ]);
      const value = <T>(index: number, fallback: T): T => sources[index].status === "fulfilled" ? sources[index].value as T : fallback;
      const errors = sources.flatMap((source, index) => source.status === "rejected"
        ? [{ source: sourceNames[index], error: source.reason instanceof Error ? source.reason.message : String(source.reason) }]
        : []);
      const sleep = value<OfficialSleepRecord[]>(0, []);
      const hrv = value<Awaited<ReturnType<typeof fetchHrv>>>(1, []);
      const metrics = value<Awaited<ReturnType<typeof fetchDailyMetrics>>>(2, []);
      const activities = value<Awaited<ReturnType<typeof fetchActivities>>>(3, { activities: [], total: 0 }).activities;
      const average = (values: Array<number | null>) => {
        const valid = values.filter((item): item is number => item != null && Number.isFinite(item));
        return valid.length ? Number((valid.reduce((sum, item) => sum + item, 0) / valid.length).toFixed(1)) : null;
      };
      const summarize = (start: string, end: string) => {
        const selectedActivities = activities.filter((item) => item.date >= start && item.date <= end);
        const selectedSleep = sleep.filter((item) => item.date >= start && item.date <= end);
        const selectedHrv = hrv.filter((item) => item.date >= start && item.date <= end);
        const selectedMetrics = metrics.filter((item) => item.date >= start && item.date <= end);
        const bySport: Record<string, { count: number; durationSeconds: number; distanceMeters: number; trainingLoad: number }> = {};
        for (const item of selectedActivities) {
          const sport = item.sportName ?? String(item.sportType ?? "unknown");
          const bucket = bySport[sport] ?? { count: 0, durationSeconds: 0, distanceMeters: 0, trainingLoad: 0 };
          bucket.count += 1;
          bucket.durationSeconds += item.durationSeconds ?? 0;
          bucket.distanceMeters += item.distanceMeters ?? 0;
          bucket.trainingLoad += item.trainingLoad ?? 0;
          bySport[sport] = bucket;
        }
        return {
          startDate: start, endDate: end,
          completed: {
            count: selectedActivities.length,
            durationSeconds: selectedActivities.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0),
            distanceMeters: selectedActivities.reduce((sum, item) => sum + (item.distanceMeters ?? 0), 0),
            elevationGainMeters: selectedActivities.reduce((sum, item) => sum + (item.elevationGain ?? 0), 0),
            trainingLoad: selectedActivities.reduce((sum, item) => sum + (item.trainingLoad ?? 0), 0),
            bySport,
          },
          recovery: {
            sleepDurationMinutesAverage: average(selectedSleep.map((item) => item.totalDurationMinutes)),
            sleepQualityAverage: average(selectedSleep.map((item) => item.qualityScore)),
            hrvAverage: average(selectedHrv.map((item) => item.average)),
            restingHeartRateAverage: average(selectedMetrics.map((item) => item.restingHeartRate)),
            fatigueRateAverage: average(selectedMetrics.map((item) => item.fatigueRate)),
          },
          dataDays: { sleep: selectedSleep.length, hrv: selectedHrv.length, dailyMetrics: selectedMetrics.length },
        };
      };
      const current = summarize(currentStart, currentEnd);
      const previous = summarize(previousStart, previousEnd);
      const deltaPercent = (now: number, before: number) => before > 0 ? Number(((now - before) / before * 100).toFixed(1)) : null;
      const planned = value<Awaited<ReturnType<typeof listScheduledWorkouts>>>(4, []);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        ...sleepMetadata(sleepResolution),
        current, previous,
        changePercent: {
          duration: deltaPercent(current.completed.durationSeconds, previous.completed.durationSeconds),
          distance: deltaPercent(current.completed.distanceMeters, previous.completed.distanceMeters),
          trainingLoad: deltaPercent(current.completed.trainingLoad, previous.completed.trainingLoad),
        },
        plannedCalendar: planned,
        errors,
        note: "All comparisons use raw COROS data; missing sources remain explicit and are not estimated.",
      }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to build weekly report: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "analyze_workout_execution",
  "Compare a planned COROS workout with the completed activity linked to its program blocks. Reports duration and HR/cadence target compliance when COROS exposes programExerciseIndex.",
  { workoutId: z.string().min(1), activityId: z.string().min(1), sportType: z.number().int() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ workoutId, activityId, sportType }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const result = await fetchWorkoutExecutionAnalysis(auth, workoutId, activityId, sportType);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to analyze workout execution: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "taper_readiness",
  "MANDATORY SLEEP ROUTING: first call COROS_MCP_2 querySleepData for the required wake-up-date range and pass normalized results as officialSleepRecords. Then assess taper readiness from load, sleep, HRV and resting heart rate.",
  {
    officialSleepRecords: OfficialSleepSchema,
    raceDate: z.string().describe("Target event date in YYYY-MM-DD or YYYYMMDD format"),
    asOfDate: z.string().describe("Assessment date in YYYY-MM-DD or YYYYMMDD format"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ officialSleepRecords, raceDate, asOfDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const race = normalizeScheduleDate(raceDate);
      const asOf = normalizeScheduleDate(asOfDate);
      const currentStart = addDaysToScheduleDate(asOf, -6);
      const previousEnd = addDaysToScheduleDate(currentStart, -1);
      const previousStart = addDaysToScheduleDate(previousEnd, -6);
      const parseUtc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)));
      const daysToRace = Math.round((parseUtc(race) - parseUtc(asOf)) / 86400000);
      if (daysToRace < 0) throw new Error("raceDate must not be before asOfDate.");
      const sleepResolution = await resolveSleepRecords({ officialSleepRecords, auth, startDate: currentStart, endDate: asOf });
      const sources = await Promise.allSettled([
        fetchActivities(auth, previousStart, asOf, 1, 100),
        Promise.resolve(sleepResolution.records),
        fetchHrv(auth),
        fetchDailyMetrics(auth, currentStart, asOf),
        listScheduledWorkouts(auth, asOf, race),
      ]);
      const value = <T>(index: number, fallback: T): T => sources[index].status === "fulfilled" ? sources[index].value as T : fallback;
      const activities = value<Awaited<ReturnType<typeof fetchActivities>>>(0, { activities: [], total: 0 }).activities;
      const sleep = value<OfficialSleepRecord[]>(1, []);
      const hrv = value<Awaited<ReturnType<typeof fetchHrv>>>(2, []).filter((item) => item.date >= currentStart && item.date <= asOf);
      const metrics = value<Awaited<ReturnType<typeof fetchDailyMetrics>>>(3, []);
      const planned = value<Awaited<ReturnType<typeof listScheduledWorkouts>>>(4, []);
      const load = (start: string, end: string) => activities.filter((item) => item.date >= start && item.date <= end).reduce((sum, item) => sum + (item.trainingLoad ?? 0), 0);
      const currentLoad = load(currentStart, asOf);
      const previousLoad = load(previousStart, previousEnd);
      const loadChangePercent = previousLoad > 0 ? Number(((currentLoad - previousLoad) / previousLoad * 100).toFixed(1)) : null;
      const latestSleep = [...sleep].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
      const latestHrv = [...hrv].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
      const latestMetric = [...metrics].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
      const signals: Array<{ level: "info" | "warning"; message: string }> = [];
      if (daysToRace <= 14 && previousLoad > 0) {
        signals.push(loadChangePercent != null && loadChangePercent <= -10
          ? { level: "info", message: `Seven-day training load is declining (${loadChangePercent}%).` }
          : { level: "warning", message: `Seven-day training load is not clearly declining (${loadChangePercent ?? "unavailable"}%).` });
      }
      if (latestSleep?.totalDurationMinutes != null && latestSleep.totalDurationMinutes < 360) signals.push({ level: "warning", message: `Latest sleep duration is below 6 hours (${latestSleep.totalDurationMinutes} min).` });
      const hrvBaseline = latestHrv?.baseline ?? latestMetric?.hrvBaseline ?? null;
      if (latestHrv?.average != null && hrvBaseline != null && latestHrv.average < hrvBaseline * 0.85) signals.push({ level: "warning", message: "Latest HRV is more than 15% below its COROS baseline." });
      if (!planned.length) signals.push({ level: "info", message: "No planned COROS workouts were found between the assessment and race dates." });
      const errors = sources.flatMap((source, index) => source.status === "rejected"
        ? [{ source: ["activities", "sleep", "hrv", "dailyMetrics", "calendar"][index], error: source.reason instanceof Error ? source.reason.message : String(source.reason) }]
        : []);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        ...sleepMetadata(sleepResolution),
        raceDate: race, asOfDate: asOf, daysToRace,
        loadWindows: { current: { startDate: currentStart, endDate: asOf, trainingLoad: currentLoad }, previous: { startDate: previousStart, endDate: previousEnd, trainingLoad: previousLoad }, changePercent: loadChangePercent },
        currentRecovery: { sleep: latestSleep, hrv: latestHrv, dailyMetrics: latestMetric },
        plannedWorkouts: planned,
        signals, errors,
        note: "Decision support only. No readiness score is manufactured and no COROS data is changed.",
      }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to assess taper readiness: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "analyze_gpx_route",
  "Analyze a GPX track or route without external writes. Returns distance, elevation, endpoints and compact fixed-distance sectors with coordinates, grade and bearing.",
  {
    gpxXml: z.string().min(1).describe("Complete GPX XML document"),
    segmentDistanceKm: z.number().min(2).max(100).default(25),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ gpxXml, segmentDistanceKm }) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(analyzeGpxRoute(gpxXml, segmentDistanceKm), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to analyze GPX route: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "analyze_route_weather",
  "Combine a GPX route with Open-Meteo hourly forecasts. Estimates arrival per sector and reports temperature, rain, wind, gusts, headwind/crosswind components, daylight and explicit risks.",
  {
    gpxXml: z.string().min(1).describe("Complete GPX XML document"),
    startTimeIso: z.string().describe("Departure timestamp in ISO 8601 format including timezone"),
    averageMovingSpeedKmh: z.number().positive().max(80),
    totalStopMinutes: z.number().min(0).max(1440).default(0),
    segmentDistanceKm: z.number().min(10).max(100).default(25),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ gpxXml, startTimeIso, averageMovingSpeedKmh, totalStopMinutes, segmentDistanceKm }) => {
    try {
      const result = await analyzeRouteWeather(gpxXml, startTimeIso, averageMovingSpeedKmh, totalStopMinutes, segmentDistanceKm);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to analyze route weather: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "simulate_ultra_route",
  "Build optimistic, probable and conservative timing scenarios from a GPX route, departure time, flat-terrain speed, planned stops and an explicit climbing penalty. Returns sector checkpoints and finish times.",
  {
    gpxXml: z.string().min(1).describe("Complete GPX XML document"),
    startTimeIso: z.string().describe("Departure timestamp in ISO 8601 format including timezone"),
    flatSpeedKmh: z.number().positive().max(80),
    totalStopMinutes: z.number().min(0).max(1440),
    climbPenaltyMinutesPer1000m: z.number().min(0).max(180).optional().describe("Legacy cycling-compatible ascent penalty; activity-specific default applies when omitted"),
    segmentDistanceKm: z.number().min(10).max(100).default(25),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ gpxXml, startTimeIso, flatSpeedKmh, totalStopMinutes, climbPenaltyMinutesPer1000m, segmentDistanceKm }) => {
    try {
      const result = simulateUltraRoute(gpxXml, startTimeIso, flatSpeedKmh, totalStopMinutes, climbPenaltyMinutesPer1000m, segmentDistanceKm);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to simulate ultra route: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

const PlannedRouteStopSchema = z.object({
  name: z.string().min(1).max(100),
  km: z.number().min(0),
  durationMinutes: z.number().min(0).max(360),
  notes: z.string().max(500).optional(),
});

server.tool(
  "plan_operational_route",
  "Build an operational GPX plan for cycling, road running, trail running, walking or hiking: three timing scenarios, named stops, climbs, daylight, fueling and optional weather. Read-only.",
  {
    gpxXml: z.string().min(1).describe("Complete GPX XML document"),
    startTimeIso: z.string().describe("Departure timestamp in ISO 8601 format including timezone"),
    activityType: z.enum(["cycling", "road_running", "trail_running", "walking", "hiking"]).default("cycling"),
    flatSpeedKmh: z.number().positive().max(80).optional().describe("Base flat-terrain speed; optional when basePaceMinutesPerKm is supplied"),
    basePaceMinutesPerKm: z.number().min(0.75).max(60).optional().describe("Base pace for running, trail, walking or hiking"),
    unallocatedStopMinutes: z.number().min(0).max(1440).default(0),
    climbPenaltyMinutesPer1000m: z.number().min(0).max(180).default(45),
    ascentPenaltyMinutesPer100m: z.number().min(0).max(30).optional(),
    descentPenaltyMinutesPer100m: z.number().min(0).max(30).optional(),
    terrainFactor: z.number().min(0.8).max(3).optional().describe("Manual terrain multiplier; 1 is neutral and values above 1 slow the estimate"),
    segmentDistanceKm: z.number().min(5).max(100).default(10),
    plannedStops: z.array(PlannedRouteStopSchema).max(30).default([]),
    carbsGramsPerHour: z.number().min(0).max(150).default(80),
    fluidMlPerHour: z.number().min(0).max(1500).default(500),
    sodiumMgPerHour: z.number().min(0).max(2000).default(500),
    fuelingIntervalMinutes: z.number().int().min(20).max(60).default(30),
    includeWeather: z.boolean().default(true),
    usePersonalCalibration: z.boolean().default(false).describe("Fit effective speed/pace and ascent cost from comparable COROS activities"),
    calibrationLookbackDays: z.number().int().min(30).max(365).default(90),
    allowLowConfidenceCalibration: z.boolean().default(false).describe("Apply a low-confidence fit; false keeps sport defaults and only reports the calibration"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async (input) => {
    try {
      let effectiveInput = { ...input };
      let personalCalibration: Record<string, unknown> | null = null;
      if (input.usePersonalCalibration) {
        const auth = await getValidAuth();
        if (!auth) return { content: [{ type: "text" as const, text: "Personal calibration requires COROS authentication." }], isError: true };
        const endDate = normalizeScheduleDate(input.startTimeIso.slice(0, 10));
        const startDate = addDaysToScheduleDate(endDate, -(input.calibrationLookbackDays - 1));
        const history = await fetchActivities(auth, startDate, endDate, 1, 100);
        const fitted = calibrateSportPerformance(history.activities, input.activityType as CalibratedSport);
        const canApply = fitted.available && fitted.calibratedParameters != null && (fitted.fit?.confidence !== "low" || input.allowLowConfidenceCalibration);
        personalCalibration = {
          ...fitted,
          applied: canApply,
          applicationReason: canApply ? "Calibration applied; explicit user parameters still take precedence." : fitted.available ? "Calibration reported but not applied because confidence is low." : fitted.reason,
        };
        if (canApply && fitted.calibratedParameters) {
          const calibrated = fitted.calibratedParameters;
          effectiveInput = {
            ...effectiveInput,
            flatSpeedKmh: input.flatSpeedKmh ?? (input.basePaceMinutesPerKm == null ? calibrated.effectiveBaseSpeedKmh : undefined),
            ascentPenaltyMinutesPer100m: input.ascentPenaltyMinutesPer100m ?? (input.climbPenaltyMinutesPer1000m == null ? calibrated.ascentPenaltyMinutesPer100m : undefined),
          };
        }
      }
      const result = await planOperationalRoute(input.gpxXml, effectiveInput);
      return { content: [{ type: "text" as const, text: JSON.stringify({ ...result, personalCalibration }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to plan operational route: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "calibrate_sport_performance",
  "Fit an effective base speed/pace and ascent penalty from comparable COROS activity summaries. Excludes indoor cycling for outdoor-route calibration and reports fit error, confidence and limitations.",
  {
    sport: z.enum(["cycling", "road_running", "trail_running", "walking", "hiking"]),
    endDate: z.string().describe("Calibration end date in YYYY-MM-DD or YYYYMMDD format"),
    lookbackDays: z.number().int().min(30).max(365).default(90),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ sport, endDate, lookbackDays }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const compactEnd = normalizeScheduleDate(endDate);
      const compactStart = addDaysToScheduleDate(compactEnd, -(lookbackDays - 1));
      const history = await fetchActivities(auth, compactStart, compactEnd, 1, 100);
      const calibration = calibrateSportPerformance(history.activities, sport);
      return { content: [{ type: "text" as const, text: JSON.stringify({ requestedRange: { startDate: compactStart, endDate: compactEnd, lookbackDays }, returnedActivities: history.activities.length, totalActivitiesReportedByCoros: history.total, truncated: history.total > history.activities.length, calibration }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to calibrate sport performance: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "analyze_multisport_load",
  "Aggregate a date range across cycling, running, trail, walking, hiking, strength and mobility. Keeps COROS cardiovascular load separate from heuristic impact exposure and recorded strength duration.",
  {
    startDate: z.string(),
    endDate: z.string(),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const history = await fetchActivities(auth, startDate, endDate, 1, 100);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        ...buildMultisportLoadReport(history.activities),
        source: { returnedActivities: history.activities.length, totalActivitiesReportedByCoros: history.total, truncated: history.total > history.activities.length },
      }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to analyze multisport load: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "connector_status",
  "Return the deployed connector version, expected tool count, authentication state and enabled feature groups. Use this to detect stale ChatGPT tool catalogs.",
  {},
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async () => {
    const auth = await getValidAuth();
    return { content: [{ type: "text" as const, text: JSON.stringify({
      name: "coros-workout-chatgpt",
      version: CONNECTOR_VERSION,
      expectedToolCount: EXPECTED_TOOL_COUNT,
      authenticated: Boolean(auth),
      region: auth?.region ?? null,
      features: CONNECTOR_FEATURES,
    }, null, 2) }] };
  }
);

// Stable compatibility bridge. These schemas intentionally avoid operation enums so
// future server-side operations remain callable from chats that cached this catalog.
server.tool(
  "coros_capabilities",
  "Use this when a COROS function is missing from the chat catalog or before calling the stable compatibility bridge. Returns current read/write operation names, input contracts and required confirmations.",
  {},
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async () => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await getCompatibilityCapabilities(), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to read COROS capabilities: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "coros_read",
  "Use this when a specific COROS read-only tool is absent from an older chat. Call coros_capabilities first, then pass its operation name and input object. The schema stays stable while server-side operations evolve.",
  {
    operation: z.string().min(1).max(80),
    input: z.record(z.unknown()).default({}),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ operation, input }) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await executeCompatibilityRead(operation, input), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `COROS read failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "coros_write",
  "Use this when a specific COROS write tool is absent from an older chat. Call coros_capabilities first. Writes use an allowlist, validate inputs and require the exact confirmation returned for that operation.",
  {
    operation: z.string().min(1).max(80),
    input: z.record(z.unknown()).default({}),
    confirmation: z.string().min(1).max(20),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ operation, input, confirmation }) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await executeCompatibilityWrite(operation, input, confirmation), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `COROS write failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "get_activity_export_url",
  "Request a temporary COROS download URL for one completed activity in FIT, GPX, TCX, KML or CSV format. Read-only; the URL may expire.",
  {
    activityId: z.string().min(1),
    sportType: z.number().int(),
    format: z.enum(["fit", "gpx", "tcx", "kml", "csv"]).default("fit"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ activityId, sportType, format }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify(await fetchActivityExportUrl(auth, activityId, sportType, format), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to export activity: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "analyze_fit_activity",
  "Download and analyze the FIT file for a completed COROS activity. Returns bounded summaries of record-level HR, cadence, speed, power, temperature, stops, climbs, aerobic decoupling and finish quality; raw samples are not returned.",
  {
    activityId: z.string().min(1),
    sportType: z.number().int(),
    stopSpeedMetersPerSecond: z.number().min(0).max(3).default(0.5),
    minimumStopSeconds: z.number().int().min(5).max(600).default(20),
    maxReturnedClimbs: z.number().int().min(1).max(20).default(10),
    stopBoundaryIgnoreSeconds: z.number().int().min(0).max(600).default(60),
    targetHeartRateMin: z.number().int().min(30).max(250).optional(),
    targetHeartRateMax: z.number().int().min(30).max(250).optional(),
    targetCadenceMin: z.number().int().min(1).max(250).optional(),
    targetCadenceMax: z.number().int().min(1).max(250).optional(),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ activityId, sportType, stopSpeedMetersPerSecond, minimumStopSeconds, maxReturnedClimbs, stopBoundaryIgnoreSeconds, targetHeartRateMin, targetHeartRateMax, targetCadenceMin, targetCadenceMax }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const result = await fetchAndAnalyzeFitActivity(auth, activityId, sportType, {
        stopSpeedMetersPerSecond,
        minimumStopSeconds,
        maxReturnedSections: maxReturnedClimbs,
        stopBoundaryIgnoreSeconds,
        targetHeartRateMin,
        targetHeartRateMax,
        targetCadenceMin,
        targetCadenceMax,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to analyze FIT activity: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "get_athlete_profile_metrics",
  "Return a consolidated COROS physiological profile and period trends: VO2max, lactate threshold HR/pace, base fitness, training indices, HRV and resting HR. Missing data is explicit and never estimated.",
  {
    asOfDate: z.string().describe("End date in YYYY-MM-DD or YYYYMMDD format"),
    lookbackDays: z.number().int().min(7).max(168).default(28),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ asOfDate, lookbackDays }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const endDate = normalizeScheduleDate(asOfDate);
      const startDate = addDaysToScheduleDate(endDate, -(lookbackDays - 1));
      const records = await fetchDailyMetrics(auth, startDate, endDate);
      return { content: [{ type: "text" as const, text: JSON.stringify(buildAthleteProfileMetrics(records), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to build athlete profile: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "get_readiness_summary",
  "MANDATORY SLEEP ROUTING: first call COROS_MCP_2 querySleepData for this wake-up date and pass the normalized result as officialSleepRecords. Then combine sleep, HRV, load, completed activities and calendar. Do not invent a readiness score.",
  { officialSleepRecords: OfficialSleepSchema, date: z.string() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ officialSleepRecords, date }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const compactDate = date.replaceAll("-", "");
      const sleepResolution = await resolveSleepRecords({ officialSleepRecords, auth, startDate: date, endDate: date });
      const sources = await Promise.allSettled([
        Promise.resolve(sleepResolution.records),
        fetchHrv(auth),
        fetchDailyMetrics(auth, date, date),
        fetchActivities(auth, date, date, 1, 100),
        listScheduledWorkouts(auth, date, date),
      ]);
      const value = <T>(index: number, fallback: T): T => sources[index].status === "fulfilled" ? sources[index].value as T : fallback;
      const errors = sources.flatMap((source, index) => source.status === "rejected" ? [{ source: ["sleep", "hrv", "dailyMetrics", "activities", "calendar"][index], error: source.reason instanceof Error ? source.reason.message : String(source.reason) }] : []);
      const hrv = value<Awaited<ReturnType<typeof fetchHrv>>>(1, []).find((record) => record.date === compactDate) ?? null;
      const result = {
        ...sleepMetadata(sleepResolution),
        date: compactDate,
        sleep: value<OfficialSleepRecord[]>(0, [])[0] ?? null,
        hrv,
        dailyMetrics: value<Awaited<ReturnType<typeof fetchDailyMetrics>>>(2, []).find((record) => record.date === compactDate) ?? null,
        completedActivities: value<Awaited<ReturnType<typeof fetchActivities>>>(3, { activities: [], total: 0 }),
        plannedWorkouts: value<Awaited<ReturnType<typeof listScheduledWorkouts>>>(4, []),
        errors,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to build readiness summary: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "compare_plan_to_actual",
  "Compare planned COROS calendar volume with completed activities by date for a selected range.",
  { startDate: z.string(), endDate: z.string() },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  async ({ startDate, endDate }) => {
    try {
      const auth = await getValidAuth();
      if (!auth) return { content: [{ type: "text" as const, text: "Not authenticated." }], isError: true };
      const [planned, completed] = await Promise.all([
        listScheduledWorkouts(auth, startDate, endDate),
        fetchActivities(auth, startDate, endDate, 1, 100),
      ]);
      const dates = [...new Set([...planned.map((item) => item.date), ...completed.activities.map((item) => item.date).filter(Boolean)])].sort();
      const comparison = dates.map((date) => {
        const plannedItems = planned.filter((item) => item.date === date);
        const actualItems = completed.activities.filter((item) => item.date === date);
        return {
          date,
          planned: {
            count: plannedItems.length,
            durationSeconds: plannedItems.reduce((sum, item) => sum + item.duration, 0),
            distanceMeters: plannedItems.reduce((sum, item) => sum + item.distance / 100, 0),
            names: plannedItems.map((item) => item.name),
          },
          completed: {
            count: actualItems.length,
            durationSeconds: actualItems.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0),
            distanceMeters: actualItems.reduce((sum, item) => sum + (item.distanceMeters ?? 0), 0),
            trainingLoad: actualItems.reduce((sum, item) => sum + (item.trainingLoad ?? 0), 0),
            names: actualItems.map((item) => item.name ?? item.sportName),
          },
        };
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ startDate, endDate, comparison }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Failed to compare plan and activities: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

return server;
}
