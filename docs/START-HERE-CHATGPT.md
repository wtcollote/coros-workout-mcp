# Start here: try COROS Workout from ChatGPT

This guide is for people who use ChatGPT but do not program, do not know GitHub, and do not want to use a terminal.

## Option A — Try the DEMO

You do not need a COROS account, password, GitHub account, or local installation.

1. Open ChatGPT.
2. Go to **Settings → Apps**.
3. Enable **Developer mode** if it is available on your account.
4. Choose **Create app / Add custom MCP**.
5. Paste this address:

```text
https://coros-workout-demo.onrender.com/mcp
```

6. Let ChatGPT inspect/discover the tools and create the app.
7. Open a new chat and select **COROS Workout Demo** from the available apps/tools.
8. Try:

> Use COROS Workout in demo mode and analyze the athlete's current training state.

The demo uses synthetic running, cycling, and trail activities. It contains no real athlete data.

### Things to try

- “Summarize the last training week.”
- “How is the training trend evolving?”
- “What are the best activities?”
- “Find sessions similar to the latest ride.”
- “Are there any unusual activities?”
- “Find bodyweight back exercises.”

The public demo hard-disables COROS login. Even if someone tries to provide real credentials, the demo server will not authenticate to a real COROS account.

If ChatGPT does not show Developer mode or the option to add a custom MCP app, that capability is not currently available on your account.

---

## Option B — Use your real COROS account

This option creates **your own private server**. Your credentials are never shared with the public demo.

### Step 1 — Create your Render service

Open:

```text
https://render.com/deploy?repo=https://github.com/wtcollote/coros-workout-mcp
```

Public repository:

```text
https://github.com/wtcollote/coros-workout-mcp
```

Render will use the included `render.yaml` blueprint.

### Step 2 — Enter your private values

Render will ask for:

- `COROS_EMAIL`
- `COROS_PASSWORD`
- `COROS_REGION` — normally `eu` for Europe

The project already prepares:

- `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false`
- `COROS_PUBLIC_DEMO=false`
- `TRAINING_DATA_PROVIDER_ID=coros`

Never put your credentials in GitHub or in public files.

### Step 3 — Wait for Render to show Live

Render will give you an address similar to:

```text
https://your-service.onrender.com
```

Your MCP address is:

```text
https://your-service.onrender.com/mcp
```

### Step 4 — Connect it to ChatGPT

In ChatGPT:

1. Go to **Settings → Apps**.
2. Enable **Developer mode** if required.
3. Create a custom MCP app.
4. Paste `https://your-service.onrender.com/mcp`.
5. Let ChatGPT inspect the tools.
6. Save the app.
7. Open a new chat and select COROS Workout.

Then use normal requests such as:

> Analyze my recent training.

> Give me a weekly summary.

> Find strength exercises for chest and back.

> Create a 40-minute strength workout.

Operations that modify a real COROS account remain subject to the connector's explicit-confirmation rules.

---

## Which option should I choose?

**Just want to see what it does:** use the DEMO.

**Want to analyze your real training and use COROS features:** create your own private Render service.

You do not need to understand GitHub, Node.js, or MCP to follow these two paths.