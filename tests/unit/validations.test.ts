import { describe, expect, it } from "vitest";

import {
  createMenuItemSchema,
  updateMenuItemSchema,
} from "../../src/lib/validations/menu";

/**
 * These tests exist because of a bug that shipped and was caught in review, not because
 * the code looks risky. Read the reasoning before deleting any of them.
 */

describe("updateMenuItemSchema — a PATCH must only ever contain what was sent", () => {
  /**
   * THE BUG. In Zod 4, `.partial()` does NOT strip `.default()` — it yields
   * ZodOptional<ZodDefault<…>>, and the default still fires for a missing key. With
   * `isVeg: z.boolean().default(false)` on the base, a PATCH of only `{ isAvailable }`
   * parsed to `{ isAvailable, isVeg: false }` — so toggling the availability switch on
   * a paneer dish silently rewrote it to NON-VEGETARIAN.
   *
   * The optimistic UI merge doesn't touch isVeg, so the green dot stayed green until a
   * refetch: invisible at the moment of corruption.
   *
   * Every module after this one has a boolean or enum status field with a default. This
   * is the guard that stops the same mistake being copied four times.
   */
  it("does not resurrect defaults for keys that were not sent", () => {
    expect(Object.keys(updateMenuItemSchema.parse({ name: "Paneer Tikka" }))).toEqual([
      "name",
    ]);

    expect(updateMenuItemSchema.parse({ isAvailable: false })).toEqual({
      isAvailable: false,
    });

    // The one that actually corrupted data: availability alone must not touch isVeg.
    expect(updateMenuItemSchema.parse({ isAvailable: false })).not.toHaveProperty("isVeg");

    expect(updateMenuItemSchema.parse({})).toEqual({});
  });

  it("still lets a caller set the flags explicitly", () => {
    expect(updateMenuItemSchema.parse({ isVeg: true })).toEqual({ isVeg: true });
  });

  it("keeps categoryId tri-state: absent, null, or an id", () => {
    // absent = leave alone; null = uncategorise; id = move. The route branches on
    // `=== undefined`, so these three must stay distinguishable.
    expect(updateMenuItemSchema.parse({})).not.toHaveProperty("categoryId");
    expect(updateMenuItemSchema.parse({ categoryId: null })).toEqual({ categoryId: null });
  });
});

describe("createMenuItemSchema — defaults belong here, and only here", () => {
  it("applies defaults on create", () => {
    const parsed = createMenuItemSchema.parse({ name: "Dal Makhani", price: 300 });
    expect(parsed.isAvailable).toBe(true);
    expect(parsed.isVeg).toBe(false);
  });

  it("rejects money that Decimal(10,2) cannot hold", () => {
    expect(createMenuItemSchema.safeParse({ name: "x", price: -1 }).success).toBe(false);
    expect(createMenuItemSchema.safeParse({ name: "x", price: 480.005 }).success).toBe(false);
    expect(createMenuItemSchema.safeParse({ name: "x", price: 1e12 }).success).toBe(false);
    expect(createMenuItemSchema.safeParse({ name: "x", price: Number.NaN }).success).toBe(false);
    expect(createMenuItemSchema.safeParse({ name: "x", price: 99_999_999.99 }).success).toBe(true);
  });

  it("refuses non-https image URLs", () => {
    // A bare z.url() accepts every one of these. Stored today, rendered tomorrow.
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
      "https://evil.example.com/x.png", // https, but not our uploader
    ]) {
      expect(
        createMenuItemSchema.safeParse({ name: "x", price: 1, image: bad }).success,
        `should reject ${bad}`,
      ).toBe(false);
    }

    expect(
      createMenuItemSchema.safeParse({
        name: "x",
        price: 1,
        image: "https://abc.ufs.sh/f/photo.png",
      }).success,
    ).toBe(true);
  });

  it("strips unknown keys, so a body cannot smuggle restaurantId", () => {
    const parsed = createMenuItemSchema.parse({
      name: "x",
      price: 1,
      restaurantId: "some-other-tenant", // attacker-supplied
    } as never);
    expect(parsed).not.toHaveProperty("restaurantId");
  });
});
