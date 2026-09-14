export interface RoutePoint {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  distanceMeters: number;
}

export interface RouteSegment {
  index: number;
  startKm: number;
  endKm: number;
  distanceKm: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  averageGradePercent: number;
  start: { latitude: number; longitude: number; elevationMeters: number | null };
  end: { latitude: number; longitude: number; elevationMeters: number | null };
  midpoint: { latitude: number; longitude: number; elevationMeters: number | null };
  bearingDegrees: number;
}

export interface GpxRouteAnalysis {
  name: string | null;
  pointCount: number;
  distanceKm: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  minimumElevationMeters: number | null;
  maximumElevationMeters: number | null;
  start: { latitude: number; longitude: number };
  finish: { latitude: number; longitude: number };
  segmentDistanceKm: number;
  segments: RouteSegment[];
}

function decodeXml(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
}

function haversineMeters(a: RoutePoint, b: RoutePoint): number {
  const radius = 6371008.8;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function bearingDegrees(a: RoutePoint, b: RoutePoint): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const degrees = (value: number) => value * 180 / Math.PI;
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function elevationTotals(points: RoutePoint[]): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let anchor: number | null = null;
  for (const point of points) {
    if (point.elevationMeters == null) continue;
    if (anchor == null) { anchor = point.elevationMeters; continue; }
    const difference = point.elevationMeters - anchor;
    if (Math.abs(difference) < 1) continue;
    if (difference > 0) gain += difference;
    else loss += Math.abs(difference);
    anchor = point.elevationMeters;
  }
  return { gain, loss };
}

export function parseGpx(gpx: string): { name: string | null; points: RoutePoint[] } {
  if (Buffer.byteLength(gpx, "utf8") > 8 * 1024 * 1024) throw new Error("GPX input exceeds the 8 MB safety limit.");
  if (!/<gpx\b/i.test(gpx)) throw new Error("Input is not a GPX document.");
  const points: RoutePoint[] = [];
  const pointPattern = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  for (const match of gpx.matchAll(pointPattern)) {
    const attributes = match[2] ?? "";
    const body = match[3] ?? "";
    const latitudeMatch = /\blat\s*=\s*["']([^"']+)["']/i.exec(attributes);
    const longitudeMatch = /\blon\s*=\s*["']([^"']+)["']/i.exec(attributes);
    if (!latitudeMatch || !longitudeMatch) continue;
    const latitude = Number(latitudeMatch[1]);
    const longitude = Number(longitudeMatch[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const elevationMatch = /<ele\b[^>]*>([^<]+)<\/ele>/i.exec(body);
    const elevation = elevationMatch ? Number(elevationMatch[1]) : null;
    const previous = points[points.length - 1];
    const point: RoutePoint = { latitude, longitude, elevationMeters: elevation != null && Number.isFinite(elevation) ? elevation : null, distanceMeters: 0 };
    point.distanceMeters = previous ? previous.distanceMeters + haversineMeters(previous, point) : 0;
    points.push(point);
    if (points.length > 200000) throw new Error("GPX contains more than 200,000 route points.");
  }
  if (points.length < 2) throw new Error("GPX must contain at least two valid track or route points.");
  const nameMatch = /<(?:trk|rte)>[\s\S]*?<name\b[^>]*>([^<]+)<\/name>/i.exec(gpx) ?? /<name\b[^>]*>([^<]+)<\/name>/i.exec(gpx);
  return { name: nameMatch ? decodeXml(nameMatch[1].trim()) : null, points };
}

function pointAtDistance(points: RoutePoint[], targetMeters: number): RoutePoint {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distanceMeters < targetMeters) low = middle + 1;
    else high = middle;
  }
  return points[low];
}

export function analyzeGpxRoute(gpx: string, segmentDistanceKm = 25): GpxRouteAnalysis {
  if (!Number.isFinite(segmentDistanceKm) || segmentDistanceKm < 2 || segmentDistanceKm > 100) throw new Error("segmentDistanceKm must be between 2 and 100.");
  const { name, points } = parseGpx(gpx);
  const elevations = points.flatMap((point) => point.elevationMeters == null ? [] : [point.elevationMeters]);
  const elevation = elevationTotals(points);
  const totalMeters = points[points.length - 1].distanceMeters;
  const segmentMeters = segmentDistanceKm * 1000;
  const segments: RouteSegment[] = [];
  for (let startMeters = 0, index = 1; startMeters < totalMeters; startMeters += segmentMeters, index++) {
    const endMeters = Math.min(totalMeters, startMeters + segmentMeters);
    const startPoint = pointAtDistance(points, startMeters);
    const endPoint = pointAtDistance(points, endMeters);
    const midpoint = pointAtDistance(points, (startMeters + endMeters) / 2);
    const contained = points.filter((point) => point.distanceMeters >= startMeters && point.distanceMeters <= endMeters);
    const segmentElevation = elevationTotals(contained);
    const distance = Math.max(1, endMeters - startMeters);
    const netElevation = (endPoint.elevationMeters ?? 0) - (startPoint.elevationMeters ?? 0);
    segments.push({
      index,
      startKm: round(startMeters / 1000), endKm: round(endMeters / 1000), distanceKm: round(distance / 1000),
      elevationGainMeters: Math.round(segmentElevation.gain), elevationLossMeters: Math.round(segmentElevation.loss), averageGradePercent: round(netElevation / distance * 100, 2),
      start: { latitude: startPoint.latitude, longitude: startPoint.longitude, elevationMeters: startPoint.elevationMeters },
      end: { latitude: endPoint.latitude, longitude: endPoint.longitude, elevationMeters: endPoint.elevationMeters },
      midpoint: { latitude: midpoint.latitude, longitude: midpoint.longitude, elevationMeters: midpoint.elevationMeters },
      bearingDegrees: Math.round(bearingDegrees(startPoint, endPoint)),
    });
    if (segments.length > 100) throw new Error("Route produces more than 100 sectors; increase segmentDistanceKm.");
  }
  return {
    name, pointCount: points.length, distanceKm: round(totalMeters / 1000, 2), elevationGainMeters: Math.round(elevation.gain), elevationLossMeters: Math.round(elevation.loss),
    minimumElevationMeters: elevations.length ? round(Math.min(...elevations)) : null,
    maximumElevationMeters: elevations.length ? round(Math.max(...elevations)) : null,
    start: { latitude: points[0].latitude, longitude: points[0].longitude },
    finish: { latitude: points[points.length - 1].latitude, longitude: points[points.length - 1].longitude },
    segmentDistanceKm, segments,
  };
}

interface HourlyWeather {
  time?: string[];
  temperature_2m?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
  precipitation?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  wind_direction_10m?: Array<number | null>;
  wind_gusts_10m?: Array<number | null>;
  is_day?: Array<number | null>;
}

const weatherCache = new Map<string, { expiresAt: number; value: unknown }>();

async function fetchOpenMeteo(url: URL): Promise<unknown> {
  const key = url.toString();
  const cached = weatherCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": "coros-workout-mcp/1.9.1" } });
    if (response.ok) {
      const value = await response.json();
      weatherCache.set(key, { expiresAt: Date.now() + 15 * 60 * 1000, value });
      return value;
    }
    if (response.status !== 429 || attempt === 2) throw new Error(`Open-Meteo request failed with HTTP ${response.status}.`);
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMilliseconds = Number.isFinite(retryAfterSeconds)
      ? Math.min(10000, Math.max(0, retryAfterSeconds * 1000))
      : 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
  }
  throw new Error("Open-Meteo request failed after retries.");
}

interface MetNoTimeSeries {
  time: string;
  data?: {
    instant?: { details?: Record<string, number> };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
  };
}

async function fetchMetNorway(point: { latitude: number; longitude: number; elevationMeters: number | null }): Promise<HourlyWeather> {
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
  url.searchParams.set("lat", point.latitude.toFixed(4));
  url.searchParams.set("lon", point.longitude.toFixed(4));
  if (point.elevationMeters != null) url.searchParams.set("altitude", String(Math.round(point.elevationMeters)));
  const key = url.toString();
  const cached = weatherCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as HourlyWeather;
  const response = await fetch(url, {
    headers: {
      "user-agent": "coros-workout-chatgpt/1.9.2 github.com/davidsegade/coros-workout-chatgpt",
      "accept-encoding": "gzip, deflate",
    },
  });
  if (!response.ok) throw new Error(`MET Norway request failed with HTTP ${response.status}.`);
  const body = await response.json() as { properties?: { timeseries?: MetNoTimeSeries[] } };
  const series = body.properties?.timeseries ?? [];
  if (!series.length) throw new Error("MET Norway returned no forecast timeseries.");
  const hourly: HourlyWeather = {
    time: [], temperature_2m: [], precipitation_probability: [], precipitation: [],
    wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [], is_day: [],
  };
  for (const item of series) {
    const details = item.data?.instant?.details ?? {};
    const symbol = item.data?.next_1_hours?.summary?.symbol_code ?? "";
    hourly.time!.push(item.time.replace(/Z$/, ""));
    hourly.temperature_2m!.push(details.air_temperature ?? null);
    hourly.precipitation_probability!.push(null);
    hourly.precipitation!.push(item.data?.next_1_hours?.details?.precipitation_amount ?? null);
    hourly.wind_speed_10m!.push(details.wind_speed == null ? null : details.wind_speed * 3.6);
    hourly.wind_direction_10m!.push(details.wind_from_direction ?? null);
    hourly.wind_gusts_10m!.push(details.wind_speed_of_gust == null ? null : details.wind_speed_of_gust * 3.6);
    hourly.is_day!.push(symbol.includes("_night") ? 0 : symbol.includes("_day") ? 1 : null);
  }
  const expires = Date.parse(response.headers.get("expires") ?? "");
  weatherCache.set(key, { expiresAt: Number.isFinite(expires) ? expires : Date.now() + 15 * 60 * 1000, value: hourly });
  return hourly;
}

async function fetchMetNorwayRouteForecasts(route: GpxRouteAnalysis): Promise<HourlyWeather[]> {
  const count = route.segments.length;
  const sampleCount = Math.min(8, count);
  const sampleIndices = [...new Set(Array.from({ length: sampleCount }, (_, index) => Math.round(index * (count - 1) / Math.max(1, sampleCount - 1))))];
  const sampled = await Promise.all(sampleIndices.map(async (index) => ({ index, weather: await fetchMetNorway(route.segments[index].midpoint) })));
  return route.segments.map((_, index) => sampled.reduce((nearest, candidate) => Math.abs(candidate.index - index) < Math.abs(nearest.index - index) ? candidate : nearest).weather);
}

function nearestHourIndex(times: string[], target: Date): number {
  let selected = 0;
  let smallest = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const difference = Math.abs(new Date(`${time}Z`).getTime() - target.getTime());
    if (difference < smallest) { smallest = difference; selected = index; }
  });
  return selected;
}

export async function analyzeRouteWeather(gpx: string, startTimeIso: string, averageMovingSpeedKmh: number, totalStopMinutes = 0, segmentDistanceKm = 25): Promise<Record<string, unknown>> {
  const route = analyzeGpxRoute(gpx, segmentDistanceKm);
  const start = new Date(startTimeIso);
  if (!Number.isFinite(start.getTime())) throw new Error("startTimeIso must be a valid ISO 8601 timestamp with timezone.");
  if (averageMovingSpeedKmh <= 0 || averageMovingSpeedKmh > 80) throw new Error("averageMovingSpeedKmh must be between 0 and 80.");
  const locations = route.segments.map((segment) => segment.midpoint);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", locations.map((point) => point.latitude.toFixed(5)).join(","));
  url.searchParams.set("longitude", locations.map((point) => point.longitude.toFixed(5)).join(","));
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day");
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("forecast_days", "16");
  let provider = "Open-Meteo";
  let providerUrl = "https://open-meteo.com/";
  let attribution = "Weather data by Open-Meteo.com";
  let fallbackReason: string | null = null;
  let forecasts: Array<{ hourly?: HourlyWeather }>;
  try {
    const body = await fetchOpenMeteo(url) as Array<{ hourly?: HourlyWeather }> | { hourly?: HourlyWeather; reason?: string };
    forecasts = Array.isArray(body) ? body : [body];
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : String(error);
    provider = "MET Norway Locationforecast";
    providerUrl = "https://api.met.no/weatherapi/locationforecast/2.0/";
    attribution = "Weather data from the Norwegian Meteorological Institute, licensed under CC BY 4.0; adapted into route sectors.";
    forecasts = (await fetchMetNorwayRouteForecasts(route)).map((hourly) => ({ hourly }));
  }
  if (forecasts.length !== route.segments.length) throw new Error("Open-Meteo returned an unexpected number of locations.");
  const sectors = route.segments.map((segment, index) => {
    const progress = segment.startKm / route.distanceKm;
    const elapsedHours = segment.startKm / averageMovingSpeedKmh + totalStopMinutes / 60 * progress;
    const arrival = new Date(start.getTime() + elapsedHours * 3600000);
    const hourly = forecasts[index].hourly ?? {};
    const hourIndex = nearestHourIndex(hourly.time ?? [], arrival);
    const windSpeed = hourly.wind_speed_10m?.[hourIndex] ?? null;
    const windDirection = hourly.wind_direction_10m?.[hourIndex] ?? null;
    const relativeAngle = windDirection == null ? null : (windDirection - segment.bearingDegrees) * Math.PI / 180;
    const headwind = windSpeed == null || relativeAngle == null ? null : windSpeed * Math.cos(relativeAngle);
    const crosswind = windSpeed == null || relativeAngle == null ? null : Math.abs(windSpeed * Math.sin(relativeAngle));
    const temperature = hourly.temperature_2m?.[hourIndex] ?? null;
    const precipitationProbability = hourly.precipitation_probability?.[hourIndex] ?? null;
    const gusts = hourly.wind_gusts_10m?.[hourIndex] ?? null;
    const risks: string[] = [];
    if (precipitationProbability != null && precipitationProbability >= 50) risks.push("rain-likely");
    if (gusts != null && gusts >= 40) risks.push("strong-gusts");
    if (headwind != null && headwind >= 20) risks.push("strong-headwind");
    if (temperature != null && temperature >= 30) risks.push("heat");
    if (temperature != null && temperature <= 5) risks.push("cold");
    if (hourly.is_day?.[hourIndex] === 0) risks.push("night");
    return {
      ...segment, estimatedArrival: arrival.toISOString(),
      weather: { temperatureCelsius: temperature, precipitationProbabilityPercent: precipitationProbability, precipitationMm: hourly.precipitation?.[hourIndex] ?? null, windSpeedKmh: windSpeed, windDirectionDegrees: windDirection, gustKmh: gusts, headwindComponentKmh: headwind == null ? null : round(headwind), crosswindComponentKmh: crosswind == null ? null : round(crosswind), isDay: hourly.is_day?.[hourIndex] == null ? null : hourly.is_day?.[hourIndex] === 1 },
      risks,
    };
  });
  return {
    source: { provider, url: providerUrl, attribution, fallbackReason },
    route: { ...route, segments: undefined }, assumptions: { startTime: start.toISOString(), averageMovingSpeedKmh, totalStopMinutes }, sectors,
    warnings: ["Weather is a forecast and must be refreshed close to departure.", "Arrival times use one constant moving speed plus proportionally distributed stops.", ...(provider.startsWith("MET Norway") ? ["MET Norway fallback samples at most eight route locations; precipitation probability may be unavailable."] : [])],
  };
}

export function simulateUltraRoute(gpx: string, startTimeIso: string, flatSpeedKmh: number, totalStopMinutes: number, climbPenaltyMinutesPer1000m = 45, segmentDistanceKm = 25): Record<string, unknown> {
  const route = analyzeGpxRoute(gpx, segmentDistanceKm);
  const start = new Date(startTimeIso);
  if (!Number.isFinite(start.getTime())) throw new Error("startTimeIso must be a valid ISO 8601 timestamp with timezone.");
  if (flatSpeedKmh <= 0 || flatSpeedKmh > 80) throw new Error("flatSpeedKmh must be between 0 and 80.");
  if (totalStopMinutes < 0 || totalStopMinutes > 1440) throw new Error("totalStopMinutes must be between 0 and 1440.");
  const definitions = [
    { name: "optimistic", speedFactor: 1.06, stopFactor: 0.8, climbFactor: 0.9 },
    { name: "probable", speedFactor: 1, stopFactor: 1, climbFactor: 1 },
    { name: "conservative", speedFactor: 0.92, stopFactor: 1.25, climbFactor: 1.15 },
  ];
  const scenarios = definitions.map((definition) => {
    let elapsedMinutes = 0;
    const checkpoints = route.segments.map((segment) => {
      const movingMinutes = segment.distanceKm / (flatSpeedKmh * definition.speedFactor) * 60;
      const climbingMinutes = segment.elevationGainMeters / 1000 * climbPenaltyMinutesPer1000m * definition.climbFactor;
      const stopMinutes = totalStopMinutes * definition.stopFactor * (segment.distanceKm / route.distanceKm);
      elapsedMinutes += movingMinutes + climbingMinutes + stopMinutes;
      return { km: segment.endKm, estimatedTime: new Date(start.getTime() + elapsedMinutes * 60000).toISOString(), elapsedHours: round(elapsedMinutes / 60, 2), sectorMovingMinutes: Math.round(movingMinutes), sectorClimbingPenaltyMinutes: Math.round(climbingMinutes), allocatedStopMinutes: Math.round(stopMinutes) };
    });
    return { scenario: definition.name, totalHours: round(elapsedMinutes / 60, 2), finishTime: new Date(start.getTime() + elapsedMinutes * 60000).toISOString(), checkpoints };
  });
  return { route: { name: route.name, distanceKm: route.distanceKm, elevationGainMeters: route.elevationGainMeters }, assumptions: { startTime: start.toISOString(), flatSpeedKmh, totalStopMinutes, climbPenaltyMinutesPer1000m, note: "The climb penalty is added to flat-terrain moving time and must be calibrated with the athlete's history." }, scenarios };
}
