import { promises as fs } from "node:fs";
import path from "node:path";

export interface CoachChange {
  id: string;
  at: string;
  type: "assessment" | "plan_change" | "calendar_change" | "recommendation" | "note";
  title: string;
  summary: string;
  reason?: string;
  effectiveDate?: string;
  status?: "active" | "completed" | "superseded";
  corosSynced?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CoachState {
  version: 1;
  updatedAt: string;
  headline?: string;
  dailyAssessment?: {
    date: string;
    decision: string;
    summary: string;
    reasons?: string[];
    confidence?: "low" | "medium" | "high";
  };
  currentPlan?: { phase?: string; objective?: string; eventDate?: string; notes?: string[] };
  changes: CoachChange[];
}

const statePath = process.env.COACH_STATE_PATH ?? path.resolve("data/coach-state.json");
const redisUrl = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/$/, "");
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const redisKey = process.env.COACH_STATE_REDIS_KEY ?? "coros:coach_state:v1";
const redisEnabled = Boolean(redisUrl && redisToken);
const emptyState = (): CoachState => ({ version: 1, updatedAt: new Date(0).toISOString(), changes: [] });

function normalizeState(parsed: Partial<CoachState> | null | undefined): CoachState {
  return { ...emptyState(), ...(parsed ?? {}), changes: Array.isArray(parsed?.changes) ? parsed!.changes! : [] } as CoachState;
}

async function redisCommand(command: string, ...args: string[]): Promise<unknown> {
  const response = await fetch(redisUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${redisToken}`, "content-type": "application/json" },
    body: JSON.stringify([command, ...args]),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Upstash Redis ${command} failed (${response.status}): ${text.slice(0, 240)}`);
  const payload = JSON.parse(text) as { result?: unknown; error?: string };
  if (payload.error) throw new Error(`Upstash Redis ${command} failed: ${payload.error}`);
  return payload.result;
}

async function readLocal(): Promise<CoachState> {
  try {
    return normalizeState(JSON.parse(await fs.readFile(statePath, "utf8")) as CoachState);
  } catch (error: any) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeLocal(next: CoachState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, statePath);
}

export function coachStateStorageInfo() {
  return { provider: redisEnabled ? "upstash-redis" : "local-file", persistent: redisEnabled, key: redisEnabled ? redisKey : undefined };
}

export async function readCoachState(): Promise<CoachState> {
  if (!redisEnabled) return readLocal();
  const raw = await redisCommand("GET", redisKey);
  if (raw === null || raw === undefined || raw === "") return emptyState();
  if (typeof raw !== "string") throw new Error("Unexpected coach state value returned by Upstash Redis.");
  return normalizeState(JSON.parse(raw) as CoachState);
}

export async function updateCoachState(input: Partial<CoachState> & { appendChange?: Omit<CoachChange, "id" | "at"> }): Promise<CoachState> {
  const current = await readCoachState();
  const now = new Date().toISOString();
  const changes = [...current.changes];
  if (input.appendChange) changes.unshift({ id: `coach_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, at: now, ...input.appendChange });
  const next: CoachState = {
    ...current,
    ...(input.headline !== undefined ? { headline: input.headline } : {}),
    ...(input.dailyAssessment !== undefined ? { dailyAssessment: input.dailyAssessment } : {}),
    ...(input.currentPlan !== undefined ? { currentPlan: input.currentPlan } : {}),
    version: 1,
    updatedAt: now,
    changes: changes.slice(0, 200),
  };
  if (redisEnabled) await redisCommand("SET", redisKey, JSON.stringify(next));
  else await writeLocal(next);
  return next;
}
