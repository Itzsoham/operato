import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";

import { MemberRole } from "@/generated/prisma/enums";
import { AuthError, requireRole } from "@/lib/auth-guard";

const f = createUploadthing();

// Same policy as menu writes (src/app/api/restaurants/[restaurantId]/menu/items/route.ts):
// a waiter should not be able to attach a photo to a dish any more than they can reprice
// one.
const MANAGES_MENU = [MemberRole.OWNER, MemberRole.MANAGER] as const;

/**
 * Uploadthing owns its own route contract (`/api/uploadthing`, no `[restaurantId]` URL
 * segment), so the usual "restaurantId comes from the URL param" rule has nothing to
 * attach to here. The client instead sends it through `.input()` — see
 * `src/lib/uploadthing.ts` — and this `.middleware()` is where it gets VERIFIED against
 * the real `RestaurantMember` table before a single byte is accepted. Trusting a
 * client-supplied restaurantId without this check would let anyone signed in upload an
 * image "for" a restaurant they have no relationship to.
 */
export const ourFileRouter = {
  menuItemImage: f({
    image: { maxFileSize: "4MB", maxFileCount: 1 },
  })
    .input(z.object({ restaurantId: z.cuid() }))
    .middleware(async ({ req, input }) => {
      // `req.headers` is passed explicitly rather than relying on `next/headers`'
      // ambient `headers()` — see the doc comment on `requireMember` for why: this
      // callback runs inside Uploadthing's Effect-based request handling, which does not
      // reliably preserve the AsyncLocalStorage context that `headers()` depends on.
      try {
        const { userId } = await requireRole(input.restaurantId, MANAGES_MENU, req.headers);
        // Whatever is returned here becomes `metadata` in onUploadComplete below, AND is
        // signed into the upload ticket the client polls — this is the tenant-scoping,
        // not just a log line.
        return { restaurantId: input.restaurantId, userId };
      } catch (error) {
        if (error instanceof AuthError) {
          throw new UploadThingError(
            error.status === 401
              ? "Sign in to upload images."
              : "You don't have permission to upload images for this restaurant.",
          );
        }
        throw error;
      }
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // Nothing to persist here: the client writes the returned URL into MenuItem.image
      // via the existing create/update route, which re-validates it through the
      // `imageUrl` schema in src/lib/validations/menu.ts (https + *.ufs.sh/*.utfs.io
      // only). Returning metadata just lets the client/server logs confirm who this
      // upload belonged to.
      return { restaurantId: metadata.restaurantId, uploadedBy: metadata.userId, key: file.key };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
