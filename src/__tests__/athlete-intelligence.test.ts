import { describe, expect, it } from "vitest";
import { buildResidualFatigueModel, buildDoseOptimizer, buildEventReadiness } from "../athlete-intelligence.js";
import { buildSeasonStrategy } from "../adaptive-coaching-engine.js";
const input:any={date:"20260906",profile:{objectives:[]},sleep:[],hrv:[{date:"20260906",average:46,baseline:44}],metrics:[{date:"20260906",restingHeartRate:46,trainingLoadRatio:1.22,avgSleepHrv:46,hrvBaseline:44}],activities:[{activityId:"x",date:"20260905",name:"Long ride",sportType:2,durationSeconds:20184,trainingLoad:459,elevationGain:2264}],planned:[]};
describe("Athlete Intelligence v2.1",()=>{
 it("detects substantial residual fatigue after a high-load long ride",()=>{const r:any=buildResidualFatigueModel(input);expect(["high","very_high"]).toContain(r.band);});
 it("reduces dose after major residual stress",()=>{const r:any=buildDoseOptimizer(input,7200);expect(r.doseFactor).toBeLessThan(1);expect(r.recommendedDurationSeconds).toBeLessThan(7200);});
 it("builds bounded readiness index",()=>{const r:any=buildEventReadiness({...input,objective:{name:"A",eventDate:"20260918",priority:"A"}});expect(r.readinessIndex).toBeGreaterThanOrEqual(0);expect(r.readinessIndex).toBeLessThanOrEqual(100);});
 it("enters taper at 12 days for A objective",()=>{const r:any=buildSeasonStrategy({...input,objective:{name:"A Event",eventDate:"20260918",priority:"A",discipline:"ultra_endurance"}});expect(r.inferredPhase).toBe("taper");});
});

it("keeps performance trends discipline-specific", async()=>{
  const { buildPerformanceTrend } = await import("../athlete-intelligence.js");
  const activities:any[]=[];
  for(let i=0;i<5;i++) activities.push({activityId:`cp${i}`,date:`202607${String(10+i).padStart(2,"0")}`,name:"Bike",sportType:2,durationSeconds:3600,distanceMeters:20000,trainingLoad:60,averageHeartRate:130});
  for(let i=0;i<5;i++) activities.push({activityId:`cr${i}`,date:`202608${String(20+i).padStart(2,"0")}`,name:"Bike",sportType:2,durationSeconds:3600,distanceMeters:22000,trainingLoad:60,averageHeartRate:128});
  for(let i=0;i<5;i++) activities.push({activityId:`rp${i}`,date:`202607${String(10+i).padStart(2,"0")}`,name:"Run",sportType:1,durationSeconds:3600,distanceMeters:10000,trainingLoad:100,averageHeartRate:150});
  for(let i=0;i<5;i++) activities.push({activityId:`rr${i}`,date:`202608${String(20+i).padStart(2,"0")}`,name:"Run",sportType:1,durationSeconds:3600,distanceMeters:10000,trainingLoad:100,averageHeartRate:150});
  const r:any=buildPerformanceTrend({...input,activities,objective:{name:"A",discipline:"ultra_endurance"}});
  expect(r.primaryDiscipline).toBe("cycling");
  expect(r.disciplines.find((x:any)=>x.discipline==="cycling").deltas.speedPercent).toBeCloseTo(10,0);
  expect(r.disciplines.find((x:any)=>x.discipline==="running").deltas.speedPercent).toBeCloseTo(0,0);
});

it("projects event readiness separately from today's fatigue",()=>{
 const r:any=buildEventReadiness({...input,objective:{name:"A",eventDate:"20260918",priority:"A",discipline:"ultra_endurance"}});
 expect(r.current.readinessIndex).toBeLessThanOrEqual(r.projectedAtEvent.readinessIndex);
 expect(r.projectedAtEvent.projectedResidualFatigueScore).toBeLessThan(r.current.residualFatigueScore);
});
