/**
 * Netlify Background Function: /api/interpret-run (runs up to 15 minutes; answers 202 at once).
 *
 * Free LLM endpoints can take longer than a synchronous function may run, so /api/interpret hands
 * the model call to this function with a signed job token. It calls the model, runs the grounding
 * check and stores the result, which the dashboard then fetches with GET /api/interpret?job=<id>.
 * Requests without a valid token are ignored.
 */
import type { Config } from "@netlify/functions";
import { runInterpretJob } from "../lib/handler";
import { buildDeps } from "../lib/runtime";

export default async (request: Request) => {
  const outcome = await runInterpretJob(request, await buildDeps("background", request.url));
  console.log(`interpret job: ${outcome}`);
};

export const config: Config = {
  path: "/api/interpret-run",
  background: true,
};
