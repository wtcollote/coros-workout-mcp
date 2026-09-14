import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
type Stored={accessToken:string;refreshToken?:string;expiresAt?:number;clientId:string;tokenEndpoint:string}; type Session=Stored; type PendingOAuth={state:string;verifier:string;clientId:string;tokenEndpoint:string};
const keyName="coros:oauth:refresh_token"; const pendingKeyName="coros:oauth:pending"; let session:Session|null=null; let pending:Promise<Session>|null=null;
const url=(process.env.UPSTASH_REDIS_REST_URL??"").replace(/\/$/,""); const redisToken=process.env.UPSTASH_REDIS_REST_TOKEN??""; const key=()=>createHash("sha256").update(process.env.COROS_OAUTH_ENCRYPTION_KEY??"").digest();
async function redis(command:string,...args:string[]){if(!url||!redisToken)throw new Error("Upstash OAuth storage is not configured.");const r=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${redisToken}`,"content-type":"application/json"},body:JSON.stringify([command,...args])});const b=await r.json() as any;if(!r.ok||b.error)throw new Error("OAuth storage request failed.");return b.result;}
function seal(v:string){const iv=randomBytes(12),c=createCipheriv("aes-256-gcm",key(),iv),o=Buffer.concat([c.update(v),c.final()]);return Buffer.concat([iv,c.getAuthTag(),o]).toString("base64url");} function unseal(v:string){const b=Buffer.from(v,"base64url"),d=createDecipheriv("aes-256-gcm",key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString();}
export async function storeOfficialOAuth(v:Stored){await redis("SET",keyName,seal(JSON.stringify(v)));session=null;}
export async function storeOfficialOAuthPending(v:PendingOAuth){await redis("SET",pendingKeyName,seal(JSON.stringify(v)),"EX","600");}
export async function loadOfficialOAuthPending():Promise<PendingOAuth|null>{const raw=await redis("GET",pendingKeyName);if(!raw)return null;return JSON.parse(unseal(String(raw))) as PendingOAuth;}
export async function clearOfficialOAuthPending(){await redis("DEL",pendingKeyName);}
async function token(endpoint:string,p:URLSearchParams){const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:p});const b=await r.json() as any;if(!r.ok)throw new Error(b.error_description??"COROS OAuth token request failed.");return b;}
async function current():Promise<Session>{
  if(session&&(!session.expiresAt||session.expiresAt>Date.now()+60000))return session;
  if(pending)return pending;
  pending=(async()=>{
    const raw=await redis("GET",keyName);
    if(!raw)throw new Error("COROS OAuth authorization is required.");

    const s=JSON.parse(unseal(String(raw))) as Stored;

    if(s.accessToken&&(!s.expiresAt||s.expiresAt>Date.now()+60000)){
      session=s;
      return s;
    }

    if(!s.refreshToken){
      throw new Error("COROS OAuth authorization has expired and must be renewed.");
    }

    const b=await token(s.tokenEndpoint,new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:s.refreshToken,
      client_id:s.clientId
    }));

    if(!b.access_token){
      throw new Error("COROS OAuth refresh response did not include access_token.");
    }

    const n:Session={
      ...s,
      accessToken:String(b.access_token),
      refreshToken:b.refresh_token?String(b.refresh_token):s.refreshToken,
      expiresAt:b.expires_in?Date.now()+Number(b.expires_in)*1000:undefined
    };

    await storeOfficialOAuth(n);
    session=n;
    return n;
  })().finally(()=>{pending=null;});

  return pending;
}
export async function getOfficialSleepNormalized(startDate:string,endDate:string):Promise<any[]>{const s=await current(),c=new Client({name:"coros-workout-mcp",version:"2.2.4"}),t=new StreamableHTTPClientTransport(new URL(process.env.COROS_OFFICIAL_MCP_URL??"https://mcp.coros.com/mcp"),{requestInit:{headers:{Authorization:`Bearer ${s.accessToken}`}}});try{await c.connect(t);const r=await c.callTool({name:"querySleepData",arguments:{startDate:startDate.replace(/-/g,""),endDate:endDate.replace(/-/g,""),days:Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000)+1}});const text=(r.content as any[]).filter(x=>x.type==="text").map(x=>x.text).join("\n");if(r.isError)throw new Error(text||"COROS official sleep request failed.");return parseOfficialSleepText(text);}finally{await c.close().catch(()=>undefined);}}
function normalizeOfficialToolText(text:string):string{
  let normalized=text.trim();
  for(let i=0;i<2;i+=1){
    if(!(normalized.startsWith('"')&&normalized.endsWith('"')))break;
    try{
      const decoded=JSON.parse(normalized);
      if(typeof decoded!=="string")break;
      normalized=decoded.trim();
    }catch{
      break;
    }
  }
  return normalized.replace(/\r\n/g,"\n");
}

export function parseOfficialSleepText(text:string):any[]{const out:any[]=[];for(const b of normalizeOfficialToolText(text).split(/\n(?=\d{4}-\d{2}-\d{2}\n)/)){const d=b.match(/^(\d{4}-\d{2}-\d{2})/)?.[1],m=b.match(/Main Sleep:\s*(?:(\d+)h\s*)?(\d+)min/i),a=b.match(/Awake Time:\s*(?:(\d+)\s*h\s*)?(\d+)\s*min/i),q=b.match(/Sleep Score:\s*(\d+)/i);if(!d||(!m&&!q))continue;const mins=m?Number(m[1]??0)*60+Number(m[2]):null,p=(n:string)=>Number(b.match(new RegExp(`${n}:\\s*(\\d+)%`,"i"))?.[1]),stage=(n:number)=>Number.isFinite(n)&&mins!=null?Math.round(mins*n/100):null;out.push({date:d.replace(/-/g,""),totalDurationMinutes:mins,deepMinutes:stage(p("Deep Sleep Ratio")),lightMinutes:stage(p("Light Sleep Ratio")),remMinutes:stage(p("REM Ratio")),awakeMinutes:a?Number(a[1]??0)*60+Number(a[2]):null,napMinutes:null,averageHeartRate:null,minimumHeartRate:null,maximumHeartRate:null,qualityScore:q?Number(q[1]):null});}return out;}

// Read-only reuse of the existing official session; no OAuth flow changes.
let recoveryPending: Promise<import("./official-recovery.js").OfficialRecovery> | null = null;
let recoveryCached: { value: import("./official-recovery.js").OfficialRecovery; at: number } | null = null;
export async function getOfficialRecoveryNormalized() {
  if (recoveryCached && Date.now() - recoveryCached.at < 60_000) return recoveryCached.value;
  if (recoveryPending) return recoveryPending;
  recoveryPending = (async () => {
    const s = await current();
    const c = new Client({ name: "coros-workout-mcp", version: "2.2.4" });
    const transport = new StreamableHTTPClientTransport(new URL(process.env.COROS_OFFICIAL_MCP_URL ?? "https://mcp.coros.com/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${s.accessToken}` } },
    });
    try {
      await c.connect(transport);
      const reply = await c.callTool({ name: "queryRecoveryStatus", arguments: {} });
      if (reply.isError) throw new Error("Official recovery unavailable.");
      const text = (reply.content as { type: string; text?: string }[]).filter(item => item.type === "text").map(item => item.text ?? "").join("\n");
      const { parseOfficialRecovery } = await import("./official-recovery.js");
      const value = parseOfficialRecovery(text);
      recoveryCached = { value, at: Date.now() };
      return value;
    } finally { await c.close().catch(() => undefined); }
  })();
  try { return await recoveryPending; } finally { recoveryPending = null; }
}
