/**
 * Azure DevOps MCP - Streamable HTTP Server (Main)
 * Sin stdio, usa MCP directamente en memoria con TODOS los tools de Microsoft
 * Implementa el transporte Streamable HTTP según la especificación MCP
 */

import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getBearerHandler, WebApi } from "azure-devops-node-api";

// Import Microsoft's tool configuration
import { configureAllTools } from "../dist/tools.js";
import { DomainsManager } from "../dist/shared/domains.js";
import { packageVersion } from "../dist/version.js";

export function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const API_KEY = process.env.MCP_API_KEY;
  const ADO_ORG = process.env.AZURE_DEVOPS_ORG;
  const ADO_PAT = process.env.AZURE_DEVOPS_PAT;
  const ADO_ORG_URL = process.env.AZURE_DEVOPS_ORG_URL || `https://dev.azure.com/${ADO_ORG}`;
  const DEFAULT_PROJECT = process.env.AZURE_DEVOPS_DEFAULT_PROJECT;

  // Enable all domains
  const domainsManager = new DomainsManager(["all"]);
  const enabledDomains = domainsManager.getEnabledDomains();

  let activeConnections = 0;
  const startTime = Date.now();

  // Map to store transports and servers by sessionId
  const sessions = new Map();

  app.use(express.json());

  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  function validateApiKey(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing Authorization header" });
    if (authHeader.replace("Bearer ", "") !== API_KEY) return res.status(403).json({ error: "Invalid API key" });
    next();
  }

  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      service: "azdo-mcp-streamable-http",
      version: packageVersion,
      organization: ADO_ORG,
      project: DEFAULT_PROJECT,
      enabledDomains: Array.from(enabledDomains),
      activeConnections,
      activeSessions: sessions.size,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  /**
   * Token provider - returns the PAT for authentication
   */
  function createTokenProvider() {
    return async () => ADO_PAT;
  }

  /**
   * Connection provider - returns Azure DevOps WebApi client
   */
  function createConnectionProvider() {
    return async () => {
      const authHandler = getBearerHandler(ADO_PAT);
      return new WebApi(ADO_ORG_URL, authHandler, undefined, {
        productName: "AzureDevOps.MCP.StreamableHTTP",
        productVersion: packageVersion,
      });
    };
  }

  /**
   * User agent provider
   */
  function createUserAgentProvider() {
    return () => `AzureDevOps.MCP.StreamableHTTP/${packageVersion}`;
  }

  /**
   * Creates a new MCP server with all tools configured
   */
  function createMcpServer() {
    const server = new McpServer({
      name: "Azure DevOps MCP Server",
      version: packageVersion,
    });

    const tokenProvider = createTokenProvider();
    const connectionProvider = createConnectionProvider();
    const userAgentProvider = createUserAgentProvider();

    configureAllTools(server, tokenProvider, connectionProvider, userAgentProvider, enabledDomains);

    return server;
  }

  // Streamable HTTP endpoint - handles GET, POST, DELETE
  app.all("/mcp", validateApiKey, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];

    // Handle existing session
    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // For POST without session (initialization) or GET to start SSE stream
    if (req.method === "POST" || req.method === "GET") {
      // Check if this is an initialization request
      const isInitRequest = req.method === "POST" && req.body?.method === "initialize";

      if (req.method === "POST" && !isInitRequest && !sessionId) {
        // Non-init POST without session ID is invalid
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: Mcp-Session-Id header required for non-initialization requests",
          },
          id: req.body?.id || null,
        });
      }

      // Create new session for initialization
      if (isInitRequest || req.method === "GET") {
        activeConnections++;
        console.log(`[MCP] New session request. Active: ${activeConnections}`);

        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, { server, transport });
            console.log(`[MCP] Session initialized: ${newSessionId}`);
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId);
            activeConnections--;
            console.log(`[MCP] Session closed: ${closedSessionId}. Active: ${activeConnections}`);
          },
        });

        // Connect server to transport
        await server.connect(transport);
        console.log(`[MCP] Server connected, ${enabledDomains.size} domains configured`);

        // Handle the request
        await transport.handleRequest(req, res, req.body);
        return;
      }
    }

    // Session not found
    if (sessionId) {
      return res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Session not found",
        },
        id: null,
      });
    }

    // Method not allowed
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed",
      },
      id: null,
    });
  });

  app.listen(PORT, () => {
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║  Azure DevOps MCP - Streamable HTTP Server               ║");
    console.log("╠═══════════════════════════════════════════════════════════╣");
    console.log(`║  Version: ${packageVersion.padEnd(47)}║`);
    console.log(`║  Port: ${PORT}                                              ║`);
    console.log(`║  Organization: ${(ADO_ORG || "N/A").padEnd(42)}║`);
    console.log(`║  Project: ${(DEFAULT_PROJECT || "N/A").padEnd(47)}║`);
    console.log(`║  Domains: ${Array.from(enabledDomains).join(", ").substring(0, 46).padEnd(47)}║`);
    console.log("╠═══════════════════════════════════════════════════════════╣");
    console.log("║  POST /mcp     - JSON-RPC messages (Streamable HTTP)     ║");
    console.log("║  GET  /mcp     - SSE stream for server notifications     ║");
    console.log("║  DELETE /mcp   - Terminate session                       ║");
    console.log("║  GET  /health  - Health check                            ║");
    console.log("╠═══════════════════════════════════════════════════════════╣");
    console.log("║  Transport: Streamable HTTP (MCP 2024-11-05 spec)        ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log("");
  });
}
