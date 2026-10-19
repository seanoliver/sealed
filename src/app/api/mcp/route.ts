import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerAgentTools, verifyBearer } from "@/lib/agent/mcp";

/**
 * Remote MCP server for agents (Streamable HTTP, stateless). Every request
 * needs a personal access token; tools then read through withRls with the
 * token owner's claims. The session proxy skips this path (see src/proxy.ts).
 */
const handler = createMcpHandler(registerAgentTools, {
  serverInfo: { name: "sealed", version: "1.0.0" },
  instructions:
    "Sealed is a private address book for holiday cards. These tools read the owner's contacts, send statuses and review queue.",
});

const authHandler = withMcpAuth(handler, verifyBearer, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
