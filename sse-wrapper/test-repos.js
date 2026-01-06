#!/usr/bin/env node
/**
 * Test script to list repositories from Azure DevOps project NOVA
 */

import "dotenv/config";
import http from "http";

const API_KEY = process.env.MCP_API_KEY;
const PROJECT = process.env.AZURE_DEVOPS_DEFAULT_PROJECT || "NOVA";

console.log("═".repeat(80));
console.log(`📦 Listando repositorios del proyecto: ${PROJECT}`);
console.log("═".repeat(80));
console.log("");

const req = http.request(
  {
    hostname: "localhost",
    port: 3000,
    path: "/mcp",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
  },
  (res) => {
    console.log(`✅ Conectado (Status: ${res.statusCode})`);
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

            // Initialize response
            if (json.result && json.result.serverInfo) {
              console.log(`🔌 Servidor: ${json.result.serverInfo.name} v${json.result.serverInfo.version}`);
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
          } catch (e) {
            // Not valid JSON or notification, skip
          }
        }
      }
    });

    res.on("end", () => {
      console.log("⚠️  Conexión cerrada sin recibir datos completos");
      cleanup(1);
    });
  }
);

req.on("error", (err) => {
  console.error("❌ Error de conexión:", err.message);
  console.log("");
  console.log("💡 Asegúrate de que el servidor esté corriendo:");
  console.log("   npm start");
  cleanup(1);
});

// Send initialize message
const initMessage =
  JSON.stringify({
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
  }) + "\n";

// Send list repositories message
const reposMessage =
  JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "repo_list_repos_by_project",
      arguments: {
        project: PROJECT,
      },
    },
  }) + "\n";

console.log("📤 Enviando solicitud...");
console.log("");

req.write(initMessage);
req.write(reposMessage);

// Timeout after 10 seconds
const timeout = setTimeout(() => {
  console.error("⏱️  Timeout esperando respuesta (10s)");
  cleanup(1);
}, 10000);

function cleanup(exitCode = 0) {
  clearTimeout(timeout);
  req.destroy();
  console.log("═".repeat(80));
  process.exit(exitCode);
}
