import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AthleteProfile {
  schemaVersion: string;
  profileId: string;
  primaryDiscipline: string;
  secondaryDisciplines: string[];
  preferredMetrics: string[];
  availableMetrics: { power: boolean | null; heartRate: boolean | null; cadence: boolean | null };
  constraints: Array<{ id: string; label: string; rule: string }>;
  planning: { weekStartsOn: string; protectLongSessionRecovery: boolean; requireContextGuardForCalendarWrites: boolean };
  objectives: Array<{ name: string; discipline: string; distanceKm: number | null; elevationGainMeters: number | null; targetDurationHours: number | null; eventDate: string | null }>;
  provenance: { source: string; lastReviewed: string; unknownValuesRemainNull: boolean };
}

const DEFAULT_PROFILE_PATH = resolve(process.cwd(), "data", "athlete-profile.json");

function parseProfile(value: string): AthleteProfile {
  const parsed = JSON.parse(value) as AthleteProfile;
  if (!parsed.schemaVersion || !parsed.profileId || !parsed.primaryDiscipline || !Array.isArray(parsed.constraints)) {
    throw new Error("Athlete profile is missing required fields.");
  }
  return parsed;
}

export function loadAthleteProfile(): AthleteProfile {
  const inline = process.env.ATHLETE_PROFILE_JSON;
  if (inline) return parseProfile(inline);
  const path = process.env.ATHLETE_PROFILE_PATH || DEFAULT_PROFILE_PATH;
  return parseProfile(readFileSync(path, "utf8"));
}

export function publicAthleteProfile(): Record<string, unknown> {
  const profile = loadAthleteProfile();
  return {
    ...profile,
    storage: {
      source: process.env.ATHLETE_PROFILE_JSON ? "ATHLETE_PROFILE_JSON" : process.env.ATHLETE_PROFILE_PATH ? "ATHLETE_PROFILE_PATH" : "bundled profile",
      note: "The profile is server-side and independent of chat memory. Unknown values remain explicit; credentials are never stored here.",
    },
  };
}
