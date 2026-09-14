#!/usr/bin/env node
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCorosWorkoutServer } from "./index.js";
import { executeCompatibilityRead, READ_OPERATIONS } from "./compatibility-bridge.js";
import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { clearOfficialOAuthPending, loadOfficialOAuthPending, storeOfficialOAuth, storeOfficialOAuthPending } from "./official-oauth.js";

const port = Number(process.env.PORT ?? 8787);
const mcpPath = "/mcp";
const dashboardApiPath = "/api/dashboard-read";
const dashboardApiToken = process.env.DASHBOARD_API_TOKEN ?? process.env.DASHBOARD_TOKEN ?? "";
const dashboardReadAllowlist = new Set(READ_OPERATIONS.map((item) => item.name));


function tokenMatches(candidate: string): boolean {
  if (!dashboardApiToken || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(dashboardApiToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: import("node:http").IncomingMessage, maxBytes = 128 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
  return parsed as Record<string, unknown>;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/coros/oauth/start") {
    const suppliedAdmin = Buffer.from(String(url.searchParams.get("token") ?? "")); const expectedAdmin = Buffer.from(process.env.COROS_OAUTH_ADMIN_TOKEN ?? "x");
    if (suppliedAdmin.length !== expectedAdmin.length || !timingSafeEqual(suppliedAdmin, expectedAdmin)) { res.writeHead(401).end("Unauthorized"); return; }
    const resource = await (await fetch("https://mcp.coros.com/.well-known/oauth-protected-resource/mcp")).json() as any;
    const issuer = String(resource.authorization_servers?.[0]); const base = new URL(issuer);
    const meta = await (await fetch(`${base.origin}/.well-known/oauth-authorization-server${base.pathname === "/" ? "" : base.pathname}`)).json() as any;
    const redirectUri = process.env.COROS_OAUTH_REDIRECT_URI ?? ""; let clientId = process.env.COROS_OAUTH_CLIENT_ID ?? "";
    if (!clientId) { const reg = await (await fetch(String(meta.registration_endpoint), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "COROS Workout MCP", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) })).json() as any; clientId = String(reg.client_id); }
    const authEndpoint = String(meta.authorization_endpoint), tokenEndpoint = String(meta.token_endpoint);
    const oauthPending = { state: randomBytes(24).toString("base64url"), verifier: randomBytes(48).toString("base64url"), clientId, tokenEndpoint }; await storeOfficialOAuthPending(oauthPending);
    const challenge = createHash("sha256").update(oauthPending.verifier).digest("base64url");
    const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state: oauthPending.state, code_challenge: challenge, code_challenge_method: "S256" });
    res.writeHead(302, { location: `${authEndpoint}?${query}` }).end(); return;
  }
  if (req.method === "GET" && url.pathname === "/api/coros/oauth/callback") {
    try { const oauthPending = await loadOfficialOAuthPending(); if (!oauthPending || url.searchParams.get("state") !== oauthPending.state) throw new Error("Invalid OAuth state."); const body = new URLSearchParams({ grant_type: "authorization_code", code: String(url.searchParams.get("code") ?? ""), redirect_uri: process.env.COROS_OAUTH_REDIRECT_URI ?? "", client_id: oauthPending.clientId, code_verifier: oauthPending.verifier }); const r = await fetch(oauthPending.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }); const token = await r.json() as any;
    if (!r.ok || !token.access_token) {
      console.error("COROS OAuth token exchange failed", {
        status: r.status,
        error: typeof token?.error === "string" ? token.error : undefined,
        errorDescription: typeof token?.error_description === "string" ? token.error_description : undefined,
        hasClientId: Boolean(oauthPending.clientId),
        hasCodeVerifier: Boolean(oauthPending.verifier),
        tokenEndpointHost: new URL(oauthPending.tokenEndpoint).hostname,
      });
      throw new Error("COROS OAuth token exchange failed.");
    } await storeOfficialOAuth({
      accessToken: String(token.access_token),
      ...(token.refresh_token ? { refreshToken: String(token.refresh_token) } : {}),
      ...(token.expires_in ? { expiresAt: Date.now() + Number(token.expires_in) * 1000 } : {}),
      clientId: oauthPending.clientId,
      tokenEndpoint: oauthPending.tokenEndpoint
    });
    await clearOfficialOAuthPending(); res.writeHead(200, { "content-type": "text/plain" }).end("COROS OAuth authorization completed."); } catch (error) { res.writeHead(400).end(error instanceof Error ? error.message : "OAuth failed"); } return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "coros-workout-chatgpt", dashboardApi: Boolean(dashboardApiToken) }));
    return;
  }

  if (req.method === "POST" && url.pathname === dashboardApiPath) {
    if (!dashboardApiToken) {
      res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Dashboard API token is not configured." }));
      return;
    }
    const supplied = String(req.headers["x-dashboard-api-token"] ?? "");
    if (!tokenMatches(supplied)) {
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid dashboard API token." }));
      return;
    }
    try {
      const body = await readJson(req);
      const operation = typeof body.operation === "string" ? body.operation : "";
      const input = body.input && typeof body.input === "object" && !Array.isArray(body.input)
        ? body.input as Record<string, unknown>
        : {};
      if (!dashboardReadAllowlist.has(operation)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: `Operation '${operation}' is not allowed on the dashboard API.` }));
        return;
      }
      const result = await executeCompatibilityRead(operation, input);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify(result));
    } catch (error) {
      console.error("Dashboard API request failed", error);
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (req.method === "OPTIONS" && url.pathname === mcpPath) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (url.pathname === mcpPath && req.method && ["POST", "GET", "DELETE"].includes(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createCorosWorkoutServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`COROS Workout MCP listening on http://0.0.0.0:${port}${mcpPath}`);
});
