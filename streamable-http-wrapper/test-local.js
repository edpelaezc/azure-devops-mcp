#!/usr/bin/env node
/**
 * Local testing script for the MCP SSE Wrapper
 *
 * This script helps you test the wrapper locally before deploying to Kubernetes.
 * It simulates SSE client requests.
 */

import "dotenv/config";
import http from "http";

const API_KEY = process.env.MCP_API_KEY || "test-api-key";
const HOST = process.env.TEST_HOST || "localhost";
const PORT = process.env.TEST_PORT || 3000;

console.log("=".repeat(60));
console.log("Azure DevOps MCP SSE Wrapper - Local Test Suite");
console.log("=".repeat(60));

/**
 * Test 1: Health Check
 */
async function testHealthCheck() {
  console.log("\n[TEST 1] Health Check");
  console.log("-".repeat(60));

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: "/health",
        method: "GET",
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          console.log(`Status: ${res.statusCode}`);
          if (res.statusCode === 200) {
            const health = JSON.parse(data);
            console.log("✓ Health check passed");
            console.log(`  Organization: ${health.organization}`);
            console.log(`  Project: ${health.project}`);
            console.log(`  Status: ${health.status}`);
            console.log(`  Uptime: ${Math.floor(health.uptime)}s`);
            resolve(true);
          } else {
            console.error("✗ Health check failed");
            reject(new Error(`Health check returned ${res.statusCode}`));
          }
        });
      }
    );

    req.on("error", (err) => {
      console.error("✗ Connection error:", err.message);
      reject(err);
    });

    req.end();
  });
}

/**
 * Test 2: SSE Connection without Auth
 */
async function testSSEWithoutAuth() {
  console.log("\n[TEST 2] SSE Connection without Authentication");
  console.log("-".repeat(60));

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          console.log(`Status: ${res.statusCode}`);
          if (res.statusCode === 401) {
            console.log("✓ Correctly rejected unauthenticated request");
            resolve(true);
          } else {
            console.error("✗ Should have rejected unauthenticated request");
            reject(new Error("Authentication check failed"));
          }
        });
      }
    );

    req.on("error", (err) => {
      console.error("✗ Connection error:", err.message);
      reject(err);
    });

    req.end();
  });
}

/**
 * Test 3: SSE Connection with Invalid Auth
 */
async function testSSEWithInvalidAuth() {
  console.log("\n[TEST 3] SSE Connection with Invalid API Key");
  console.log("-".repeat(60));

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer invalid-key",
        },
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          console.log(`Status: ${res.statusCode}`);
          if (res.statusCode === 403) {
            console.log("✓ Correctly rejected invalid API key");
            resolve(true);
          } else {
            console.error("✗ Should have rejected invalid API key");
            reject(new Error("API key validation failed"));
          }
        });
      }
    );

    req.on("error", (err) => {
      console.error("✗ Connection error:", err.message);
      reject(err);
    });

    req.end();
  });
}

/**
 * Test 4: SSE Connection with Valid Auth + MCP Initialize
 */
async function testSSEWithValidAuth() {
  console.log("\n[TEST 4] SSE Connection with Valid Authentication + Initialize");
  console.log("-".repeat(60));

  return new Promise((resolve, reject) => {
    let timeout;
    let receivedData = false;

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
        console.log(`Status: ${res.statusCode}`);

        if (res.statusCode !== 200) {
          console.error("✗ Request failed with status:", res.statusCode);
          reject(new Error(`Invalid status code: ${res.statusCode}`));
          return;
        }

        console.log("✓ SSE connection established");

        // Handle SSE events
        res.on("data", (chunk) => {
          const lines = chunk.toString().split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const jsonData = JSON.parse(line.substring(6));
                receivedData = true;
                console.log("  Received response:", JSON.stringify(jsonData, null, 2));

                // If we got a response, test passed
                clearTimeout(timeout);
                req.destroy();
                console.log("✓ MCP initialize response received");
                resolve(true);
              } catch (e) {
                // Not JSON, probably keep-alive
              }
            }
          }
        });

        // Timeout after 10 seconds
        timeout = setTimeout(() => {
          req.destroy();
          if (receivedData) {
            console.log("✓ Connection successful (timed out waiting for more data)");
            resolve(true);
          } else {
            console.error("✗ No data received within timeout");
            reject(new Error("Timeout waiting for MCP response"));
          }
        }, 10000);
      }
    );

    req.on("error", (err) => {
      clearTimeout(timeout);
      if (err.code === "ECONNRESET" && receivedData) {
        // Connection closed after receiving data - this is OK
        console.log("✓ Connection closed after receiving data");
        resolve(true);
      } else {
        console.error("✗ Connection error:", err.message);
        reject(err);
      }
    });

    // Send MCP initialize message after creating the request
    const initMessage =
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "test-client",
            version: "1.0.0",
          },
        },
      }) + "\n";

    console.log("  Sending initialize request...");
    req.write(initMessage);
    // Note: Don't call req.end() - keep connection open for SSE events
  });
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    await testHealthCheck();
    await testSSEWithoutAuth();
    await testSSEWithInvalidAuth();
    await testSSEWithValidAuth();

    console.log("\n" + "=".repeat(60));
    console.log("✓ All tests passed!");
    console.log("=".repeat(60));
    console.log("\nNext steps:");
    console.log("1. Try more MCP commands (tools_list, etc.)");
    console.log("2. Build Docker image: docker build -t azdo-mcp-wrapper .");
    console.log("3. Deploy to EKS: kubectl apply -f k8s/deployment.yaml");
    process.exit(0);
  } catch (err) {
    console.log("\n" + "=".repeat(60));
    console.error("✗ Tests failed:", err.message);
    console.log("=".repeat(60));
    process.exit(1);
  }
}

// Check if server is running
console.log(`\nConnecting to ${HOST}:${PORT}...`);
runTests();
