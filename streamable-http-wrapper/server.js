#!/usr/bin/env node
/**
 * Azure DevOps MCP Streamable HTTP Wrapper
 *
 * This server wraps the official Microsoft Azure DevOps MCP server (@azure-devops/mcp)
 * and exposes it via Streamable HTTP transport for remote network access by AI agents and applications.
 *
 * Architecture:
 * AI Agent/Application → (Streamable HTTP) → This wrapper → (stdio) → @azure-devops/mcp → Azure DevOps API
 *
 * Implements MCP Streamable HTTP Transport Specification (2025-03-26)
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

import "dotenv/config";
import express from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.MCP_API_KEY;
const ADO_ORG = process.env.AZURE_DEVOPS_ORG;
const ADO_PAT = process.env.AZURE_DEVOPS_PAT;
const ADO_ORG_URL = process.env.AZURE_DEVOPS_ORG_URL || `https://dev.azure.com/${ADO_ORG}`;
const DEFAULT_PROJECT = process.env.AZURE_DEVOPS_DEFAULT_PROJECT;

// Track active sessions
const sessions = new Map(); // sessionId -> { mcp: ChildProcess, pendingResponses: Map, lastActivity: Date }

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
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
    transport: "streamable-http",
    organization: ADO_ORG,
    project: DEFAULT_PROJECT,
    orgUrl: ADO_ORG_URL,
    activeSessions: sessions.size,
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
 * Generate a cryptographically secure session ID
 */
function generateSessionId() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Parse JSON-RPC message(s) from request body
 */
function parseJsonRpcMessages(body) {
  if (!body) return null;

  // Body can be a single message or array of messages
  if (Array.isArray(body)) {
    return body;
  }
  return [body];
}

/**
 * Check if messages contain any requests (not just responses/notifications)
 */
function hasRequests(messages) {
  return messages.some((msg) => msg.method && msg.id !== undefined);
}

/**
 * Check if messages are only responses/notifications (no requests)
 */
function onlyResponsesOrNotifications(messages) {
  return messages.every((msg) => !msg.method || msg.id === undefined);
}

/**
 * MCP endpoint - POST handler
 * Handles JSON-RPC messages from clients
 */
app.post("/mcp", validateApiKey, express.json(), async (req, res) => {
  const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Parse incoming JSON-RPC messages
  const messages = parseJsonRpcMessages(req.body);

  if (!messages) {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error: Invalid JSON",
      },
    });
  }

  console.log(`[${connectionId}] [POST] Received ${messages.length} message(s)`);

  // Get or validate session
  let sessionId = req.headers["mcp-session-id"];
  let session = sessionId ? sessions.get(sessionId) : null;

  // Handle initialize request - create new session
  const initMessage = messages.find((msg) => msg.method === "initialize");

  if (initMessage) {
    if (session) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request: Session already initialized",
        },
      });
    }

    // Create new session
    sessionId = generateSessionId();
    console.log(`[${connectionId}] [SESSION] Creating new session: ${sessionId}`);

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

    session = {
      mcp,
      sessionId,
      pendingResponses: new Map(), // messageId -> response object
      lastActivity: new Date(),
    };

    sessions.set(sessionId, session);
    console.log(`[${connectionId}] [SESSION] Active sessions: ${sessions.size}`);

    // Setup global stdout handler for this session
    mcp.stdout.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((l) => l.trim());

      for (const line of lines) {
        console.log(`[${sessionId}] [MCP-STDOUT] ${line}`);
      }
    });

    // Handle MCP process exit
    mcp.on("exit", (code, signal) => {
      console.log(`[${sessionId}] [MCP-EXIT] Process exited with code ${code} signal ${signal}`);
      sessions.delete(sessionId);
    });

    // Handle MCP stderr - log errors
    mcp.stderr.on("data", (data) => {
      const message = data.toString().trim();
      console.error(`[${sessionId}] [MCP-ERROR] ${message}`);
    });
  } else {
    // Non-initialize request must have valid session
    if (!session) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request: Missing or invalid Mcp-Session-Id header",
        },
      });
    }
  }

  // Update session activity
  session.lastActivity = new Date();

  // If only responses/notifications, return 202 Accepted with no body
  if (onlyResponsesOrNotifications(messages)) {
    console.log(`[${connectionId}] [POST] Only responses/notifications, returning 202`);

    // Send messages to MCP server
    for (const msg of messages) {
      session.mcp.stdin.write(JSON.stringify(msg) + "\n");
    }

    return res.status(202).send();
  }

  // If contains requests, need to stream responses via SSE
  console.log(`[${connectionId}] [POST] Contains requests, opening SSE stream`);

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

  // Include session ID in response header for initialize
  if (initMessage) {
    res.setHeader("Mcp-Session-Id", sessionId);
  }

  res.flushHeaders();

  // Track which request IDs we're waiting for
  const expectedResponseIds = new Set();
  messages.forEach((msg) => {
    if (msg.method && msg.id !== undefined) {
      expectedResponseIds.add(msg.id);
    }
  });

  // Handle stdout from MCP server - send via SSE
  const stdoutHandler = (data) => {
    const lines = data
      .toString()
      .split("\n")
      .filter((l) => l.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);

        // Send as SSE event
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(json)}\n\n`);
        }

        // Log message type
        const logType = json.method || json.result !== undefined ? "result" : json.error ? "error" : "notification";
        console.log(`[${connectionId}] [MCP-OUT] ${logType} ${json.id ? `(id: ${json.id})` : ""}`);

        // Track if this is a response to one of our requests
        if (json.id !== undefined && expectedResponseIds.has(json.id)) {
          expectedResponseIds.delete(json.id);

          // If all responses received, close stream
          if (expectedResponseIds.size === 0) {
            console.log(`[${connectionId}] [POST] All responses received, closing stream`);
            setTimeout(() => {
              if (!res.writableEnded) {
                res.end();
              }
            }, 100); // Small delay to ensure last message is sent
          }
        }
      } catch (e) {
        // Line is not valid JSON, might be debug output - ignore
        console.log(`[${connectionId}] [MCP-OUT-RAW] ${line}`);
      }
    }
  };

  session.mcp.stdout.on("data", stdoutHandler);

  // Send all messages to MCP server
  for (const msg of messages) {
    console.log(`[${connectionId}] [MCP-IN] Sending message: ${msg.method || "response"} ${msg.id ? `(id: ${msg.id})` : ""}`);
    session.mcp.stdin.write(JSON.stringify(msg) + "\n");
  }

  // Cleanup when response finishes
  res.on("finish", () => {
    console.log(`[${connectionId}] [POST] Response finished`);
    session.mcp.stdout.off("data", stdoutHandler);
  });

  // Handle errors on response stream
  res.on("error", (err) => {
    console.error(`[${connectionId}] [RESPONSE-ERROR]`, err.message);
    session.mcp.stdout.off("data", stdoutHandler);
  });

  // Timeout after 30 seconds if no responses
  const timeout = setTimeout(() => {
    if (!res.writableEnded && expectedResponseIds.size > 0) {
      console.error(`[${connectionId}] [TIMEOUT] No response after 30s, closing stream`);
      session.mcp.stdout.off("data", stdoutHandler);
      res.end();
    }
  }, 30000);

  res.on("close", () => clearTimeout(timeout));
});

/**
 * MCP endpoint - GET handler
 * Opens SSE stream for server-initiated messages (optional feature)
 */
app.get("/mcp", validateApiKey, (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (!sessionId) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Missing Mcp-Session-Id header",
    });
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({
      error: "Not Found",
      message: "Session not found or expired",
    });
  }

  // This implementation doesn't support GET streaming
  // Return 405 Method Not Allowed as per spec
  return res.status(405).json({
    error: "Method Not Allowed",
    message: "GET streaming not supported by this server",
  });
});

/**
 * MCP endpoint - DELETE handler
 * Terminates a session and cleans up resources
 */
app.delete("/mcp", validateApiKey, (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (!sessionId) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Missing Mcp-Session-Id header",
    });
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({
      error: "Not Found",
      message: "Session not found or expired",
    });
  }

  console.log(`[${sessionId}] [DELETE] Terminating session`);

  // Kill MCP process
  if (!session.mcp.killed) {
    session.mcp.kill("SIGTERM");
  }

  // Remove session
  sessions.delete(sessionId);

  res.status(204).send();
});

/**
 * Root endpoint - basic info
 */
app.get("/", (_req, res) => {
  res.json({
    name: "Azure DevOps MCP Streamable HTTP Wrapper",
    version: "1.0.0",
    transport: "streamable-http",
    specification: "2025-03-26",
    description: "Streamable HTTP wrapper for Microsoft Azure DevOps MCP server - Enables remote network access",
    organization: ADO_ORG,
    endpoints: {
      health: "GET /health",
      mcp: "POST /mcp (requires Authorization and Mcp-Session-Id headers)",
      delete: "DELETE /mcp (requires Authorization and Mcp-Session-Id headers)",
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
    availableEndpoints: ["GET /", "GET /health", "POST /mcp", "GET /mcp", "DELETE /mcp"],
  });
});

/**
 * Global error handler
 */
app.use((err, _req, res, _next) => {
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
║  Azure DevOps MCP Streamable HTTP Wrapper                      ║
║  Port: ${PORT.toString().padEnd(56)}║
║  Transport: Streamable HTTP (MCP 2025-03-26)                   ║
║  Organization: ${(ADO_ORG || "not-configured").padEnd(48)}║
║  Project: ${(DEFAULT_PROJECT || "not-configured").padEnd(51)}║
║  Org URL: ${(ADO_ORG_URL || "not-configured").padEnd(51)}║
║  Endpoint: POST /mcp                                           ║
║  Health Check: GET /health                                     ║
╚════════════════════════════════════════════════════════════════╝
  `);

  console.log("[STARTUP] Server started successfully");
  console.log("[STARTUP] Waiting for Streamable HTTP connections...");
});

/**
 * Graceful shutdown handling
 */
function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);

  // Kill all active MCP processes
  for (const [sessionId, session] of sessions.entries()) {
    console.log(`[SHUTDOWN] Terminating session ${sessionId}`);
    if (!session.mcp.killed) {
      session.mcp.kill("SIGTERM");
    }
  }

  server.close(() => {
    console.log("[SHUTDOWN] HTTP server closed");
    console.log("[SHUTDOWN] Active sessions at shutdown:", sessions.size);
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

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED-REJECTION]", reason);
  process.exit(1);
});
