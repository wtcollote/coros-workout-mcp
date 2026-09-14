import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_BRIDGE_VERSION,
  CONNECTOR_VERSION,
  CONNECTOR_FEATURES,
  EXPECTED_TOOL_COUNT,
  READ_OPERATIONS,
  WRITE_OPERATIONS,
  executeCompatibilityRead,
  executeCompatibilityWrite,
} from "../compatibility-bridge.js";

describe("stable compatibility bridge", () => {
  it("publishes stable version metadata and unique operation names", () => {
    expect(CONNECTOR_VERSION).toBe("2.2.4");
    expect(COMPATIBILITY_BRIDGE_VERSION).toBe("2");
    expect(EXPECTED_TOOL_COUNT).toBe(56);

    const names = [...READ_OPERATIONS, ...WRITE_OPERATIONS].map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
    expect(READ_OPERATIONS.some((item) => item.name === "professional_coaching_analysis")).toBe(true);
    expect(CONNECTOR_FEATURES).toContain("mobile-session-safe");
    expect(CONNECTOR_FEATURES).toContain("official-oauth-recovery-ingestion");

    const coaching = READ_OPERATIONS.find((item) => item.name === "professional_coaching_analysis");
    expect(coaching?.input).toHaveProperty("officialSleepRecords");
  });

  it("rejects an unknown read operation before accessing COROS", async () => {
    await expect(executeCompatibilityRead("not_a_real_operation", {})).rejects.toThrow(
      "Unsupported read operation"
    );
  });

  it("serves the methodology catalog through the stable bridge without COROS authentication", async () => {
    const response = await executeCompatibilityRead("coaching_methodology_catalog", { sport: "cycling" }) as Record<string, any>;
    expect(response.connectorVersion).toBe("2.2.4");
    expect(response.result.knowledgeVersion).toBe("2026.09");
    expect(response.result.methods.length).toBeGreaterThan(5);
    expect(response.result.methods.every((method: Record<string, any>) => method.sports.includes("all") || method.sports.includes("cycling"))).toBe(true);
  });

  it("rejects an unknown write operation before accessing COROS", async () => {
    await expect(executeCompatibilityWrite("not_a_real_operation", {}, "CONFIRM")).rejects.toThrow(
      "Unsupported write operation"
    );
  });

  it("requires the destructive confirmation token before accessing COROS", async () => {
    await expect(executeCompatibilityWrite("delete_workout", { workoutId: "123" }, "CONFIRM")).rejects.toThrow(
      "confirmation='DELETE'"
    );
  });

  it("requires confirmation for non-destructive writes before accessing COROS", async () => {
    await expect(executeCompatibilityWrite("assign_workout_to_calendar", { workoutId: "123", date: "2026-09-05" }, "DELETE")).rejects.toThrow(
      "confirmation='CONFIRM'"
    );
  });
});
