import type { ActivitySummary, DailyMetricRecord, HrvRecord, SleepRecord } from "./coros-api.js";
import type { AdaptiveEngineInput, ObjectiveContext } from "./adaptive-coaching-engine.js";

type Confidence = "low" | "moderate" | "high";
const DAY=86_400_000;
const compact=(v:string)=>v.replaceAll("-","");
const dateMs=(v:string)=>Date.UTC(+compact(v).slice(0,4),+compact(v).slice(4,6)-1,+compact(v).slice(6,8));
const age=(from:string,to:string)=>Math.round((dateMs(to)-dateMs(from))/DAY);
const round=(n:number,d=1)=>Number(n.toFixed(d));
const valid=(xs:Array<number|null|undefined>)=>xs.filter((x):x is number=>x!=null&&Number.isFinite(x));
const avg=(xs:Array<number|null|undefined>)=>{const v=valid(xs);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
const median=(xs:Array<number|null|undefined>)=>{const v=valid(xs).sort((a,b)=>a-b);if(!v.length)return null;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2};
const quantile=(xs:number[],q:number)=>{const v=[...xs].sort((a,b)=>a-b);if(!v.length)return null;return v[Math.min(v.length-1,Math.max(0,Math.round((v.length-1)*q)))]};
const kind=(a:Pick<ActivitySummary,"sportType"|"name">)=>{const n=(a.name??"").toLowerCase(),s=a.sportType??0;if(n.includes("recuper"))return"recovery";if([4,402].includes(s))return"strength";if([1,100].includes(s))return"running";if([102,103].includes(s))return"trail";if([2,200,201,202].includes(s))return"cycling";if(s===900)return"walking";return"other"};
const conf=(n:number):Confidence=>n>=12?"high":n>=5?"moderate":"low";

function baseline(metrics:DailyMetricRecord[],hrv:HrvRecord[],sleep:SleepRecord[]){
 return {rhr:median(metrics.map(x=>x.restingHeartRate)),loadRatio:median(metrics.map(x=>x.trainingLoadRatio)),hrvRatio:median(hrv.map(x=>x.average&&x.baseline?x.average/x.baseline:null)),sleep:median(sleep.map(x=>x.totalDurationMinutes))};
}

export function buildRecoveryModel(input:AdaptiveEngineInput){
 const end=compact(input.date), acts=input.activities.filter(a=>a.date<=end&&(a.trainingLoad??0)>0);
 const observations=acts.map(a=>{
   const pre=input.metrics.filter(m=>m.date<a.date&&age(m.date,a.date)<=7);
   const r0=median(pre.map(m=>m.restingHeartRate)); const h0=median(pre.map(m=>m.avgSleepHrv&&m.hrvBaseline?m.avgSleepHrv/m.hrvBaseline:null));
   const post=input.metrics.filter(m=>m.date>a.date&&age(a.date,m.date)<=3).sort((x,y)=>x.date.localeCompare(y.date));
   const normalized=post.map(m=>({day:age(a.date,m.date),rhrDelta:r0!=null&&m.restingHeartRate!=null?round(m.restingHeartRate-r0):null,hrvRatio:h0!=null&&m.avgSleepHrv&&m.hrvBaseline?round((m.avgSleepHrv/m.hrvBaseline)/h0,2):null,loadRatio:m.trainingLoadRatio}));
   return {activityId:a.activityId,date:a.date,kind:kind(a),durationHours:round((a.durationSeconds??0)/3600,2),trainingLoad:a.trainingLoad,elevationGain:a.elevationGain,response:normalized};
 }).filter(x=>x.response.length);
 const byType=Object.fromEntries(["cycling","running","trail","strength","walking"].map(k=>{const o=observations.filter(x=>x.kind===k);return[k,{samples:o.length,confidence:conf(o.length),medianLoad:median(o.map(x=>x.trainingLoad)),medianDurationHours:median(o.map(x=>x.durationHours)),day1RhrDelta:median(o.flatMap(x=>x.response.filter(r=>r.day===1).map(r=>r.rhrDelta))),day1HrvRelative:median(o.flatMap(x=>x.response.filter(r=>r.day===1).map(r=>r.hrvRatio)))}]}));
 return {engineVersion:"2.1",asOfDate:end,model:"personal_recovery_response",bySessionType:byType,recentObservations:observations.slice(-12),limitations:["Observed associations only; recovery is not inferred as causal.","Missing COROS fields remain null."]};
}

export function buildResidualFatigueModel(input:AdaptiveEngineInput){
 const date=compact(input.date); const active=input.activities.filter(a=>{const d=age(a.date,date);return d>=0&&d<=5&&(a.trainingLoad??0)>0}).map(a=>{
   const d=age(a.date,date), hours=(a.durationSeconds??0)/3600, load=a.trainingLoad??0, impact=["running","trail","strength"].includes(kind(a))?1.2:1;
   const halfLife=load>=300||hours>=5?2.2:load>=150||hours>=3?1.6:1.0; const residual=load*impact*Math.pow(.5,d/halfLife);
   return {activityId:a.activityId,date:a.date,name:a.name,kind:kind(a),ageDays:d,trainingLoad:load,halfLifeDays:halfLife,residualScore:round(residual)};
 });
 const total=active.reduce((s,x)=>s+x.residualScore,0); return {engineVersion:"2.1",date,residualFatigueScore:round(total),band:total>=300?"very_high":total>=180?"high":total>=90?"moderate":total>=35?"low":"minimal",contributors:active.sort((a,b)=>b.residualScore-a.residualScore),note:"Score is an athlete-planning heuristic, not a physiological measurement."};
}

export function buildSessionFingerprints(input:AdaptiveEngineInput){
 const groups=new Map<string,ActivitySummary[]>(); for(const a of input.activities){const k=kind(a);groups.set(k,[...(groups.get(k)??[]),a]);}
 const fingerprints=[...groups].map(([k,a])=>{const durations=valid(a.map(x=>x.durationSeconds)).map(x=>x/3600),loads=valid(a.map(x=>x.trainingLoad)),hrs=valid(a.map(x=>x.averageHeartRate)),elev=valid(a.map(x=>x.elevationGain));return{kind:k,samples:a.length,confidence:conf(a.length),typical:{durationHours:round(median(durations)??0,2),trainingLoad:round(median(loads)??0),averageHeartRate:round(median(hrs)??0),elevationGain:round(median(elev)??0)},range:{durationHoursP25:round(quantile(durations,.25)??0,2),durationHoursP75:round(quantile(durations,.75)??0,2),loadP25:round(quantile(loads,.25)??0),loadP75:round(quantile(loads,.75)??0)}}});
 return {engineVersion:"2.1",asOfDate:compact(input.date),fingerprints};
}

export function buildPerformanceTrend(input:AdaptiveEngineInput){
 const date=compact(input.date);
 const endurance=input.activities.filter(x=>age(x.date,date)>=0&&age(x.date,date)<=84&&["cycling","running","trail"].includes(kind(x)));
 const stat=(xs:ActivitySummary[])=>({
   samples:xs.length,
   loadPerHour:median(xs.map(x=>x.trainingLoad!=null&&x.durationSeconds?x.trainingLoad/(x.durationSeconds/3600):null)),
   speedKmh:median(xs.map(x=>x.distanceMeters&&x.durationSeconds?(x.distanceMeters/1000)/(x.durationSeconds/3600):null)),
   avgHr:median(xs.map(x=>x.averageHeartRate)),
   durationHours:median(xs.map(x=>x.durationSeconds?x.durationSeconds/3600:null)),
 });
 const one=(discipline:string)=>{
   const all=endurance.filter(x=>kind(x)===discipline);
   const prior=stat(all.filter(x=>age(x.date,date)>42));
   const recent=stat(all.filter(x=>age(x.date,date)<=42));
   const speedDelta=prior.speedKmh&&recent.speedKmh?100*(recent.speedKmh/prior.speedKmh-1):null;
   const hrDelta=prior.avgHr!=null&&recent.avgHr!=null?recent.avgHr-prior.avgHr:null;
   let state="insufficient_data";
   if(recent.samples>=4&&prior.samples>=4){
     if((speedDelta??0)>3&&(hrDelta??0)<=2)state="improving";
     else if((speedDelta??0)<-3&&(hrDelta??0)>=2)state="possible_accumulated_fatigue";
     else state="stable_or_mixed";
   }
   return {discipline,state,confidence:conf(Math.min(prior.samples,recent.samples)),prior42d:prior,recent42d:recent,deltas:{speedPercent:speedDelta==null?null:round(speedDelta,1),averageHeartRate:hrDelta==null?null:round(hrDelta)}};
 };
 const disciplines=["cycling","running","trail"].map(one);
 const usable=disciplines.filter((x:any)=>x.state!=="insufficient_data");
 const preferred=(input.objective?.discipline==="ultra_endurance"?"cycling":input.objective?.discipline) as string|undefined;
 const primary=(preferred?disciplines.find((x:any)=>x.discipline===preferred):null)??usable.sort((a:any,b:any)=>(b.recent42d.samples+b.prior42d.samples)-(a.recent42d.samples+a.prior42d.samples))[0]??null;
 return {
   engineVersion:"2.1.1",asOfDate:date,
   state:primary?.state??"insufficient_data",
   confidence:primary?.confidence??"low",
   primaryDiscipline:primary?.discipline??null,
   disciplines,
   caution:"Trends are computed separately by discipline. Speed remains terrain/weather sensitive and is never compared across sports or treated as power-normalized performance."
 };
}

export function buildAnomalyAndQuality(input:AdaptiveEngineInput){
 const date=compact(input.date), m=input.metrics.filter(x=>x.date<=date).slice(-28), b=baseline(m.slice(0,-1),input.hrv.filter(x=>x.date<date).slice(-28),input.sleep.filter(x=>x.date<date).slice(-28)); const t=m.at(-1); const anomalies:string[]=[];
 if(t?.restingHeartRate!=null&&b.rhr!=null&&t.restingHeartRate-b.rhr>=6)anomalies.push("resting_heart_rate_high"); if(t?.trainingLoadRatio!=null&&t.trainingLoadRatio>=1.4)anomalies.push("load_ratio_high"); if(t?.avgSleepHrv&&t.hrvBaseline&&t.avgSleepHrv/t.hrvBaseline<.85)anomalies.push("hrv_below_baseline");
 const missing={sleep:input.sleep.length===0,hrv:input.hrv.length===0,dailyMetrics:input.metrics.length===0,activities:input.activities.length===0}; const completeness=Object.values(missing).filter(x=>!x).length/4;
 return {engineVersion:"2.1",date,dataQuality:{completenessPercent:Math.round(completeness*100),missing,sourceErrors:input.sourceErrors??[]},anomalies,baseline:b,confidence:completeness>=.75?"high":completeness>=.5?"moderate":"low"};
}

export function buildDoseOptimizer(input:AdaptiveEngineInput, plannedDurationSeconds?:number){
 const residual=buildResidualFatigueModel(input) as any, quality=buildAnomalyAndQuality(input) as any; const metric=[...input.metrics].sort((a,b)=>b.date.localeCompare(a.date))[0]; let factor=1,reason:string[]=[];
 if(residual.band==="very_high"){factor*=.55;reason.push("very high residual load")}else if(residual.band==="high"){factor*=.7;reason.push("high residual load")}else if(residual.band==="moderate"){factor*=.85;reason.push("moderate residual load")}
 if((metric?.trainingLoadRatio??0)>=1.4){factor*=.85;reason.push("high load ratio")} if(quality.anomalies.length>=2){factor*=.8;reason.push("multiple personal-baseline anomalies")}
 factor=Math.max(.4,Math.min(1.05,factor)); return {engineVersion:"2.1",date:compact(input.date),doseFactor:round(factor,2),recommendedDurationSeconds:plannedDurationSeconds?Math.round(plannedDurationSeconds*factor):null,changePercent:round((factor-1)*100),reasons:reason.length?reason:["no strong COROS-derived reason to reduce planned dose"],guard:"This optimizer adjusts dose only; pain/illness requires stop-and-assess logic."};
}

export function buildEventReadiness(input:AdaptiveEngineInput, objective?:ObjectiveContext){
 const date=compact(input.date), obj=objective??input.objective, days=obj?.eventDate?age(date,obj.eventDate):null;
 const residual=buildResidualFatigueModel(input) as any, trend=buildPerformanceTrend({...input,objective:obj}) as any, quality=buildAnomalyAndQuality(input) as any;
 const scoreFrom=(residualBand:string,residualScore:number)=>{
   let score=70;
   if(residualBand==="very_high")score-=25;else if(residualBand==="high")score-=15;else if(residualBand==="moderate")score-=7;
   if(trend.state==="improving")score+=8;else if(trend.state==="possible_accumulated_fatigue")score-=10;
   score-=quality.anomalies.length*5;
   return Math.max(0,Math.min(100,Math.round(score)));
 };
 const bandFor=(x:number)=>x>=300?"very_high":x>=180?"high":x>=90?"moderate":x>=35?"low":"minimal";
 const currentScore=scoreFrom(residual.band,residual.residualFatigueScore);
 let projectedResidualScore:number|null=null, projectedScore:number|null=null;
 if(days!=null&&days>=0){
   projectedResidualScore=round(residual.contributors.reduce((sum:number,c:any)=>sum+c.trainingLoad*Math.pow(.5,(c.ageDays+days)/c.halfLifeDays),0));
   projectedScore=scoreFrom(bandFor(projectedResidualScore),projectedResidualScore);
 }
 const band=(score:number)=>score>=80?"strong":score>=65?"acceptable":score>=50?"caution":"poor";
 return {
   engineVersion:"2.1.1",date,objective:obj??null,daysToObjective:days,
   current:{readinessIndex:currentScore,band:band(currentScore),residualFatigueScore:residual.residualFatigueScore,residualFatigueBand:residual.band},
   projectedAtEvent:projectedScore==null?null:{readinessIndex:projectedScore,band:band(projectedScore),projectedResidualFatigueScore:projectedResidualScore,assumption:"Projection only dissipates already-observed residual load; future training, sleep, illness, stress and race-week changes can alter it."},
   readinessIndex:currentScore,band:band(currentScore),
   components:{residualFatigue:residual.band,performanceTrend:trend.state,performanceTrendDiscipline:trend.primaryDiscipline,anomalies:quality.anomalies,dataQuality:quality.dataQuality},
   contract:"Current readiness and projected event readiness are planning indices, not medical assessments or race-outcome probabilities."
 };
}

export function buildAthleteIntelligence(input:AdaptiveEngineInput, plannedDurationSeconds?:number){
 return {engineVersion:"2.1.1",date:compact(input.date),recovery:buildRecoveryModel(input),residualFatigue:buildResidualFatigueModel(input),sessionFingerprints:buildSessionFingerprints(input),performanceTrend:buildPerformanceTrend(input),doseOptimizer:buildDoseOptimizer(input,plannedDurationSeconds),eventReadiness:buildEventReadiness(input),anomalyAndDataQuality:buildAnomalyAndQuality(input),principles:["Personal baselines take precedence when sample size is adequate.","Association is not causation.","No missing physiological value is invented.","Recommendations expose confidence and data quality."]};
}
