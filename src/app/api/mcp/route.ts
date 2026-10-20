import { createMcpHandler } from "mcp-handler";
import { registerAgentTools, SERVER_INSTRUCTIONS, withAgentAuth } from "@/lib/agent/mcp";

const handler = createMcpHandler(registerAgentTools, {
  serverInfo: { name: "sealed", version: "1.0.0" },
  instructions: SERVER_INSTRUCTIONS,
});

const authHandler = withAgentAuth(handler);

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
