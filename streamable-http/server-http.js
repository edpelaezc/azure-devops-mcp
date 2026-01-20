#!/usr/bin/env node
/**
 * Azure DevOps MCP - Streamable HTTP Server (Bootstrap)
 * This file sets up process.argv BEFORE importing anything else
 * to satisfy yargs in index.js which is triggered by tool imports
 */

import { config } from "dotenv";
config({ path: "../.env" });

// CRITICAL: Set process.argv BEFORE dynamic import of the main server
// This must happen before any code that imports from ./dist/tools.js
process.argv = ["node", "server-http.js", process.env.AZURE_DEVOPS_ORG || "default", "-a", "env"];

// Now dynamically import the main server code
const { startServer } = await import("./server-http-main.js");
startServer();
