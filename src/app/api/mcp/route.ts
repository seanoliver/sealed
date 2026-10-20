import { createMcpHandler } from "mcp-handler";
import { registerAgentTools, withAgentAuth } from "@/lib/agent/mcp";

const handler = createMcpHandler(registerAgentTools, {
  serverInfo: { name: "sealed", version: "1.0.0" },
  instructions:
    "Sealed is a private address book for holiday cards. These tools read the owner's contacts, send statuses and review queue.",
});

const authHandler = withAgentAuth(handler);

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
