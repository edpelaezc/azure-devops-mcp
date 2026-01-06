#!/usr/bin/env node
/**
 * Interactive test script for the MCP SSE Wrapper
 *
 * Usage:
 *   node test-interactive.js                    # List all tools
 *   node test-interactive.js workitems          # Get work items
 *   node test-interactive.js builds             # Get recent builds
 *   node test-interactive.js repos              # Get repositories
 *   node test-interactive.js search             # Search bugs
 */

import "dotenv/config";
import http from "http";

const API_KEY = process.env.MCP_API_KEY;
const HOST = "localhost";
const PORT = 3000;

// Test scenarios
const tests = {
  tools: {
    name: "List All Tools",
    messages: [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-script", version: "1.0.0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
    ],
  },

  workitems: {
    name: "Get Work Items (Top 5)",
    messages: [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-script", version: "1.0.0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "work-items_getWorkItems",
          arguments: { top: 5 },
        },
      },
    ],
  },

  builds: {
    name: "Get Recent Builds (Top 5)",
    messages: [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-script", version: "1.0.0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "pipelines_getBuilds",
          arguments: { top: 5 },
        },
      },
    ],
  },

  repos: {
    name: "Get Repositories",
    messages: [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-script", version: "1.0.0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "repositories_getRepositories",
          arguments: {},
        },
      },
    ],
  },

  search: {
    name: "Search Bugs (WIQL)",
    messages: [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-script", version: "1.0.0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "work-items_queryWorkItems",
          arguments: {
            wiql: "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.WorkItemType] = 'Bug' ORDER BY [System.CreatedDate] DESC",
          },
        },
      },
    ],
  },
};

// Get test type from command line
const testType = process.argv[2] || "tools";
const test = tests[testType];

if (!test) {
  console.error(`❌ Unknown test type: ${testType}`);
  console.log("\nAvailable tests:");
  Object.keys(tests).forEach((key) => {
    console.log(`  - ${key}: ${tests[key].name}`);
  });
  process.exit(1);
}

console.log("═".repeat(80));
console.log(`🧪 Test: ${test.name}`);
console.log("═".repeat(80));
console.log("");

// Make request
const req = http.request(
  {
    hostname: HOST,
    port: PORT,
    path: "/mcp",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
  },
  (res) => {
    console.log(`✅ Connected (Status: ${res.statusCode})`);
    console.log("");

    let messageCount = 0;
    let initReceived = false;
    let resultReceived = false;

    res.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const json = JSON.parse(line.substring(6));
            messageCount++;

            // Handle initialization response
            if (json.result && json.result.protocolVersion && !initReceived) {
              initReceived = true;
              console.log(`📡 Initialized: ${json.result.serverInfo.name} v${json.result.serverInfo.version}`);
              console.log("");
            }

            // Handle tools/list response
            else if (json.result && json.result.tools) {
              resultReceived = true;
              console.log(`📋 Received ${json.result.tools.length} tools:`);
              console.log("");

              // Group by domain
              const toolsByDomain = {};
              json.result.tools.forEach((tool) => {
                const domain = tool.name.split("_")[0];
                if (!toolsByDomain[domain]) toolsByDomain[domain] = [];
                toolsByDomain[domain].push(tool);
              });

              Object.keys(toolsByDomain)
                .sort()
                .forEach((domain) => {
                  console.log(`📦 ${domain.toUpperCase()} (${toolsByDomain[domain].length} tools)`);
                  toolsByDomain[domain].forEach((tool) => {
                    console.log(`   • ${tool.name}`);
                  });
                  console.log("");
                });

              cleanup();
            }

            // Handle tools/call response
            else if (json.result && json.result.content) {
              resultReceived = true;
              console.log("📊 Result:");
              console.log("─".repeat(80));

              json.result.content.forEach((item) => {
                if (item.type === "text") {
                  console.log(item.text);
                }
              });

              console.log("─".repeat(80));
              console.log("");
              cleanup();
            }

            // Handle notifications
            else if (json.method === "notifications/message") {
              // Silently ignore notifications
            }

            // Handle errors
            else if (json.error) {
              console.error("❌ Error:", json.error.message);
              if (json.error.data) {
                console.error("   Details:", JSON.stringify(json.error.data, null, 2));
              }
              cleanup(1);
            }
          } catch (e) {
            // Not valid JSON, skip
          }
        }
      }
    });

    res.on("end", () => {
      if (!resultReceived) {
        console.error("⚠️  Connection ended without receiving result");
      }
      cleanup();
    });
  }
);

req.on("error", (err) => {
  console.error("❌ Connection error:", err.message);
  console.log("");
  console.log("💡 Make sure the server is running:");
  console.log("   npm start");
  process.exit(1);
});

// Send all messages
test.messages.forEach((msg) => {
  req.write(JSON.stringify(msg) + "\n");
});

// Don't end the request - keep connection open for SSE
console.log(`📤 Sent ${test.messages.length} message(s)...`);
console.log("⏳ Waiting for response...");
console.log("");

// Timeout
const timeout = setTimeout(() => {
  console.error("⏱️  Timeout waiting for response (30s)");
  cleanup(1);
}, 30000);

function cleanup(exitCode = 0) {
  clearTimeout(timeout);
  req.destroy();
  console.log("═".repeat(80));
  if (exitCode === 0) {
    console.log("✅ Test completed successfully!");
  } else {
    console.log("❌ Test failed");
  }
  console.log("═".repeat(80));
  process.exit(exitCode);
}
