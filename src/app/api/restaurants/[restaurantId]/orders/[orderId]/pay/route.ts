import { MemberRole } from "@/generated/prisma/enums";
import { ok } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { OrderError, payOrder } from "@/lib/orders/service";

type Params = { orderId: string };

/**
 * Must EXCEED the transaction ceiling (12s) in src/lib/orders/service.ts. If the platform
 * kills the function first, the transaction is abandoned holding the Order and Customer
 * row locks, and every other till waits on a session that will never commit.
 */
export const maxDuration = 30;

/**
 * Settle a bill. The ONE place an order becomes PAID, so there is exactly one place that
 * moves money into the customer's lifetime spend.
 *
 * A cashier can take payment — that is the job. The row locking that makes it safe under
 * two simultaneous tills is in src/lib/orders/service.ts.
 */
export const POST = withTenant<Params>(
  async (_req, { restaurantId, params }) => {
    try {
      const order = await payOrder(restaurantId, params.orderId);
      return ok(order);
    } catch (error) {
      if (error instanceof OrderError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  },
  { roles: [MemberRole.OWNER, MemberRole.MANAGER, MemberRole.STAFF] },
);
