#!/usr/bin/env node
/**
 * Test client for Azure DevOps MCP - Streamable HTTP
 * Implements the MCP Streamable HTTP transport specification
 */
import { config } from "dotenv";
config({ path: "../.env" });
import http from "http";

const API_KEY = process.env.MCP_API_KEY;

console.log("═".repeat(70));
console.log("🧪 Testing Azure DevOps MCP - Streamable HTTP");
console.log("═".repeat(70));
console.log("");

let sessionId = null;
let responseBuffer = "";

// Step 1: Send initialize request (this creates the session)
sendInitialize();

function sendInitialize() {
  console.log("📤 Sending: initialize");

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  });

  const req = http.request(
    {
      hostname: "localhost",
      port: 3000,
      path: "/mcp",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
    },
    (res) => {
      console.log("✅ Initialize response (Status:", res.statusCode + ")");

      // Get session ID from response header
      sessionId = res.headers["mcp-session-id"];
      if (sessionId) {
        console.log("🔑 Session:", sessionId.substring(0, 8) + "...");
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk.toString();
        // Handle SSE format
        processSSEData(data, (msg) => {
          if (msg.result?.protocolVersion) {
            console.log("📡 Initialized - Server ready");
            console.log(`   Protocol: ${msg.result.protocolVersion}`);
            console.log("");
            // Send initialized notification then list tools
            sendInitializedNotification();
            setTimeout(() => listTools(), 100);
          }
        });
      });
    }
  );

  req.on("error", (err) => console.error("❌ Error:", err.message));
  req.write(body);
  req.end();
}

function sendInitializedNotification() {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  const req = http.request({
    hostname: "localhost",
    port: 3000,
    path: "/mcp",
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId,
    },
  });
  req.write(body);
  req.end();
}

function listTools() {
  console.log("📤 Sending: tools/list");

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  const req = http.request(
    {
      hostname: "localhost",
      port: 3000,
      path: "/mcp",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
    },
    (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk.toString();
        processSSEData(data, (msg) => {
          if (msg.result?.tools) {
            console.log(`📋 Tools available: ${msg.result.tools.length}`);
            msg.result.tools.forEach((t) => console.log(`   • ${t.name}`));
            console.log("");
            setTimeout(() => callListRepos(), 100);
          }
        });
      });
    }
  );

  req.on("error", (err) => console.error("❌ Error:", err.message));
  req.write(body);
  req.end();
}

function callListRepos() {
  console.log("📤 Sending: tools/call (repo_list_repos_by_project)");

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "repo_list_repos_by_project",
      arguments: { project: "NOVA" },
    },
  });

  const req = http.request(
    {
      hostname: "localhost",
      port: 3000,
      path: "/mcp",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
    },
    (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk.toString();
        processSSEData(data, (msg) => {
          if (msg.result?.content) {
            const text = msg.result.content[0]?.text;
            if (text) {
              try {
                const repos = JSON.parse(text);
                if (Array.isArray(repos)) {
                  console.log(`📦 Repositories from Azure DevOps (${repos.length}):`);
                  console.log("─".repeat(70));
                  repos.forEach((r, i) => {
                    console.log(`   ${i + 1}. ${r.name}`);
                    console.log(`      ${r.url}`);
                  });
                  console.log("─".repeat(70));
                }
              } catch (e) {
                console.log("📥 Response:", text.substring(0, 200));
              }
            }
            console.log("");
            console.log("═".repeat(70));
            console.log("✅ All tests passed! Streamable HTTP working correctly.");
            console.log("═".repeat(70));
            process.exit(0);
          }
        });
      });
    }
  );

  req.on("error", (err) => console.error("❌ Error:", err.message));
  req.write(body);
  req.end();
}

function processSSEData(data, callback) {
  // Handle SSE format: event: message\ndata: {...}\n\n
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("data: ")) {
      try {
        const jsonStr = line.substring(6);
        const msg = JSON.parse(jsonStr);
        callback(msg);
      } catch (e) {
        // Not complete JSON yet
      }
    }
  }
}

setTimeout(() => {
  console.log("⏱️ Timeout");
  process.exit(1);
}, 30000);
