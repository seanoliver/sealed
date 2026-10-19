import { z } from "zod";

// Not redundant: zod's package.json declares no side effects, so webpack
// (`next dev --webpack`, used by E2E_PORT runs) drops its locale setup and
// every message reads "Invalid input".
z.config(z.locales.en());
