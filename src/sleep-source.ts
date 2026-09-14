import { z } from "zod";
import { normalizeScheduleDate } from "./coros-api.js";
import { getOfficialSleepNormalized } from "./official-oauth.js";
import type { AuthData } from "./types.js";

const metric = z.number().finite().nonnegative().nullable().default(null);
export const OfficialSleepRecordSchema = z.object({
  date: z.string().min(1),
  totalDurationMinutes: metric,
  deepMinutes: metric,
  lightMinutes: metric,
  remMinutes: metric,
  awakeMinutes: metric,
  napMinutes: metric,
  averageHeartRate: metric,
  minimumHeartRate: metric,
  maximumHeartRate: metric,
  qualityScore: metric,
});
export type OfficialSleepRecord = z.infer<typeof OfficialSleepRecordSchema>;
export const OfficialSleepSchema = z.array(OfficialSleepRecordSchema).max(180).optional();

export function normalizeOfficialSleepRecords(records: OfficialSleepRecord[], startDate: string, endDate: string): OfficialSleepRecord[] {
  const start = normalizeScheduleDate(startDate);
  const end = normalizeScheduleDate(endDate);
  if (start > end) throw new Error("startDate must not be after endDate.");
  return records.map((record) => ({ ...OfficialSleepRecordSchema.parse(record), date: normalizeScheduleDate(record.date) }))
    .filter((record) => record.date >= start && record.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface SleepResolution {
  status: "available" | "unavailable";
  sleepSource: "COROS MCP official OAuth" | "COROS unofficial mobile" | "unavailable";
  records: OfficialSleepRecord[];
  reason?: string;
}

export async function resolveSleepRecords({ officialSleepRecords, auth, startDate, endDate }: {
  officialSleepRecords?: OfficialSleepRecord[];
  auth?: AuthData | null;
  startDate: string;
  endDate: string;
}): Promise<SleepResolution> {
  if (officialSleepRecords !== undefined) {
    const records = normalizeOfficialSleepRecords(officialSleepRecords, startDate, endDate);
    return { status: records.length ? "available" : "unavailable", sleepSource: "COROS MCP official OAuth", records,
      ...(records.length ? {} : { reason: "No official sleep records in the requested date range." }) };
  }
  try {
    const records = normalizeOfficialSleepRecords(await getOfficialSleepNormalized(startDate, endDate), startDate, endDate);
    return { status: records.length ? "available" : "unavailable", sleepSource: "COROS MCP official OAuth", records,
      ...(records.length ? {} : { reason: "No official sleep records in the requested date range." }) };
  } catch (error) {
    return { status: "unavailable", sleepSource: "unavailable", records: [], reason: error instanceof Error ? error.message : String(error) };
  }
}

export function sleepMetadata(resolution: SleepResolution) {
  return { sleepStatus: resolution.status, sleepSource: resolution.sleepSource, ...(resolution.reason ? { sleepUnavailableReason: resolution.reason } : {}) };
}
