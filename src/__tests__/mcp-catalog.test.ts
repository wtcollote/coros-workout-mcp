import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCorosWorkoutServer } from "../index.js";

const closeables: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.allSettled(closeables.splice(0).map((item) => item.close()));
});

describe("published MCP catalog", () => {
  it("publishes all 56 tools with valid object schemas", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createCorosWorkoutServer();
    const client = new Client({ name: "catalog-test", version: "1.0.0" });
    closeables.push(client, server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name);
    expect(names).toHaveLength(56);
    expect(new Set(names).size).toBe(56);
    expect(names).toEqual([
      "authenticate_coros",
      "check_coros_auth",
      "search_exercises",
      "create_workout",
      "update_exercises",
      "list_workouts",
      "assign_workout_to_calendar",
      "create_structured_workout",
      "delete_workout",
      "list_scheduled_workouts",
      "remove_scheduled_workout",
      "move_scheduled_workout",
      "duplicate_workout",
      "update_workout",
      "create_week_plan",
      "check_calendar_conflicts",
      "summarize_planned_load",
      "swap_calendar_workouts",
      "validate_structured_workout",
      "export_coros_backup",
      "get_workout_details",
      "replace_scheduled_workout",
      "shift_calendar_range",
      "copy_calendar_range",
      "clear_calendar_range",
      "audit_calendar",
      "get_hrv_data",
      "get_daily_metrics",
      "get_sleep_data",
      "list_activities",
      "get_activity_detail",
      "analyze_aerobic_decoupling",
      "analyze_completed_activity",
      "analyze_training_day",
      "daily_training_briefing",
      "preview_daily_adjustment",
      "calculate_fueling_plan",
      "compare_activity_history",
      "weekly_training_report",
      "analyze_workout_execution",
      "taper_readiness",
      "analyze_gpx_route",
      "analyze_route_weather",
      "simulate_ultra_route",
      "plan_operational_route",
      "calibrate_sport_performance",
      "analyze_multisport_load",
      "connector_status",
      "coros_capabilities",
      "coros_read",
      "coros_write",
      "get_activity_export_url",
      "analyze_fit_activity",
      "get_athlete_profile_metrics",
      "get_readiness_summary",
      "compare_plan_to_actual",
    ]);
    for (const name of ["get_sleep_data", "get_readiness_summary", "daily_training_briefing", "weekly_training_report", "preview_daily_adjustment", "taper_readiness"]) {
      const schema = result.tools.find((tool) => tool.name === name)!.inputSchema;
      expect(schema.properties).toHaveProperty("officialSleepRecords");
      expect(schema.required ?? []).not.toContain("officialSleepRecords");
    }
    for (const tool of result.tools) {
      expect(tool.inputSchema.type, `${tool.name} must publish an object schema`).toBe("object");
      expect(tool.inputSchema).toHaveProperty("properties");
    }
  });
});
