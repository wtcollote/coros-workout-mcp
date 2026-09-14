import { describe, expect, it } from "vitest";
import { FitBaseType, FitEncoder } from "fit-file-parser";
import { analyzeFitBuffer } from "../fit-analysis.js";

describe("FIT activity analysis", () => {
  it("parses record-level data into a bounded analysis", async () => {
    const encoder = new FitEncoder();
    const started = new Date("2026-09-03T06:00:00Z");
    for (let index = 0; index < 120; index++) {
      encoder.writeMessage(20, [
        { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(started.getTime() + index * 1000)) },
        { number: 5, size: 4, baseType: FitBaseType.Uint32, value: index * 300 },
        { number: 2, size: 2, baseType: FitBaseType.Uint16, value: 2500 + index },
        { number: 3, size: 1, baseType: FitBaseType.Uint8, value: index < 60 ? 130 : 135 },
        { number: 4, size: 1, baseType: FitBaseType.Uint8, value: 85 },
        { number: 6, size: 2, baseType: FitBaseType.Uint16, value: 3000 },
        { number: 7, size: 2, baseType: FitBaseType.Uint16, value: 180 },
        { number: 13, size: 1, baseType: FitBaseType.Sint8, value: 18 },
      ]);
    }
    const bytes = Buffer.from(encoder.close());
    const analysis = await analyzeFitBuffer(bytes) as {
      source: { records: number };
      session: { distanceMeters: number; averageHeartRate: number | null };
      aerobicDecoupling: { available: boolean; decouplingPercent: number };
      climbs: unknown[];
    };
    expect(analysis.source.records).toBe(120);
    expect(analysis.session.distanceMeters).toBe(357);
    expect(analysis.aerobicDecoupling.available).toBe(true);
    expect(analysis.aerobicDecoupling.decouplingPercent).toBeGreaterThan(0);
    expect(analysis.climbs.length).toBeLessThanOrEqual(10);
  });

  it("rejects non-FIT bytes", async () => {
    await expect(analyzeFitBuffer(Buffer.from("not a fit file"))).rejects.toBeTruthy();
  });
});
