"use client";

import {
  generateReactHelpers,
  generateUploadButton,
  generateUploadDropzone,
} from "@uploadthing/react";

// `import type` only — this pulls in nothing but a compile-time shape from
// src/app/api/uploadthing/core.ts, which otherwise drags requireRole -> auth.ts ->
// Better Auth -> Prisma into the client bundle. Dropping the `type` keyword here is
// exactly the mistake db.ts's own comment warns about for src/lib/session.ts.
import type { OurFileRouter } from "@/app/api/uploadthing/core";

/**
 * Typed upload widgets + hook for the menu-item-image route, generated once here so
 * every caller shares the same endpoint URL config instead of re-typing it.
 */
export const UploadButton = generateUploadButton<OurFileRouter>();
export const UploadDropzone = generateUploadDropzone<OurFileRouter>();
export const { useUploadThing } = generateReactHelpers<OurFileRouter>();
