# Zero-cost hosting and connection guide

**Language:** **English** · [Español](FREE-CONNECTION-GUIDE-ES.md)

This guide separates two different things:

1. **Running the MCP server without paying for hosting**.
2. **Connecting it to an MCP client** such as ChatGPT or another compatible client.

The server itself can run for **€0**. MCP availability in ChatGPT depends on your ChatGPT plan and can change, so do not confuse "free hosting" with "all ChatGPT MCP features are free".

## Option A — 100% local, €0, no hosting

This is the cheapest and most private option.

### Requirements

- Node.js 22 recommended.
- Git.
- A COROS account.
- An MCP client that supports local `stdio` servers.

### Steps

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO
npm ci
npm run build
```

Create a local `.env` from `.env.example` and add your own credentials. **Never commit `.env` to GitHub.**

Minimal example:

```env
COROS_EMAIL=you@example.com
COROS_PASSWORD=your-password
COROS_REGION=eu
COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false
```

Run it through `stdio`:

```bash
npm start
```

If your MCP client lets you configure a local command, point Node at the compiled server output. You do not need a domain, cloud server or payment card.

### Advantages

- €0 hosting cost.
- Credentials remain on your own computer.
- No MCP endpoint is exposed to the public Internet.
- Good for testing and personal use.

### Limitation

ChatGPT does not connect directly to an ordinary local MCP server. If ChatGPT is your only target, use one of the remote options below and first verify that your plan supports the MCP capabilities you need.

Official reference: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

---

## Option B — Render Free, €0 hosting for testing/hobby use

Render provides free web services with limitations and positions them for testing, hobby projects and demos rather than critical production workloads.

Official reference: https://render.com/docs/free

### Deployment

1. Fork or clone this repository into your GitHub account.
2. In Render, create a **Web Service** from the repository.
3. This project includes a `Dockerfile`, so you can deploy it as Docker.
4. Add environment variables in the Render dashboard, never in Git:

```text
COROS_EMAIL
COROS_PASSWORD
COROS_REGION=eu
COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false
```

5. Deploy the service.
6. Verify the root endpoint first and then the MCP endpoint:

```text
https://YOUR-SERVICE.onrender.com/
https://YOUR-SERVICE.onrender.com/mcp
```

### Cost

- Hosting: €0 while you remain within the free-plan conditions.
- You do not need a paid instance for personal testing.

### Limitations

- A free service may sleep when idle and take time to wake up.
- Do not use it as critical infrastructure.
- Do not expose a personal MCP instance containing account credentials without an appropriate authentication layer.

---

## Option C — GitHub Codespaces, €0 within the included quota

Personal GitHub accounts include a monthly Codespaces allowance. Always check the current allowance for your account before relying on it.

Official references:

- https://docs.github.com/en/billing/concepts/product-billing/github-codespaces
- https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository

### Steps

1. Open the repository on GitHub.
2. Choose `Code` → `Codespaces` → create a Codespace.
3. In the terminal:

```bash
npm ci
npm run build
npm start
```

4. Store credentials as environment secrets or Codespace variables. Do not write them into versioned files.
5. If you need remote access, expose/forward the server port using the Codespaces visibility controls.

---

# Connecting to ChatGPT

The server side can cost €0, but ChatGPT MCP access depends on the plan and the capabilities currently enabled for your account.

Official reference: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

Therefore, **it is not accurate to promise full ChatGPT + MCP + write access for €0 to every account**. What can be fully free is the server itself and its local execution or use on a free hosting tier.

## Typical remote setup in ChatGPT

When your plan/workspace supports custom MCP apps:

1. Deploy the server and obtain an HTTPS URL.
2. Verify that `/mcp` responds.
3. Enable Developer mode in ChatGPT if your plan supports it.
4. Create a custom MCP app/connector.
5. Use this endpoint:

```text
https://YOUR-DOMAIN/mcp
```

6. Review the tool permissions carefully before enabling write actions.

Do not share the endpoint of a personal instance that contains private COROS credentials or environment variables.

---

# Recommended €0 path

- **Local (`stdio`) → €0** for personal use and maximum privacy.
- **Render Free → €0 hosting** for a remote test URL, subject to free-tier limits.
- **GitHub Codespaces → €0 within the included quota** for temporary cloud development.
- **ChatGPT:** first verify MCP availability for your plan.

---

# Minimum security checklist

- Never commit `.env`.
- Never publish `COROS_EMAIL`, `COROS_PASSWORD`, Strava tokens or Garmin tokens.
- Use one instance per user/account while token storage remains local to the instance.
- Keep `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false` unless you understand the session-conflict risk.
- Do not expose an instance with write actions without authentication.
- Before accepting a Pull Request that changes authentication, endpoints or token storage, review the diff and run the tests.
