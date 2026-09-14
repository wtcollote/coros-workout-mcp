import FitParser from "fit-file-parser";

type FitValue = string | number | Date | null | undefined;
type FitRecord = Record<string, FitValue>;

export interface FitAnalysisOptions {
  stopSpeedMetersPerSecond?: number;
  minimumStopSeconds?: number;
  maxReturnedSections?: number;
  stopBoundaryIgnoreSeconds?: number;
  targetHeartRateMin?: number;
  targetHeartRateMax?: number;
  targetCadenceMin?: number;
  targetCadenceMax?: number;
}

function number(value: FitValue): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: FitValue): number | null {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(String(value ?? "")).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value: number | null, digits = 2): number | null {
  return value == null ? null : Number(value.toFixed(digits));
}

function field(record: FitRecord, ...names: string[]): number | null {
  for (const name of names) {
    const value = number(record[name]);
    if (value != null) return value;
  }
  return null;
}

function weightedEfficiency(records: FitRecord[]): { heartRate: number; speed: number; efficiency: number } | null {
  const valid = records.flatMap((record) => {
    const heartRate = field(record, "heart_rate");
    const speed = field(record, "enhanced_speed", "speed");
    return heartRate != null && heartRate > 0 && speed != null && speed > 0
      ? [{ heartRate, speed }]
      : [];
  });
  if (valid.length < 30) return null;
  const heartRate = average(valid.map((item) => item.heartRate))!;
  const speed = average(valid.map((item) => item.speed))!;
  return { heartRate, speed, efficiency: speed / heartRate };
}

function detectStops(records: FitRecord[], speedThreshold: number, minimumSeconds: number, boundaryIgnoreSeconds: number) {
  const stops: Array<{ startTime: string; durationSeconds: number }> = [];
  let startIndex: number | null = null;
  for (let index = 0; index < records.length; index++) {
    const speed = field(records[index], "enhanced_speed", "speed");
    const stopped = speed != null && speed <= speedThreshold;
    if (stopped && startIndex == null) startIndex = index;
    if ((!stopped || index === records.length - 1) && startIndex != null) {
      const endIndex = stopped ? index : Math.max(startIndex, index - 1);
      const start = timestamp(records[startIndex].timestamp);
      const end = timestamp(records[endIndex].timestamp);
      const durationSeconds = start != null && end != null ? Math.max(0, (end - start) / 1000) : endIndex - startIndex;
      const activityStart = timestamp(records[0].timestamp);
      const activityEnd = timestamp(records[records.length - 1].timestamp);
      const insideBoundary = start != null && end != null && activityStart != null && activityEnd != null
        && (start - activityStart) / 1000 >= boundaryIgnoreSeconds
        && (activityEnd - end) / 1000 >= boundaryIgnoreSeconds;
      if (durationSeconds >= minimumSeconds && insideBoundary) {
        stops.push({ startTime: start == null ? "unknown" : new Date(start).toISOString(), durationSeconds: Math.round(durationSeconds) });
      }
      startIndex = null;
    }
  }
  return stops;
}

function targetCompliance(records: FitRecord[], fieldNames: string[], minimum?: number, maximum?: number) {
  if (minimum == null && maximum == null) return null;
  const values = records.map((record) => field(record, ...fieldNames)).filter((value): value is number => value != null);
  if (!values.length) return { available: false, reason: "Target supplied but FIT sensor data is unavailable." };
  const inRange = values.filter((value) => (minimum == null || value >= minimum) && (maximum == null || value <= maximum)).length;
  const mean = average(values)!;
  return {
    available: true,
    target: { minimum: minimum ?? null, maximum: maximum ?? null },
    average: round(mean, 1),
    samples: values.length,
    inRangePercent: round(inRange / values.length * 100, 1),
    status: minimum != null && mean < minimum ? "below" : maximum != null && mean > maximum ? "above" : "within",
  };
}

function detectClimbs(records: FitRecord[], limit: number) {
  const climbs: Array<{ startTime: string; endTime: string; elevationGainMeters: number; distanceMeters: number | null; durationSeconds: number | null }> = [];
  let start = 0;
  let gain = 0;
  for (let index = 1; index < records.length; index++) {
    const previous = field(records[index - 1], "enhanced_altitude", "altitude");
    const current = field(records[index], "enhanced_altitude", "altitude");
    if (previous == null || current == null) continue;
    const delta = current - previous;
    if (delta >= -1.5) gain += Math.max(0, delta);
    if (delta < -1.5 || index === records.length - 1) {
      if (gain >= 20) {
        const started = timestamp(records[start].timestamp);
        const ended = timestamp(records[index - 1].timestamp);
        const startDistance = field(records[start], "distance");
        const endDistance = field(records[index - 1], "distance");
        climbs.push({
          startTime: started == null ? "unknown" : new Date(started).toISOString(),
          endTime: ended == null ? "unknown" : new Date(ended).toISOString(),
          elevationGainMeters: Math.round(gain),
          distanceMeters: startDistance != null && endDistance != null ? round(endDistance - startDistance, 0) : null,
          durationSeconds: started != null && ended != null ? Math.round((ended - started) / 1000) : null,
        });
      }
      start = index;
      gain = 0;
    }
  }
  return climbs.sort((a, b) => b.elevationGainMeters - a.elevationGainMeters).slice(0, limit);
}

function segmentSummary(records: FitRecord[]) {
  return {
    averageHeartRate: round(average(records.map((item) => field(item, "heart_rate")).filter((value): value is number => value != null)), 1),
    averageCadence: round(average(records.map((item) => field(item, "cadence")).filter((value): value is number => value != null)), 1),
    averageSpeedMetersPerSecond: round(average(records.map((item) => field(item, "enhanced_speed", "speed")).filter((value): value is number => value != null)), 3),
    averagePowerWatts: round(average(records.map((item) => field(item, "power")).filter((value): value is number => value != null)), 0),
  };
}

export async function analyzeFitBuffer(buffer: Buffer, options: FitAnalysisOptions = {}): Promise<Record<string, unknown>> {
  if (options.targetHeartRateMin != null && options.targetHeartRateMax != null && options.targetHeartRateMin > options.targetHeartRateMax) {
    throw new Error("targetHeartRateMin must not exceed targetHeartRateMax.");
  }
  if (options.targetCadenceMin != null && options.targetCadenceMax != null && options.targetCadenceMin > options.targetCadenceMax) {
    throw new Error("targetCadenceMin must not exceed targetCadenceMax.");
  }
  const parser = new FitParser({ mode: "list", speedUnit: "m/s", lengthUnit: "m", temperatureUnit: "celsius", elapsedRecordField: true });
  const fitInput = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const parsed = await parser.parseAsync(fitInput) as unknown as { records?: FitRecord[]; laps?: FitRecord[]; sessions?: FitRecord[] };
  const records = (parsed.records ?? []).filter((record) => timestamp(record.timestamp) != null);
  if (records.length < 2) throw new Error("The FIT file contains fewer than two timestamped records.");
  const firstTime = timestamp(records[0].timestamp)!;
  const lastTime = timestamp(records[records.length - 1].timestamp)!;
  const durationSeconds = Math.max(0, (lastTime - firstTime) / 1000);
  const session = parsed.sessions?.[0] ?? {};
  const midpoint = Math.floor(records.length / 2);
  const firstHalf = weightedEfficiency(records.slice(0, midpoint));
  const secondHalf = weightedEfficiency(records.slice(midpoint));
  const decouplingPercent = firstHalf && secondHalf
    ? (firstHalf.efficiency - secondHalf.efficiency) / firstHalf.efficiency * 100
    : null;
  const quarter = Math.max(1, Math.floor(records.length / 4));
  const comparison = records.slice(-quarter * 2, -quarter);
  const finish = records.slice(-quarter);
  const comparisonSummary = segmentSummary(comparison);
  const finishSummary = segmentSummary(finish);
  const boundaryIgnoreSeconds = options.stopBoundaryIgnoreSeconds ?? 60;
  const stops = detectStops(records, options.stopSpeedMetersPerSecond ?? 0.5, options.minimumStopSeconds ?? 20, boundaryIgnoreSeconds);
  const temperatures = records.map((item) => field(item, "temperature")).filter((value): value is number => value != null);
  return {
    source: { format: "FIT", bytes: buffer.byteLength, records: records.length, laps: parsed.laps?.length ?? 0 },
    session: {
      startTime: new Date(firstTime).toISOString(),
      durationSeconds: round(field(session, "total_elapsed_time") ?? durationSeconds, 0),
      movingTimeSeconds: round(field(session, "total_timer_time"), 0),
      distanceMeters: round(field(session, "total_distance") ?? field(records[records.length - 1], "distance"), 0),
      elevationGainMeters: round(field(session, "total_ascent"), 0),
      averageHeartRate: round(field(session, "avg_heart_rate"), 1),
      maximumHeartRate: round(field(session, "max_heart_rate"), 1),
      averageCadence: round(field(session, "avg_cadence"), 1),
      averageSpeedMetersPerSecond: round(field(session, "enhanced_avg_speed", "avg_speed"), 3),
      averagePowerWatts: round(field(session, "avg_power"), 0),
      normalizedPowerWatts: round(field(session, "normalized_power"), 0),
      temperatureCelsius: { average: round(average(temperatures), 1), minimum: temperatures.length ? Math.min(...temperatures) : null, maximum: temperatures.length ? Math.max(...temperatures) : null },
    },
    aerobicDecoupling: {
      available: decouplingPercent != null,
      method: "record-level speed/heart-rate efficiency; stopped samples excluded",
      firstHalf: firstHalf && { averageHeartRate: round(firstHalf.heartRate, 1), averageSpeedMetersPerSecond: round(firstHalf.speed, 3), efficiencyFactor: round(firstHalf.efficiency, 5) },
      secondHalf: secondHalf && { averageHeartRate: round(secondHalf.heartRate, 1), averageSpeedMetersPerSecond: round(secondHalf.speed, 3), efficiencyFactor: round(secondHalf.efficiency, 5) },
      decouplingPercent: round(decouplingPercent),
      classification: decouplingPercent == null ? null : decouplingPercent < 0 ? "improved" : decouplingPercent <= 3 ? "stable" : decouplingPercent <= 5 ? "moderate" : "high",
    },
    finishQuality: {
      comparisonWindow: comparisonSummary,
      finalQuarter: finishSummary,
      change: {
        heartRatePercent: comparisonSummary.averageHeartRate && finishSummary.averageHeartRate ? round((finishSummary.averageHeartRate - comparisonSummary.averageHeartRate) / comparisonSummary.averageHeartRate * 100, 1) : null,
        cadencePercent: comparisonSummary.averageCadence && finishSummary.averageCadence ? round((finishSummary.averageCadence - comparisonSummary.averageCadence) / comparisonSummary.averageCadence * 100, 1) : null,
        speedPercent: comparisonSummary.averageSpeedMetersPerSecond && finishSummary.averageSpeedMetersPerSecond ? round((finishSummary.averageSpeedMetersPerSecond - comparisonSummary.averageSpeedMetersPerSecond) / comparisonSummary.averageSpeedMetersPerSecond * 100, 1) : null,
      },
      targetCompliance: {
        heartRate: targetCompliance(finish, ["heart_rate"], options.targetHeartRateMin, options.targetHeartRateMax),
        cadence: targetCompliance(finish, ["cadence"], options.targetCadenceMin, options.targetCadenceMax),
      },
    },
    stops: { count: stops.length, totalDurationSeconds: stops.reduce((sum, stop) => sum + stop.durationSeconds, 0), boundaryIgnoreSeconds, items: stops.slice(0, 20) },
    climbs: detectClimbs(records, options.maxReturnedSections ?? 10),
    limitations: [
      "Climbs are detected from sustained altitude gain and are not official COROS climb segments.",
      "Aerobic decoupling requires at least 30 valid moving samples in each half.",
      "Missing sensor fields remain null and are not estimated.",
    ],
  };
}
