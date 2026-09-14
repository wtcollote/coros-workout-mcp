#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCorosWorkoutServer } from "./index.js";

const server = createCorosWorkoutServer();
await server.connect(new StdioServerTransport());
