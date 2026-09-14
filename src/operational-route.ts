import { analyzeGpxRoute, analyzeRouteWeather, parseGpx } from "./route-analysis.js";
import type { GpxRouteAnalysis, RoutePoint } from "./route-analysis.js";

export interface PlannedRouteStop {
  name: string;
  km: number;
  durationMinutes: number;
  notes?: string;
}

export interface OperationalRouteOptions {
  startTimeIso: string;
  activityType?: "cycling" | "road_running" | "trail_running" | "walking" | "hiking";
  flatSpeedKmh?: number;
  basePaceMinutesPerKm?: number;
  unallocatedStopMinutes?: number;
  climbPenaltyMinutesPer1000m?: number;
  ascentPenaltyMinutesPer100m?: number;
  descentPenaltyMinutesPer100m?: number;
  terrainFactor?: number;
  segmentDistanceKm?: number;
  plannedStops?: PlannedRouteStop[];
  carbsGramsPerHour?: number;
  fluidMlPerHour?: number;
  sodiumMgPerHour?: number;
  fuelingIntervalMinutes?: number;
  includeWeather?: boolean;
}

interface ScenarioDefinition {
  name: "optimistic" | "probable" | "conservative";
  speedFactor: number;
  stopFactor: number;
  climbFactor: number;
}

interface ScenarioCheckpoint {
  sector: number;
  km: number;
  arrivalTime: string;
  departureTime: string;
  elapsedHours: number;
  scheduledStops: PlannedRouteStop[];
  scheduledStopMinutesInSector: number;
}

interface ScenarioResult {
  scenario: ScenarioDefinition["name"];
  totalHours: number;
  finishTime: string;
  checkpoints: ScenarioCheckpoint[];
  stopSchedule: Array<PlannedRouteStop & { arrivalTime: string; departureTime: string; elapsedHoursAtDeparture: number }>;
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function classifyClimb(gainMeters: number): string {
  if (gainMeters >= 800) return "HC";
  if (gainMeters >= 600) return "1";
  if (gainMeters >= 400) return "2";
  if (gainMeters >= 250) return "3";
  if (gainMeters >= 150) return "4";
  return "uncategorized";
}

export function detectRouteClimbs(gpx: string): Array<Record<string, unknown>> {
  const points = parseGpx(gpx).points.filter((point) => point.elevationMeters != null);
  if (points.length < 2) return [];
  const climbs: Array<Record<string, unknown>> = [];
  let startIndex = 0;
  let peakIndex = 0;
  let accumulatedGain = 0;

  const finishCandidate = () => {
    const start = points[startIndex];
    const peak = points[peakIndex];
    const distanceKm = (peak.distanceMeters - start.distanceMeters) / 1000;
    const netGain = (peak.elevationMeters ?? 0) - (start.elevationMeters ?? 0);
    const effectiveGain = Math.max(accumulatedGain, netGain);
    const roundedGain = Math.round(effectiveGain);
    if (roundedGain >= 80 && netGain >= 60 && distanceKm >= 0.8) {
      climbs.push({
        index: climbs.length + 1,
        startKm: round(start.distanceMeters / 1000, 2),
        summitKm: round(peak.distanceMeters / 1000, 2),
        distanceKm: round(distanceKm, 2),
        accumulatedGainMeters: roundedGain,
        netGainMeters: Math.round(netGain),
        averageGradePercent: round(netGain / Math.max(1, peak.distanceMeters - start.distanceMeters) * 100, 1),
        startElevationMeters: round(start.elevationMeters ?? 0),
        summitElevationMeters: round(peak.elevationMeters ?? 0),
        category: classifyClimb(roundedGain),
      });
    }
  };

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const difference = (current.elevationMeters ?? 0) - (previous.elevationMeters ?? 0);
    if (difference > 1) accumulatedGain += difference;
    if ((current.elevationMeters ?? 0) >= (points[peakIndex].elevationMeters ?? 0)) peakIndex = index;

    const descentFromPeak = (points[peakIndex].elevationMeters ?? 0) - (current.elevationMeters ?? 0);
    const distanceAfterPeak = current.distanceMeters - points[peakIndex].distanceMeters;
    if (descentFromPeak >= 25 || distanceAfterPeak >= 1000) {
      finishCandidate();
      startIndex = index;
      peakIndex = index;
      accumulatedGain = 0;
    } else if (accumulatedGain < 20 && (current.elevationMeters ?? 0) <= (points[startIndex].elevationMeters ?? 0)) {
      startIndex = index;
      peakIndex = index;
      accumulatedGain = 0;
    }
  }
  finishCandidate();
  return climbs;
}

function solarElevationDegrees(date: Date, latitude: number, longitude: number): number {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - startOfYear) / 86400000);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (hour - 12) / 24);
  const equationMinutes = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = ((hour * 60 + equationMinutes + 4 * longitude) % 1440 + 1440) % 1440;
  const hourAngle = (trueSolarMinutes / 4 - 180) * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  return Math.asin(Math.sin(latitudeRadians) * Math.sin(declination) + Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngle)) * 180 / Math.PI;
}

export function getSolarPhase(date: Date, point: { latitude: number; longitude: number }): { phase: "day" | "civil-twilight" | "night"; solarElevationDegrees: number } {
  const elevation = solarElevationDegrees(date, point.latitude, point.longitude);
  return { phase: elevation >= 0 ? "day" : elevation >= -6 ? "civil-twilight" : "night", solarElevationDegrees: round(elevation, 1) };
}

interface ResolvedTimingModel {
  activityType: NonNullable<OperationalRouteOptions["activityType"]>;
  baseSpeedKmh: number;
  basePaceMinutesPerKm: number;
  unallocatedStopMinutes: number;
  ascentPenaltyMinutesPer100m: number;
  descentPenaltyMinutesPer100m: number;
  terrainFactor: number;
}

function resolveTimingModel(options: OperationalRouteOptions): ResolvedTimingModel {
  const activityType = options.activityType ?? "cycling";
  const defaults = {
    cycling: { speed: 25, ascent: 4.5, descent: 0, terrain: 1 },
    road_running: { speed: 10, ascent: 6, descent: 0, terrain: 1 },
    trail_running: { speed: 8, ascent: 10, descent: 1.5, terrain: 1.15 },
    walking: { speed: 5, ascent: 10, descent: 1, terrain: 1 },
    hiking: { speed: 4.5, ascent: 10, descent: 2, terrain: 1.1 },
  }[activityType];
  const baseSpeedKmh = options.basePaceMinutesPerKm != null ? 60 / options.basePaceMinutesPerKm : options.flatSpeedKmh ?? defaults.speed;
  const ascentPenaltyMinutesPer100m = options.ascentPenaltyMinutesPer100m ?? (options.climbPenaltyMinutesPer1000m != null ? options.climbPenaltyMinutesPer1000m / 10 : defaults.ascent);
  const descentPenaltyMinutesPer100m = options.descentPenaltyMinutesPer100m ?? defaults.descent;
  const terrainFactor = options.terrainFactor ?? defaults.terrain;
  if (!Number.isFinite(baseSpeedKmh) || baseSpeedKmh <= 0 || baseSpeedKmh > 80) throw new Error("Resolved base speed must be between 0 and 80 km/h.");
  if (ascentPenaltyMinutesPer100m < 0 || ascentPenaltyMinutesPer100m > 30) throw new Error("ascentPenaltyMinutesPer100m must be between 0 and 30.");
  if (descentPenaltyMinutesPer100m < 0 || descentPenaltyMinutesPer100m > 30) throw new Error("descentPenaltyMinutesPer100m must be between 0 and 30.");
  if (terrainFactor < 0.8 || terrainFactor > 3) throw new Error("terrainFactor must be between 0.8 and 3.");
  return { activityType, baseSpeedKmh, basePaceMinutesPerKm: 60 / baseSpeedKmh, unallocatedStopMinutes: options.unallocatedStopMinutes ?? 0, ascentPenaltyMinutesPer100m, descentPenaltyMinutesPer100m, terrainFactor };
}

function buildScenarios(route: GpxRouteAnalysis, start: Date, model: ResolvedTimingModel, stops: PlannedRouteStop[]): ScenarioResult[] {
  const definitions: ScenarioDefinition[] = [
    { name: "optimistic", speedFactor: 1.06, stopFactor: 0.8, climbFactor: 0.9 },
    { name: "probable", speedFactor: 1, stopFactor: 1, climbFactor: 1 },
    { name: "conservative", speedFactor: 0.92, stopFactor: 1.25, climbFactor: 1.15 },
  ];
  return definitions.map((definition) => {
    let elapsedMinutes = 0;
    const stopSchedule: ScenarioResult["stopSchedule"] = [];
    const checkpoints = route.segments.map((segment) => {
      const movingMinutes = segment.distanceKm / (model.baseSpeedKmh * definition.speedFactor) * 60 * model.terrainFactor;
      const climbingMinutes = segment.elevationGainMeters / 100 * model.ascentPenaltyMinutesPer100m * definition.climbFactor;
      const descendingMinutes = segment.elevationLossMeters / 100 * model.descentPenaltyMinutesPer100m * definition.climbFactor;
      const flexibleStops = model.unallocatedStopMinutes * definition.stopFactor * segment.distanceKm / route.distanceKm;
      const scheduledStops = stops.filter((stop) => stop.km > segment.startKm && stop.km <= segment.endKm && stop.km < route.distanceKm);
      const sectorTravelMinutes = movingMinutes + climbingMinutes + descendingMinutes + flexibleStops;
      let coveredKm = segment.startKm;
      for (const stop of scheduledStops) {
        elapsedMinutes += sectorTravelMinutes * (stop.km - coveredKm) / Math.max(0.001, segment.distanceKm);
        const stopArrival = new Date(start.getTime() + elapsedMinutes * 60000).toISOString();
        elapsedMinutes += stop.durationMinutes * definition.stopFactor;
        stopSchedule.push({ ...stop, arrivalTime: stopArrival, departureTime: new Date(start.getTime() + elapsedMinutes * 60000).toISOString(), elapsedHoursAtDeparture: round(elapsedMinutes / 60, 2) });
        coveredKm = stop.km;
      }
      elapsedMinutes += sectorTravelMinutes * (segment.endKm - coveredKm) / Math.max(0.001, segment.distanceKm);
      const arrivalTime = new Date(start.getTime() + elapsedMinutes * 60000).toISOString();
      const scheduledMinutes = scheduledStops.reduce((sum, stop) => sum + stop.durationMinutes, 0) * definition.stopFactor;
      return {
        sector: segment.index,
        km: segment.endKm,
        arrivalTime,
        departureTime: arrivalTime,
        elapsedHours: round(elapsedMinutes / 60, 2),
        scheduledStops,
        scheduledStopMinutesInSector: Math.round(scheduledMinutes),
      };
    });
    return { scenario: definition.name, totalHours: round(elapsedMinutes / 60, 2), finishTime: new Date(start.getTime() + elapsedMinutes * 60000).toISOString(), checkpoints, stopSchedule };
  });
}

function buildFuelSchedule(start: Date, durationHours: number, intervalMinutes: number, carbsPerHour: number, fluidPerHour: number, sodiumPerHour: number): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const durationMinutes = durationHours * 60;
  for (let elapsed = intervalMinutes; elapsed < durationMinutes + intervalMinutes; elapsed += intervalMinutes) {
    const bounded = Math.min(elapsed, durationMinutes);
    const factor = bounded / 60;
    entries.push({
      elapsedMinutes: Math.round(bounded),
      time: new Date(start.getTime() + bounded * 60000).toISOString(),
      cumulativeCarbohydrateGrams: Math.round(carbsPerHour * factor),
      cumulativeFluidMl: Math.round(fluidPerHour * factor),
      cumulativeSodiumMg: Math.round(sodiumPerHour * factor),
    });
    if (bounded >= durationMinutes) break;
  }
  return entries;
}

function pointForSectorEnd(route: GpxRouteAnalysis, sectorIndex: number): RoutePoint {
  const segment = route.segments[sectorIndex];
  return { ...segment.end, distanceMeters: segment.endKm * 1000 };
}

export async function planOperationalRoute(gpx: string, options: OperationalRouteOptions): Promise<Record<string, unknown>> {
  const start = new Date(options.startTimeIso);
  if (!Number.isFinite(start.getTime())) throw new Error("startTimeIso must be a valid ISO 8601 timestamp with timezone.");
  const segmentDistanceKm = options.segmentDistanceKm ?? 10;
  const route = analyzeGpxRoute(gpx, segmentDistanceKm);
  const model = resolveTimingModel(options);
  if (model.unallocatedStopMinutes < 0 || model.unallocatedStopMinutes > 1440) throw new Error("unallocatedStopMinutes must be between 0 and 1440.");
  const stops = [...(options.plannedStops ?? [])].sort((a, b) => a.km - b.km);
  for (const stop of stops) {
    if (stop.km < 0 || stop.km > route.distanceKm) throw new Error(`Stop ${stop.name} is outside the route distance.`);
    if (stop.durationMinutes < 0 || stop.durationMinutes > 360) throw new Error(`Stop ${stop.name} has an invalid duration.`);
  }
  const scenarios = buildScenarios(route, start, model, stops);
  const probable = scenarios.find((scenario) => scenario.scenario === "probable")!;
  const carbsGramsPerHour = options.carbsGramsPerHour ?? 80;
  const fluidMlPerHour = options.fluidMlPerHour ?? 500;
  const sodiumMgPerHour = options.sodiumMgPerHour ?? 500;
  const fuelingIntervalMinutes = options.fuelingIntervalMinutes ?? 30;

  let weather: Record<string, unknown> | null = null;
  let weatherError: string | null = null;
  if (options.includeWeather ?? true) {
    const effectiveMovingHours = Math.max(0.1, probable.totalHours - (model.unallocatedStopMinutes + stops.reduce((sum, stop) => sum + stop.durationMinutes, 0)) / 60);
    const effectiveSpeed = route.distanceKm / effectiveMovingHours;
    try {
      weather = await analyzeRouteWeather(gpx, options.startTimeIso, effectiveSpeed, model.unallocatedStopMinutes + stops.reduce((sum, stop) => sum + stop.durationMinutes, 0), Math.max(10, segmentDistanceKm));
    } catch (error) {
      weatherError = error instanceof Error ? error.message : String(error);
    }
  }

  const daylightTimeline = probable.checkpoints.map((checkpoint, index) => ({
    sector: checkpoint.sector,
    km: checkpoint.km,
    time: checkpoint.arrivalTime,
    ...getSolarPhase(new Date(checkpoint.arrivalTime), pointForSectorEnd(route, index)),
  }));
  const nightSectors = daylightTimeline.filter((entry) => entry.phase === "night").map((entry) => entry.sector);
  const twilightSectors = daylightTimeline.filter((entry) => entry.phase === "civil-twilight").map((entry) => entry.sector);
  const climbs = detectRouteClimbs(gpx);
  const warnings = [
    `Timing is an estimate for ${model.activityType} based on pace/speed, ascent, descent, terrain and declared stops; calibrate it with recent comparable activities.`,
    "Named-stop ETAs are interpolated inside each sector; use 5-10 km sectors to reduce elevation-allocation error.",
    "Climb detection is heuristic and depends on GPX elevation quality.",
    "Fuel and hydration values are user-supplied targets, not medical advice.",
    ...(weatherError ? [`Weather unavailable: ${weatherError}`] : []),
  ];
  return {
    route: { ...route, segments: undefined },
    assumptions: { startTime: start.toISOString(), ...model, segmentDistanceKm },
    scenarios,
    plannedStops: stops,
    climbs,
    daylight: { timeline: daylightTimeline, twilightSectors, nightSectors },
    fueling: {
      targetsPerHour: { carbohydrateGrams: carbsGramsPerHour, fluidMl: fluidMlPerHour, sodiumMg: sodiumMgPerHour },
      intervalMinutes: fuelingIntervalMinutes,
      probableTotals: { carbohydrateGrams: Math.round(carbsGramsPerHour * probable.totalHours), fluidMl: Math.round(fluidMlPerHour * probable.totalHours), sodiumMg: Math.round(sodiumMgPerHour * probable.totalHours) },
      schedule: buildFuelSchedule(start, probable.totalHours, fuelingIntervalMinutes, carbsGramsPerHour, fluidMlPerHour, sodiumMgPerHour),
    },
    weather: weather ? { status: "available", analysis: weather } : { status: options.includeWeather === false ? "not-requested" : "unavailable", error: weatherError },
    warnings,
  };
}
