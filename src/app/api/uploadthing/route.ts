import { createRouteHandler } from "uploadthing/next";

import { ourFileRouter } from "@/app/api/uploadthing/core";

// Thin by design: all the actual authorization lives in core.ts's `.middleware()`. This
// file only wires Uploadthing's generated GET/POST handlers to our router, the same
// shape their Next.js adapter expects for any App Router project.
export const { GET, POST } = createRouteHandler({
  router: ourFileRouter,
});
