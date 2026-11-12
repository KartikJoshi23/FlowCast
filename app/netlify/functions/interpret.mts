/**
 * Netlify Function: /api/interpret (status, request, job polling). See lib/handler.ts for the flow
 * and lib/runtime.ts for the environment variables. The API key never leaves the server.
 */
import type { Config, Context } from "@netlify/functions";
import { handleInterpret } from "../lib/handler";
import { buildDeps } from "../lib/runtime";

export default async (request: Request, context: Context) =>
  handleInterpret(request, context.ip, await buildDeps("request", request.url));

export const config: Config = {
  path: "/api/interpret",
};
