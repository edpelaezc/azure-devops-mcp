#!/usr/bin/env node
/**
 * Azure DevOps MCP SSE Wrapper
 *
 * This server wraps the official Microsoft Azure DevOps MCP server (@azure-devops/mcp)
 * and exposes it via HTTPS/SSE for remote network access by AI agents and applications.
 *
 * Architecture:
 * AI Agent/Application → (HTTPS/SSE) → This wrapper → (stdio) → @azure-devops/mcp → Azure DevOps API
 */

import "dotenv/config";
import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.MCP_API_KEY;
const ADO_ORG = process.env.AZURE_DEVOPS_ORG;
const ADO_PAT = process.env.AZURE_DEVOPS_PAT;
const ADO_ORG_URL = process.env.AZURE_DEVOPS_ORG_URL || `https://dev.azure.com/${ADO_ORG}`;
const DEFAULT_PROJECT = process.env.AZURE_DEVOPS_DEFAULT_PROJECT;

// Track active connections
let activeConnections = 0;

// Request logging middleware (before body parsing)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// Middleware - only parse JSON for health endpoint, not for /mcp
app.use((req, res, next) => {
  if (req.path === "/mcp") {
    next();
  } else {
    express.json()(req, res, next);
  }
});

/**
 * Health check endpoint
 * Used by Kubernetes liveness/readiness probes and ALB health checks
 */
app.get("/health", (req, res) => {
  const health = {
    status: "healthy",
    service: "azdo-mcp-wrapper",
    version: "1.0.0",
    organization: ADO_ORG,
    project: DEFAULT_PROJECT,
    orgUrl: ADO_ORG_URL,
    activeConnections,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };

  res.json(health);
});

/**
 * API Key validation middleware
 */
function validateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.error("[AUTH] Missing Authorization header");
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing Authorization header",
    });
  }

  const expectedAuth = `Bearer ${API_KEY}`;
  if (authHeader !== expectedAuth) {
    console.error("[AUTH] Invalid API key");
    return res.status(403).json({
      error: "Forbidden",
      message: "Invalid API key",
    });
  }

  next();
}

/**
 * MCP endpoint for AI agents and applications
 * This endpoint establishes a long-lived connection using Server-Sent Events (SSE)
 * and pipes communication between the client and the MCP server
 */
app.post("/mcp", validateApiKey, (req, res) => {
  activeConnections++;
  const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[${connectionId}] [MCP-SSE] New SSE connection established`);
  console.log(`[${connectionId}] [MCP-SSE] Active connections: ${activeConnections}`);

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  // Spawn the official Microsoft MCP server as a child process
  const mcpPath = path.join(__dirname, "node_modules", "@azure-devops", "mcp", "dist", "index.js");

  console.log(`[${connectionId}] [MCP-SPAWN] Starting MCP server process`);
  console.log(`[${connectionId}] [MCP-SPAWN] Organization: ${ADO_ORG}`);

  const mcp = spawn("node", [mcpPath, ADO_ORG], {
    env: {
      ...process.env,
      AZURE_DEVOPS_ORG_URL: ADO_ORG_URL,
      AZURE_DEVOPS_PAT: ADO_PAT,
      AZURE_DEVOPS_DEFAULT_PROJECT: DEFAULT_PROJECT,
      NODE_ENV: process.env.NODE_ENV || "production",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let mcpReady = false;

  // Handle stdout from MCP server - pipe to SSE
  mcp.stdout.on("data", (data) => {
    const lines = data
      .toString()
      .split("\n")
      .filter((l) => l.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);

        // Send as SSE event
        res.write(`data: ${JSON.stringify(json)}\n\n`);

        // Log method or result type
        const logType = json.method || json.result || json.error || "notification";
        console.log(`[${connectionId}] [MCP-OUT] ${logType}`);

        if (!mcpReady && json.method === "initialize") {
          mcpReady = true;
          console.log(`[${connectionId}] [MCP-READY] Server initialized`);
        }
      } catch (e) {
        // Line is not valid JSON, might be debug output - ignore
        console.log(`[${connectionId}] [MCP-OUT-RAW] ${line}`);
      }
    }
  });

  // Handle stdin from client - pipe to MCP server
  req.on("data", (chunk) => {
    try {
      const data = chunk.toString();
      console.log(`[${connectionId}] [MCP-IN] Received ${chunk.length} bytes`);
      mcp.stdin.write(chunk);
    } catch (e) {
      console.error(`[${connectionId}] [MCP-IN-ERROR] Failed to write to MCP stdin:`, e.message);
    }
  });

  // Handle MCP stderr - log errors
  mcp.stderr.on("data", (data) => {
    const message = data.toString().trim();
    console.error(`[${connectionId}] [MCP-ERROR] ${message}`);
  });

  // Handle MCP process exit
  mcp.on("exit", (code, signal) => {
    console.log(`[${connectionId}] [MCP-EXIT] Process exited with code ${code} signal ${signal}`);
    if (!res.writableEnded) {
      res.end();
    }
  });

  // Keep-alive to prevent connection timeout
  const keepAliveInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": keep-alive\n\n");
    }
  }, 30000); // Every 30 seconds

  // Cleanup on client disconnect
  req.on("close", () => {
    activeConnections--;
    console.log(`[${connectionId}] [CLIENT-DISCONNECT] Client disconnected`);
    console.log(`[${connectionId}] [CLIENT-DISCONNECT] Active connections: ${activeConnections}`);

    clearInterval(keepAliveInterval);

    if (!mcp.killed) {
      console.log(`[${connectionId}] [CLEANUP] Killing MCP process`);
      mcp.kill("SIGTERM");
    }

    if (!res.writableEnded) {
      res.end();
    }
  });

  // Handle errors on response stream
  res.on("error", (err) => {
    console.error(`[${connectionId}] [RESPONSE-ERROR]`, err.message);
    if (!mcp.killed) {
      mcp.kill("SIGTERM");
    }
  });
});

/**
 * Root endpoint - basic info
 */
app.get("/", (req, res) => {
  res.json({
    name: "Azure DevOps MCP SSE Wrapper",
    version: "1.0.0",
    description: "SSE wrapper for Microsoft Azure DevOps MCP server - Enables remote network access",
    organization: ADO_ORG,
    endpoints: {
      health: "GET /health",
      mcp: "POST /mcp (requires Authorization header)",
    },
    documentation: "https://github.com/microsoft/azure-devops-mcp",
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Endpoint ${req.method} ${req.path} not found`,
    availableEndpoints: ["GET /", "GET /health", "POST /mcp"],
  });
});

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  console.error("[ERROR]", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "development" ? err.message : "An unexpected error occurred",
  });
});

/**
 * Start server
 */
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  Azure DevOps MCP SSE Wrapper                                  ║
║  Port: ${PORT.toString().padEnd(56)}║
║  Organization: ${(ADO_ORG || "not-configured").padEnd(48)}║
║  Project: ${(DEFAULT_PROJECT || "not-configured").padEnd(51)}║
║  Org URL: ${(ADO_ORG_URL || "not-configured").padEnd(51)}║
║  Endpoint: POST /mcp                                           ║
║  Health Check: GET /health                                     ║
╚════════════════════════════════════════════════════════════════╝
  `);

  console.log("[STARTUP] Server started successfully");
  console.log("[STARTUP] Waiting for SSE connections...");
});

/**
 * Graceful shutdown handling
 */
function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);

  server.close(() => {
    console.log("[SHUTDOWN] HTTP server closed");
    console.log("[SHUTDOWN] Active connections at shutdown:", activeConnections);
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error("[SHUTDOWN] Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT-EXCEPTION]", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[UNHANDLED-REJECTION]", reason);
  process.exit(1);
});
