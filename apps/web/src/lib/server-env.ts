import "server-only";
import { z } from "zod";

// Server-only settings. Never expose these to the browser.
const schema = z.object({
  /** Base URL of apps/api, e.g. http://localhost:8787 or https://api.compichef.com */
  API_URL: z.url(),
});

export const serverEnv = schema.parse({ API_URL: process.env.API_URL });
