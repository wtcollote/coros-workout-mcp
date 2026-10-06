export interface RoutingWaypoint { name?: string; latitude: number; longitude: number; }

function esc(v: string): string {
  return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

export async function createRoutedGpx(
  waypoints: RoutingWaypoint[],
  profile: "walking" | "cycling" = "walking",
  name = "Routed route"
): Promise<{ gpxXml: string; distanceKm: number; durationMinutes: number; pointCount: number; provider: string }> {
  if (waypoints.length < 2 || waypoints.length > 50) throw new Error("Provide between 2 and 50 waypoints.");
  for (const p of waypoints) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude)>90 || Math.abs(p.longitude)>180) {
      throw new Error("Invalid waypoint coordinates.");
    }
  }
  const coords=waypoints.map(p=>`${p.longitude},${p.latitude}`).join(";");
  const base=profile==="walking"
    ? "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
    : "https://routing.openstreetmap.de/routed-bike/route/v1/driving/";
  const url=new URL(base+coords);
  url.searchParams.set("overview","full");
  url.searchParams.set("geometries","geojson");
  url.searchParams.set("steps","false");
  const response=await fetch(url,{headers:{"user-agent":"coros-workout-mcp/2.2.4 (GPX routing)"}});
  if(!response.ok) throw new Error(`Routing request failed with HTTP ${response.status}.`);
  const body=await response.json() as any;
  const route=body?.routes?.[0];
  const points=route?.geometry?.coordinates;
  if(!route || !Array.isArray(points) || points.length<2) throw new Error("Routing provider returned no usable route geometry.");
  const trkpts=points.map((p:any)=>`      <trkpt lat="${Number(p[1]).toFixed(7)}" lon="${Number(p[0]).toFixed(7)}"></trkpt>`).join("\n");
  const wpts=waypoints.map(p=>`  <wpt lat="${p.latitude.toFixed(7)}" lon="${p.longitude.toFixed(7)}"><name>${esc(p.name??"Waypoint")}</name></wpt>`).join("\n");
  const gpxXml=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="COROS Workout MCP" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${esc(name)}</name></metadata>\n${wpts}\n  <trk><name>${esc(name)}</name><trkseg>\n${trkpts}\n  </trkseg></trk>\n</gpx>`;
  return {gpxXml,distanceKm:Number((route.distance/1000).toFixed(2)),durationMinutes:Number((route.duration/60).toFixed(1)),pointCount:points.length,provider:"FOSSGIS OSRM / OpenStreetMap"};
}
