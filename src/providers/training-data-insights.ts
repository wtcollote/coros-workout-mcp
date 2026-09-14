import { resolveTrainingDataProvider } from "./training-data-service.js";
import { fetchProviderActivities, summarizeActivities } from "./training-data-analytics.js";
import type { TrainingActivitySummary } from "./training-data-types.js";
import { planOperationalRoute } from "../operational-route.js";

function round(value: number | null, digits = 2) { return value == null ? null : Number(value.toFixed(digits)); }
function finite(value: number | null | undefined) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function average(values: Array<number | null | undefined>) { const valid = values.map(finite).filter((v): v is number => v != null); return valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : null; }
function stddev(values: number[]) { if (values.length < 2) return 0; const m=values.reduce((a,b)=>a+b,0)/values.length; return Math.sqrt(values.reduce((s,v)=>s+(v-m)**2,0)/values.length); }
function addDays(date:string, delta:number){ const d=new Date(`${date}T00:00:00Z`); if(!Number.isFinite(d.getTime())) throw new Error(`Invalid date: ${date}`); d.setUTCDate(d.getUTCDate()+delta); return d.toISOString().slice(0,10); }
function sportKey(a:TrainingActivitySummary){ return a.sportName ?? (a.sportType == null ? "unknown" : String(a.sportType)); }
function speed(a:TrainingActivitySummary){ return a.distanceMeters != null && a.durationSeconds && a.durationSeconds > 0 ? a.distanceMeters/a.durationSeconds : null; }
function groupBySport(activities: TrainingActivitySummary[]) { return activities.reduce<Record<string, TrainingActivitySummary[]>>((acc, activity) => { const key=sportKey(activity); (acc[key] ??= []).push(activity); return acc; }, {}); }

export async function getProviderActivity(providerId:string, activityId:string, sportType?:number){
  const provider=resolveTrainingDataProvider(providerId,"activity_detail");
  if(!provider.getActivityDetail) throw new Error(`Provider ${providerId} does not implement activity detail.`);
  let resolvedSportType=sportType;
  if(resolvedSportType == null){
    const endDate=new Date().toISOString().slice(0,10); const startDate=addDays(endDate,-365);
    const history=await fetchProviderActivities(providerId,startDate,endDate,1000);
    const match=history.activities.find(a=>a.activityId===activityId);
    resolvedSportType=match?.sportType ?? 0;
  }
  return { providerId, activityId, detail: await provider.getActivityDetail({activityId,sportType:resolvedSportType}) };
}

export async function weeklyTrainingSummary(providerId:string, endDate:string){
  const history=await fetchProviderActivities(providerId,addDays(endDate,-34),endDate,1000);
  const week=(offset:number)=>{ const to=addDays(endDate,-offset*7); const from=addDays(to,-6); const acts=history.activities.filter(a=>a.date>=from&&a.date<=to); return {offset,startDate:from,endDate:to,...summarizeActivities(acts)}; };
  const weeks=[0,1,2,3,4].map(week); const current=weeks[0]; const prev=weeks.slice(1);
  const baseline={ durationSeconds:average(prev.map(w=>w.durationSeconds)), distanceMeters:average(prev.map(w=>w.distanceMeters)), elevationGainMeters:average(prev.map(w=>w.elevationGainMeters)), trainingLoad:average(prev.map(w=>w.trainingLoad)) };
  const pct=(v:number,b:number|null)=>b&&b!==0?round((v-b)/b*100,1):null;
  return {providerId,current,previousWeeks:prev,comparisonVsPrevious4WeekAverage:{durationPercent:pct(current.durationSeconds,baseline.durationSeconds),distancePercent:pct(current.distanceMeters,baseline.distanceMeters),elevationPercent:pct(current.elevationGainMeters,baseline.elevationGainMeters),trainingLoadPercent:pct(current.trainingLoad,baseline.trainingLoad)},source:{returnedActivities:history.activities.length,total:history.total,truncated:history.truncated}};
}

export async function trainingLoadBalance(providerId:string,endDate:string,windows=[7,28,42]){
  const max=Math.max(...windows); const h=await fetchProviderActivities(providerId,addDays(endDate,-(max-1)),endDate,1000);
  const values=windows.map(days=>{const start=addDays(endDate,-(days-1)); const acts=h.activities.filter(a=>a.date>=start&&a.date<=endDate); const total=acts.reduce((s,a)=>s+(finite(a.trainingLoad)??0),0); return {days,startDate:start,totalTrainingLoad:total,averageDailyTrainingLoad:round(total/days,1),activitiesWithTrainingLoad:acts.filter(a=>finite(a.trainingLoad)!=null).length,totalActivities:acts.length};});
  const bySport=Object.entries(h.activities.reduce<Record<string,number>>((acc,a)=>{acc[sportKey(a)]=(acc[sportKey(a)]??0)+(finite(a.trainingLoad)??0);return acc;},{})).map(([sport,trainingLoad])=>({sport,trainingLoad}));
  return {providerId,endDate,windows:values,bySport,limitations:["Training-load values are only aggregated when supplied by the provider; missing values are not estimated."]};
}

export async function activityAnomalies(providerId:string,endDate:string,lookbackDays=90){
  const h=await fetchProviderActivities(providerId,addDays(endDate,-(lookbackDays-1)),endDate,1000); const metrics=["durationSeconds","distanceMeters","averageHeartRate","averagePower","elevationGain","trainingLoad"] as const;
  const groups=groupBySport(h.activities); const anomalies:Array<Record<string, unknown>>=[];
  for(const [sport,acts] of Object.entries(groups)){ for(const metric of metrics){const vals=acts.map(a=>finite(a[metric])).filter((v):v is number=>v!=null); if(vals.length<5) continue; const mean=vals.reduce((a,b)=>a+b,0)/vals.length; const sd=stddev(vals); if(sd===0) continue; for(const a of acts){const v=finite(a[metric]); if(v==null) continue; const z=(v-mean)/sd; if(Math.abs(z)>=2) anomalies.push({activityId:a.activityId,date:a.date,sport,metric,value:v,zScore:round(z,2),direction:z>0?"high":"low"});}}
  }
  return {providerId,lookbackDays,count:anomalies.length,items:anomalies.sort((a,b)=>Math.abs(Number(b.zScore))-Math.abs(Number(a.zScore))).slice(0,50),note:"Statistical training-data flags only; not a medical diagnosis."};
}

export async function personalBests(providerId:string,endDate:string,lookbackDays=365){
  const h=await fetchProviderActivities(providerId,addDays(endDate,-(lookbackDays-1)),endDate,1000); const groups=groupBySport(h.activities);
  const pick=(acts:TrainingActivitySummary[],fn:(a:TrainingActivitySummary)=>number|null)=>acts.map(a=>({a,v:fn(a)})).filter((x):x is {a:TrainingActivitySummary,v:number}=>x.v!=null).sort((x,y)=>y.v-x.v)[0]??null;
  return {providerId,lookbackDays,bySport:Object.entries(groups).map(([sport,acts])=>{const rec=(x:{a:TrainingActivitySummary,v:number}|null)=>x?{activityId:x.a.activityId,date:x.a.date,name:x.a.name,value:round(x.v,2)}:null; return {sport,longestDistance:rec(pick(acts,a=>finite(a.distanceMeters))),longestDuration:rec(pick(acts,a=>finite(a.durationSeconds))),mostElevation:rec(pick(acts,a=>finite(a.elevationGain))),highestAverageSpeed:rec(pick(acts,a=>speed(a))),highestAveragePower:rec(pick(acts,a=>finite(a.averagePower))),highestTrainingLoad:rec(pick(acts,a=>finite(a.trainingLoad)))};})};
}

export async function sportProgression(providerId:string,endDate:string,lookbackDays=84){
  const h=await fetchProviderActivities(providerId,addDays(endDate,-(lookbackDays-1)),endDate,1000); const midpoint=addDays(endDate,-Math.floor(lookbackDays/2)); const groups=groupBySport(h.activities);
  return {providerId,lookbackDays,bySport:Object.entries(groups).map(([sport,acts])=>{const prior=acts.filter(a=>a.date<midpoint), recent=acts.filter(a=>a.date>=midpoint); const s=(xs:TrainingActivitySummary[])=>({count:xs.length,averageSpeedMetersPerSecond:round(average(xs.map(speed)),3),averageHeartRate:round(average(xs.map(a=>a.averageHeartRate)),1),averagePower:round(average(xs.map(a=>a.averagePower)),0),averageTrainingLoad:round(average(xs.map(a=>a.trainingLoad)),1)}); return {sport,prior:s(prior),recent:s(recent)};})};
}

export async function similarActivities(providerId:string,activityId:string,endDate:string,lookbackDays=365,limit=5){
  const h=await fetchProviderActivities(providerId,addDays(endDate,-(lookbackDays-1)),endDate,1000); const target=h.activities.find(a=>a.activityId===activityId); if(!target) throw new Error("Target activity not found in requested history.");
  const norm=(v:number|null,b:number|null)=>v!=null&&b!=null&&b!==0?Math.abs(v-b)/Math.abs(b):0.5;
  const scored=h.activities.filter(a=>a.activityId!==activityId&&sportKey(a)===sportKey(target)).map(a=>({activity:a,score:round(norm(a.distanceMeters,target.distanceMeters)+norm(a.durationSeconds,target.durationSeconds)+norm(a.elevationGain,target.elevationGain)+norm(a.trainingLoad,target.trainingLoad),4)!})).sort((a,b)=>a.score-b.score).slice(0,limit);
  return {providerId,target,similar:scored};
}

export async function activityEfficiency(providerId:string,endDate:string,lookbackDays=90){
  const h=await fetchProviderActivities(providerId,addDays(endDate,-(lookbackDays-1)),endDate,1000); return {providerId,lookbackDays,activities:h.activities.map(a=>{const sp=speed(a); return {...a,efficiency:{speedPerHeartRate:sp!=null&&a.averageHeartRate?round(sp/a.averageHeartRate,5):null,powerPerHeartRate:a.averagePower!=null&&a.averageHeartRate?round(a.averagePower/a.averageHeartRate,3):null,trainingLoadPerHour:a.trainingLoad!=null&&a.durationSeconds?round(a.trainingLoad/(a.durationSeconds/3600),2):null,elevationMetersPerHour:a.elevationGain!=null&&a.durationSeconds?round(a.elevationGain/(a.durationSeconds/3600),1):null}};})};
}

export async function dataQualityReport(providerId:string,endDate:string,lookbackDays=90){
 const h=await fetchProviderActivities(providerId,addDays(endDate,-(lookbackDays-1)),endDate,1000); const fields=["durationSeconds","distanceMeters","averageHeartRate","averagePower","elevationGain","trainingLoad"] as const; const completeness=Object.fromEntries(fields.map(f=>[f,{present:h.activities.filter(a=>finite(a[f])!=null).length,total:h.activities.length,percent:h.activities.length?round(h.activities.filter(a=>finite(a[f])!=null).length/h.activities.length*100,1):0}]));
 return {providerId,lookbackDays,activities:h.activities.length,completeness,quality:h.activities.length===0?"insufficient":Object.values(completeness).every((x:any)=>x.percent>=80)?"high":Object.values(completeness).some((x:any)=>x.percent>=50)?"medium":"low",limitations:["Quality reflects field completeness, not sensor accuracy."]};
}

export async function athleteSnapshot(providerId:string,endDate:string){
  const [week,load,bests,progression,anomalies,quality]=await Promise.all([weeklyTrainingSummary(providerId,endDate),trainingLoadBalance(providerId,endDate),personalBests(providerId,endDate,365),sportProgression(providerId,endDate,84),activityAnomalies(providerId,endDate,90),dataQualityReport(providerId,endDate,90)]);
  const recent=await fetchProviderActivities(providerId,addDays(endDate,-14),endDate,100); const latest=[...recent.activities].sort((a,b)=>`${b.date}${b.startTime??""}`.localeCompare(`${a.date}${a.startTime??""}`))[0]??null;
  return {providerId,endDate,latestActivity:latest,weeklySummary:week,loadBalance:load,personalBests:bests,progression,anomalies,quality};
}

export async function routeCheckpointPlan(gpx:string,startTimeIso:string,options:Record<string,unknown>={}){
  return planOperationalRoute(gpx,{startTimeIso,includeWeather:false,segmentDistanceKm:10,...options} as any);
}

export async function eventProjection(gpx:string,startTimeIso:string,activityType="cycling",options:Record<string,unknown>={}){
  const plan=await planOperationalRoute(gpx,{startTimeIso,activityType:activityType as any,includeWeather:false,...options} as any); return {activityType,projection:plan};
}
