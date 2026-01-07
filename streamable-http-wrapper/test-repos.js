#!/usr/bin/env node
/**
 * Test script to list repositories from Azure DevOps project NOVA
 * Uses Streamable HTTP transport (MCP 2025-03-26)
 */

import "dotenv/config";
import http from "node:http";

const API_KEY = process.env.MCP_API_KEY;
const PROJECT = process.env.AZURE_DEVOPS_DEFAULT_PROJECT || "NOVA";
const HOST = process.env.MCP_HOST || "localhost";
const PORT = process.env.MCP_PORT || 3000;

console.log("═".repeat(80));
console.log(`📦 Listando repositorios del proyecto: ${PROJECT}`);
console.log(`🔗 Usando Streamable HTTP transport`);
console.log("═".repeat(80));
console.log("");

let sessionId = null;

/**
 * Send JSON-RPC message(s) to MCP server via Streamable HTTP
 */
function sendMcpRequest(messages, onData, onComplete) {
  const messageArray = Array.isArray(messages) ? messages : [messages];

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${API_KEY}`,
    "Accept": "text/event-stream, application/json",
  };

  // Add session ID if we have one
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const req = http.request(
    {
      hostname: HOST,
      port: PORT,
      path: "/mcp",
      method: "POST",
      headers,
    },
    (res) => {
      console.log(`✅ Response Status: ${res.statusCode}`);

      // Capture session ID from response header (for initialize)
      if (res.headers["mcp-session-id"]) {
        sessionId = res.headers["mcp-session-id"];
        console.log(`🔑 Session ID: ${sessionId}`);
      }

      // Handle 202 Accepted (no response expected)
      if (res.statusCode === 202) {
        console.log("📨 Message accepted (no response expected)");
        if (onComplete) onComplete();
        return;
      }

      // Handle error responses
      if (res.statusCode >= 400) {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          console.error("❌ Error response:", body);
          cleanup(1);
        });
        return;
      }

      // Handle SSE stream (for requests)
      if (res.headers["content-type"]?.includes("text/event-stream")) {
        console.log("📡 SSE stream opened");
        console.log("");

        let buffer = "";

        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");

          // Keep last incomplete line in buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const json = JSON.parse(line.substring(6));
                if (onData) onData(json);
              } catch (e) {
                console.error("⚠️  Failed to parse SSE data:", e.message);
              }
            } else if (line.startsWith(": ")) {
              // Comment/keep-alive - ignore
            }
          }
        });

        res.on("end", () => {
          console.log("");
          console.log("📡 SSE stream closed");
          if (onComplete) onComplete();
        });
      }
      // Handle JSON response (batch)
      else if (res.headers["content-type"]?.includes("application/json")) {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            const messages = Array.isArray(json) ? json : [json];
            messages.forEach((msg) => {
              if (onData) onData(msg);
            });
            if (onComplete) onComplete();
          } catch (e) {
            console.error("❌ Failed to parse JSON response:", e.message);
            cleanup(1);
          }
        });
      }
    }
  );

  req.on("error", (err) => {
    console.error("❌ Error de conexión:", err.message);
    console.log("");
    console.log("💡 Asegúrate de que el servidor esté corriendo:");
    console.log("   npm start");
    cleanup(1);
  });

  // Send request body
  const body = JSON.stringify(messageArray);
  req.setHeader("Content-Length", Buffer.byteLength(body));
  req.write(body);
  req.end();

  return req;
}

/**
 * Handle incoming JSON-RPC messages
 */
function handleMessage(json) {
  // Initialize response
  if (json.result && json.result.serverInfo) {
    console.log(`🔌 Servidor: ${json.result.serverInfo.name} v${json.result.serverInfo.version}`);
    console.log(`📋 Protocolo: ${json.result.protocolVersion}`);
    console.log("");
  }

  // Repositories response
  else if (json.result && json.result.content) {
    const content = json.result.content[0];

    if (content.type === "text") {
      const data = JSON.parse(content.text);

      if (Array.isArray(data) && data.length > 0) {
        console.log(`📂 Encontrados ${data.length} repositorio(s):`);
        console.log("─".repeat(80));
        console.log("");

        data.forEach((repo, index) => {
          console.log(`${index + 1}. ${repo.name}`);
          console.log(`   ID: ${repo.id}`);
          console.log(`   URL: ${repo.webUrl || repo.url}`);
          console.log(`   Default Branch: ${repo.defaultBranch || "N/A"}`);
          console.log(`   Size: ${repo.size ? (repo.size / 1024).toFixed(2) + " KB" : "N/A"}`);
          console.log("");
        });

        console.log("─".repeat(80));
        cleanup(0);
      } else {
        console.log("⚠️  No se encontraron repositorios o respuesta vacía");
        console.log("Respuesta:", content.text);
        cleanup(0);
      }
    }
  }

  // Error response
  else if (json.error) {
    console.error("❌ Error del servidor MCP:");
    console.error(`   Código: ${json.error.code}`);
    console.error(`   Mensaje: ${json.error.message}`);
    if (json.error.data) {
      console.error(`   Detalles: ${JSON.stringify(json.error.data, null, 2)}`);
    }
    cleanup(1);
  }

  // Other messages (notifications, etc.)
  else {
    console.log("📬 Mensaje recibido:", JSON.stringify(json, null, 2));
  }
}

// Step 1: Initialize
console.log("📤 Paso 1: Inicializando sesión...");
console.log("");

sendMcpRequest(
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "test-repos",
        version: "1.0.0",
      },
    },
  },
  (msg) => {
    handleMessage(msg);

    // After initialize succeeds, send the list repos request
    if (msg.result && msg.result.serverInfo) {
      console.log("📤 Paso 2: Solicitando lista de repositorios...");
      console.log("");

      sendMcpRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "repo_list_repos_by_project",
            arguments: {
              project: PROJECT,
            },
          },
        },
        handleMessage
      );
    }
  }
);

// Timeout after 10 seconds
const timeout = setTimeout(() => {
  console.error("⏱️  Timeout esperando respuesta (10s)");
  cleanup(1);
}, 10000);

function cleanup(exitCode = 0) {
  clearTimeout(timeout);
  console.log("═".repeat(80));
  process.exit(exitCode);
}
