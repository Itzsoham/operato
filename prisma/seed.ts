/**
 * Operato demo seed — two restaurants, ~3 months of correlated trading.
 *
 * The point is NOT to fill tables. It is to make the analytics features have something
 * true to say: weekends and evenings are busy, a few dishes carry the menu, regulars
 * outspend walk-ins, and some stock is genuinely low while most is fine. Uniform random
 * noise produces a dashboard where every answer is "about the same", and a text-to-SQL
 * demo where "top items" is a coin flip.
 *
 * Idempotent: re-running deletes the two seed restaurants (FKs cascade) and their demo
 * users, then rebuilds. It never touches data it did not create.
 *
 * Deterministic: fixed-seed PRNGs, and — importantly — a SEPARATE stream per concern
 * per tenant. A single shared stream couples everything: skip one order because it
 * lands in the future and every subsequent draw re-phases, so the second restaurant's
 * entire dataset changes with the time of day you happened to run the seed.
 *
 * Set SEED_NOW (ISO date) to pin the clock and get byte-identical output across runs.
 *
 * Run: npm run db:seed
 */
import "./load-env"; // MUST be first — see load-env.ts

import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";

import { auth } from "../src/lib/auth";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  ItemStatus,
  MemberRole,
  OrderStatus,
  OrderType,
  TableStatus,
  TransactionType,
} from "../src/generated/prisma/enums";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// ── deterministic RNG ────────────────────────────────────────────────────────
// One independent stream per concern, so a draw skipped in one (e.g. an order that
// lands after `NOW`) cannot re-phase another.

type Rng = () => number;

function makeRng(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, min: number, max: number) => Math.floor(r() * (max - min + 1)) + min;
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chance = (r: Rng, p: number) => r() < p;

/** Weighted pick — the engine behind "a few dishes carry the menu". */
function weighted<T extends { weight: number }>(r: Rng, xs: readonly T[]): T {
  const total = xs.reduce((s, x) => s + x.weight, 0);
  let n = r() * total;
  for (const x of xs) if ((n -= x.weight) <= 0) return x;
  return xs[xs.length - 1];
}

const money = (n: number) => Math.round(n * 100) / 100;
const stock = (n: number) => Math.round(n * 1000) / 1000; // Decimal(10,3)

const DAYS = 90;

/** Pinnable clock. Without this the seed's output drifts with the time of day. */
const NOW = process.env.SEED_NOW ? new Date(process.env.SEED_NOW) : new Date();

// ── shape of a week ──────────────────────────────────────────────────────────

/** Fri/Sat/Sun carry a restaurant. Monday does not. Index 0 = Sunday. */
const DOW_MULTIPLIER = [1.2, 0.7, 0.78, 0.88, 1.05, 1.5, 1.6]; // Sun..Sat
const MEAN_DOW = DOW_MULTIPLIER.reduce((a, b) => a + b, 0) / 7;
const PEAK_DOW = Math.max(...DOW_MULTIPLIER);

// ── menus ────────────────────────────────────────────────────────────────────

type ItemSpec = { name: string; price: number; veg: boolean; weight: number; prep: number };
type CatSpec = { name: string; items: ItemSpec[] };

const SPICE_GARDEN: CatSpec[] = [
  {
    name: "Starters",
    items: [
      { name: "Paneer Tikka", price: 320, veg: true, weight: 9, prep: 15 },
      { name: "Chicken 65", price: 340, veg: false, weight: 8, prep: 15 },
      { name: "Veg Manchurian", price: 260, veg: true, weight: 5, prep: 12 },
      { name: "Papad Masala", price: 90, veg: true, weight: 4, prep: 5 },
    ],
  },
  {
    name: "Mains",
    items: [
      // The house dish. Every real restaurant has one, and it should dominate the mix.
      { name: "Butter Chicken", price: 480, veg: false, weight: 26, prep: 25 },
      { name: "Paneer Butter Masala", price: 420, veg: true, weight: 16, prep: 22 },
      { name: "Dal Makhani", price: 300, veg: true, weight: 11, prep: 20 },
      { name: "Rogan Josh", price: 520, veg: false, weight: 6, prep: 30 },
      { name: "Chana Masala", price: 280, veg: true, weight: 5, prep: 18 },
    ],
  },
  {
    name: "Breads & Rice",
    items: [
      { name: "Butter Naan", price: 70, veg: true, weight: 30, prep: 6 },
      { name: "Garlic Naan", price: 90, veg: true, weight: 18, prep: 6 },
      { name: "Jeera Rice", price: 180, veg: true, weight: 9, prep: 10 },
      { name: "Chicken Biryani", price: 420, veg: false, weight: 14, prep: 30 },
    ],
  },
  {
    name: "Desserts & Drinks",
    items: [
      { name: "Gulab Jamun", price: 120, veg: true, weight: 7, prep: 5 },
      { name: "Masala Chai", price: 60, veg: true, weight: 12, prep: 5 },
      { name: "Sweet Lassi", price: 110, veg: true, weight: 8, prep: 5 },
      { name: "Fresh Lime Soda", price: 90, veg: true, weight: 6, prep: 3 },
    ],
  },
];

const DAILY_GRIND: CatSpec[] = [
  {
    name: "Coffee",
    items: [
      { name: "Cappuccino", price: 180, veg: true, weight: 28, prep: 5 },
      { name: "Flat White", price: 190, veg: true, weight: 20, prep: 5 },
      { name: "Cold Brew", price: 220, veg: true, weight: 14, prep: 3 },
      { name: "Espresso", price: 120, veg: true, weight: 8, prep: 2 },
      { name: "Filter Coffee", price: 90, veg: true, weight: 11, prep: 4 },
    ],
  },
  {
    name: "Breakfast",
    items: [
      { name: "Avocado Toast", price: 320, veg: true, weight: 15, prep: 10 },
      { name: "Masala Omelette", price: 240, veg: false, weight: 12, prep: 10 },
      { name: "Pancake Stack", price: 280, veg: true, weight: 8, prep: 12 },
      { name: "Granola Bowl", price: 260, veg: true, weight: 6, prep: 5 },
    ],
  },
  {
    name: "Sandwiches",
    items: [
      { name: "Grilled Cheese", price: 220, veg: true, weight: 13, prep: 8 },
      { name: "Chicken Club", price: 340, veg: false, weight: 10, prep: 12 },
      { name: "Veg Panini", price: 260, veg: true, weight: 7, prep: 10 },
    ],
  },
  {
    name: "Bakery",
    items: [
      { name: "Butter Croissant", price: 150, veg: true, weight: 18, prep: 2 },
      { name: "Blueberry Muffin", price: 160, veg: true, weight: 9, prep: 2 },
      { name: "Chocolate Brownie", price: 180, veg: true, weight: 11, prep: 2 },
    ],
  },
];

// ── inventory ────────────────────────────────────────────────────────────────

/**
 * NOTE `coverDays` rather than a hand-written threshold. A reorder threshold is
 * meaningless in isolation — it only means anything relative to how fast the item
 * burns. Hand-writing "12 kg" for an item that gets through ~8 kg on an average day
 * (and 13.7 kg on a Saturday) describes a kitchen that reorders when it has less than
 * a day and a half of chicken left, and makes it arithmetically impossible to end the
 * quarter below threshold without also going negative. So: threshold = days of cover.
 */
type InvSpec = {
  name: string;
  unit: string;
  /** Reorder when stock drops below this many days of typical consumption. */
  coverDays: number;
  cost: number;
  supplier: string;
  /** Units consumed per order, roughly. Drives believable depletion. */
  burn: number;
  /** Under-order this one late in the quarter so "what to reorder" has a real answer. */
  runsLow?: boolean;
};

const SPICE_INVENTORY: InvSpec[] = [
  { name: "Chicken (boneless)", unit: "kg", coverDays: 3, cost: 280, supplier: "Al-Noor Meats", burn: 0.22, runsLow: true },
  { name: "Paneer", unit: "kg", coverDays: 3, cost: 340, supplier: "Gokul Dairy", burn: 0.14 },
  { name: "Basmati Rice", unit: "kg", coverDays: 10, cost: 110, supplier: "Sharma Wholesale", burn: 0.18 },
  { name: "Atta (flour)", unit: "kg", coverDays: 10, cost: 45, supplier: "Sharma Wholesale", burn: 0.25 },
  { name: "Butter", unit: "kg", coverDays: 4, cost: 520, supplier: "Gokul Dairy", burn: 0.09, runsLow: true },
  { name: "Tomatoes", unit: "kg", coverDays: 2, cost: 40, supplier: "Azadpur Mandi", burn: 0.3 },
  { name: "Cream", unit: "litres", coverDays: 4, cost: 220, supplier: "Gokul Dairy", burn: 0.07 },
  { name: "Cooking Oil", unit: "litres", coverDays: 12, cost: 140, supplier: "Sharma Wholesale", burn: 0.11 },
];

const GRIND_INVENTORY: InvSpec[] = [
  { name: "Coffee Beans (Arabica)", unit: "kg", coverDays: 12, cost: 900, supplier: "Blue Tokai", burn: 0.02, runsLow: true },
  { name: "Whole Milk", unit: "litres", coverDays: 3, cost: 60, supplier: "Amul Distributor", burn: 0.18 },
  { name: "Sourdough Loaf", unit: "pieces", coverDays: 2, cost: 120, supplier: "Baker's Dozen", burn: 0.15 },
  { name: "Avocado", unit: "pieces", coverDays: 3, cost: 90, supplier: "Fresh Farms", burn: 0.12, runsLow: true },
  { name: "Eggs", unit: "pieces", coverDays: 5, cost: 7, supplier: "Fresh Farms", burn: 0.4 },
  { name: "Butter", unit: "kg", coverDays: 6, cost: 520, supplier: "Amul Distributor", burn: 0.05 },
];

const FIRST = ["Aarav", "Diya", "Rohan", "Ananya", "Kabir", "Meera", "Arjun", "Isha", "Vikram", "Nisha", "Karan", "Priya", "Rahul", "Sneha", "Aditya", "Riya"];
const LAST = ["Sharma", "Iyer", "Nair", "Patel", "Reddy", "Khan", "Bose", "Menon", "Gupta", "Singh", "Rao", "Desai"];

const TENANTS = [
  {
    slug: "spice-garden",
    name: "Spice Garden",
    owner: { email: "owner@spicegarden.test", name: "Ravi Menon" },
    manager: { email: "manager@spicegarden.test", name: "Fatima Sheikh" },
    menu: SPICE_GARDEN,
    inventory: SPICE_INVENTORY,
    tables: 12,
    /** Orders on an average day. Spice Garden is the busy one. */
    baseVolume: 34,
    customerCount: 200,
  },
  {
    slug: "the-daily-grind",
    name: "The Daily Grind",
    owner: { email: "owner@dailygrind.test", name: "Tara Bose" },
    manager: null,
    menu: DAILY_GRIND,
    inventory: GRIND_INVENTORY,
    tables: 8,
    baseVolume: 21,
    customerCount: 120,
  },
] as const;

const DEMO_PASSWORD = "operato-demo-1234";

/**
 * How often an order is attributed to a known customer, and how much of that is the
 * loyal core. Tuned so a "regular" comes in ~weekly and a casual ~monthly. Crank the
 * link rate or shrink the pool and you get customers with 100+ visits in 90 days,
 * which is nonsense and makes "top customers" meaningless.
 */
const CUSTOMER_LINK_RATE = 0.42; // the rest are walk-ins who leave no number
const REGULAR_SHARE = 0.3; // of the customer pool
const REGULAR_ORDER_SHARE = 0.62; // of attributed orders
/** Most customers predate the 90-day window; the rest sign up during it, so
 *  "new customers this month" is a real number rather than 0 or everyone. */
const PRE_EXISTING_SHARE = 0.72;

/** A cafe peaks at breakfast; a dinner place peaks at night. */
function hourFor(r: Rng, slug: string): number {
  if (slug === "the-daily-grind") {
    const n = r();
    if (n < 0.45) return int(r, 8, 11); // breakfast rush
    if (n < 0.75) return int(r, 12, 15); // lunch
    return int(r, 16, 19);
  }
  const n = r();
  if (n < 0.35) return int(r, 12, 15); // lunch
  if (n < 0.92) return int(r, 19, 22); // dinner — the bulk
  return int(r, 16, 18);
}

/** Line items inherit the fate of their order — a CANCELLED order has no SERVED lines. */
function itemStatusFor(orderStatus: OrderStatus): ItemStatus {
  switch (orderStatus) {
    case OrderStatus.PAID:
    case OrderStatus.SERVED:
      return ItemStatus.SERVED;
    case OrderStatus.READY:
      return ItemStatus.READY;
    case OrderStatus.PREPARING:
      return ItemStatus.PREPARING;
    default:
      return ItemStatus.PENDING; // PENDING, CONFIRMED, CANCELLED
  }
}

async function main() {
  console.log(`Seeding Operato demo data (clock: ${NOW.toISOString()})…\n`);

  // ── clean: only what this seed owns ────────────────────────────────────────
  const slugs = TENANTS.map((t) => t.slug);
  const emails = TENANTS.flatMap((t) => [t.owner.email, ...(t.manager ? [t.manager.email] : [])]);
  await prisma.restaurant.deleteMany({ where: { slug: { in: [...slugs] } } }); // cascades
  await prisma.user.deleteMany({ where: { email: { in: emails } } }); // cascades session/account

  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  for (const t of TENANTS) {
    // Independent streams: an order skipped for landing in the future cannot re-phase
    // the inventory simulation, and tenant A cannot re-phase tenant B.
    const rMenu = makeRng(`${t.slug}:menu`);
    const rCust = makeRng(`${t.slug}:customers`);
    const rOrder = makeRng(`${t.slug}:orders`);
    const rInv = makeRng(`${t.slug}:inventory`);

    // ── users. Created through Better Auth so the demo logins ACTUALLY WORK —
    // hand-inserting `user` rows would leave no credential in `account`, and the
    // password hash format is Better Auth's business, not ours.
    const people = [t.owner, ...(t.manager ? [t.manager] : [])];
    const userIds: string[] = [];
    for (const p of people) {
      await auth.api.signUpEmail({
        body: { email: p.email, password: DEMO_PASSWORD, name: p.name },
      });
      const u = await prisma.user.findUniqueOrThrow({ where: { email: p.email } });
      userIds.push(u.id);
      bump("user");
    }

    const restaurant = await prisma.restaurant.create({
      data: {
        name: t.name,
        slug: t.slug,
        members: {
          create: userIds.map((userId, i) => ({
            userId,
            role: i === 0 ? MemberRole.OWNER : MemberRole.MANAGER,
          })),
        },
      },
    });
    const rid = restaurant.id;
    bump("restaurant");
    bump("restaurantMember", userIds.length);

    // ── menu ────────────────────────────────────────────────────────────────
    type LiveItem = ItemSpec & { id: string; isAvailable: boolean };
    const liveItems: LiveItem[] = [];
    for (const [ci, cat] of t.menu.entries()) {
      const category = await prisma.menuCategory.create({
        data: { restaurantId: rid, name: cat.name, sortOrder: ci },
      });
      bump("menuCategory");
      for (const [ii, item] of cat.items.entries()) {
        // a couple of items are off the menu, so "isAvailable" isn't a dead column
        const isAvailable = !chance(rMenu, 0.06);
        const created = await prisma.menuItem.create({
          data: {
            restaurantId: rid,
            categoryId: category.id, // composite FK: same tenant, enforced by the DB
            name: item.name,
            price: item.price,
            isVeg: item.veg,
            preparationTime: item.prep,
            sortOrder: ii,
            isAvailable,
          },
        });
        liveItems.push({ ...item, id: created.id, isAvailable });
        bump("menuItem");
      }
    }

    // You cannot sell what is off the menu — so unavailable items must not appear in
    // order history either, or "top items" will cite a dish the kitchen isn't making.
    const sellable = liveItems.filter((i) => i.isAvailable);

    // ── tables ──────────────────────────────────────────────────────────────
    await prisma.restaurantTable.createMany({
      data: Array.from({ length: t.tables }, (_, i) => ({
        restaurantId: rid,
        number: i + 1,
        capacity: pick(rMenu, [2, 2, 4, 4, 4, 6, 8]),
        label: i === 0 ? "Window" : i === t.tables - 1 ? "Corner Booth" : null,
        status: TableStatus.AVAILABLE,
      })),
    });
    const tables = await prisma.restaurantTable.findMany({
      where: { restaurantId: rid },
      select: { id: true },
    });
    bump("restaurantTable", tables.length);

    // ── customers ───────────────────────────────────────────────────────────
    // ALWAYS with a phone: the schema's [restaurantId, phone] unique does NOT stop
    // NULL duplicates (NULLs are distinct in Postgres), so the rule is enforced here —
    // an anonymous order simply carries customerId = null.
    //
    // Each gets a joinedAt. Most predate the window; some sign up during it. An order
    // is only ever attributed to a customer who had already joined by then, so nobody
    // has orders older than their own signup.
    const windowStart = new Date(NOW);
    windowStart.setDate(windowStart.getDate() - DAYS);

    const usedPhones = new Set<string>();
    const customers = Array.from({ length: t.customerCount }, (_, i) => {
      let phone: string;
      do {
        phone = `+9198${int(rCust, 10000000, 99999999)}`;
      } while (usedPhones.has(phone));
      usedPhones.add(phone);

      const name = `${pick(rCust, FIRST)} ${pick(rCust, LAST)}`;
      const isRegular = i < Math.floor(t.customerCount * REGULAR_SHARE);

      // Pre-existing customers joined before the window; the rest during it.
      const joinedAt = new Date(windowStart);
      if (chance(rCust, PRE_EXISTING_SHARE)) {
        joinedAt.setDate(joinedAt.getDate() - int(rCust, 1, 200));
      } else {
        joinedAt.setDate(joinedAt.getDate() + int(rCust, 0, DAYS - 1));
      }

      return {
        id: randomUUID(),
        restaurantId: rid,
        name,
        phone,
        email: chance(rCust, 0.45) ? `${name.toLowerCase().replace(/\s+/g, ".")}${i}@example.com` : null,
        // the tag must mean something — derive it from the cohort, not a coin flip
        tags: isRegular ? ["regular"] : [],
        createdAt: joinedAt,
        isRegular,
      };
    });

    // `isRegular` is a seeding concept, not a column — insert only the real fields.
    await prisma.customer.createMany({
      data: customers.map((c) => ({
        id: c.id,
        restaurantId: c.restaurantId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        tags: c.tags,
        createdAt: c.createdAt,
      })),
    });
    bump("customer", customers.length);

    const regulars = customers.filter((c) => c.isRegular);
    const casuals = customers.filter((c) => !c.isRegular);

    // ── orders ──────────────────────────────────────────────────────────────
    type OrderRow = {
      id: string; restaurantId: string; orderNumber: string; tableId: string | null;
      customerId: string | null; status: OrderStatus; type: OrderType;
      subtotal: number; tax: number; discount: number; totalAmount: number;
      servedAt: Date | null; paidAt: Date | null; createdAt: Date; updatedAt: Date;
    };
    const orders: OrderRow[] = [];
    const orderItems: {
      id: string; orderId: string; restaurantId: string; menuItemId: string;
      quantity: number; unitPrice: number; totalPrice: number; status: ItemStatus; createdAt: Date;
    }[] = [];

    let seq = 0;
    let itemsSoldTotal = 0;

    for (let d = DAYS; d >= 0; d--) {
      const day = new Date(NOW);
      day.setDate(day.getDate() - d);
      day.setHours(0, 0, 0, 0);
      const dow = day.getDay();

      // Only customers who had signed up by this day can be on this day's orders.
      const eligibleRegulars = regulars.filter((c) => c.createdAt <= day);
      const eligibleCasuals = casuals.filter((c) => c.createdAt <= day);

      // volume = base × day-of-week shape × noise, with a gentle growth trend over the
      // quarter so "this month vs last" is a real comparison rather than a flat line.
      const growth = 1 + ((DAYS - d) / DAYS) * 0.22;
      const volume = Math.max(
        3,
        Math.round(t.baseVolume * DOW_MULTIPLIER[dow] * growth * (0.85 + rOrder() * 0.3)),
      );

      for (let o = 0; o < volume; o++) {
        const createdAt = new Date(day);
        createdAt.setHours(hourFor(rOrder, t.slug), int(rOrder, 0, 59), int(rOrder, 0, 59), 0);
        if (createdAt > NOW) continue; // no orders from the future

        const isToday = d === 0;
        const type = chance(rOrder, 0.62)
          ? OrderType.DINE_IN
          : chance(rOrder, 0.72)
            ? OrderType.TAKEAWAY
            : OrderType.DELIVERY;

        // Regulars return; walk-ins mostly don't leave a number at all.
        let customerId: string | null = null;
        if (chance(rOrder, CUSTOMER_LINK_RATE)) {
          const wantRegular = chance(rOrder, REGULAR_ORDER_SHARE);
          const pool = wantRegular ? eligibleRegulars : eligibleCasuals;
          if (pool.length) customerId = pick(rOrder, pool).id;
        }

        // Decide the order's fate BEFORE building its lines, so the lines can inherit
        // it. Today's orders are mid-flight; history is settled.
        const status: OrderStatus = isToday
          ? pick(rOrder, [
              OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING,
              OrderStatus.READY, OrderStatus.SERVED, OrderStatus.PAID, OrderStatus.PAID,
            ])
          : chance(rOrder, 0.955)
            ? OrderStatus.PAID
            : OrderStatus.CANCELLED;
        const lineStatus = itemStatusFor(status);

        // 1–5 lines, the popular items appearing far more often
        const lineCount = weighted(rOrder, [
          { n: 1, weight: 14 }, { n: 2, weight: 30 }, { n: 3, weight: 28 },
          { n: 4, weight: 18 }, { n: 5, weight: 10 },
        ] as const).n;

        const chosen = new Map<string, { item: LiveItem; qty: number }>();
        for (let l = 0; l < lineCount; l++) {
          const item = weighted(rOrder, sellable);
          const qty = int(rOrder, 1, item.price < 150 ? 3 : 2); // cheap things go in twos and threes
          const existing = chosen.get(item.id);
          if (existing) existing.qty += qty;
          else chosen.set(item.id, { item, qty });
        }

        const orderId = randomUUID();
        let subtotal = 0;
        for (const { item, qty } of chosen.values()) {
          const total = money(item.price * qty);
          subtotal += total;
          orderItems.push({
            id: randomUUID(),
            orderId,
            restaurantId: rid, // composite FK forces this to equal the order's — by design
            menuItemId: item.id,
            quantity: qty,
            unitPrice: item.price,
            totalPrice: total,
            status: lineStatus,
            createdAt,
          });
          if (status !== OrderStatus.CANCELLED) itemsSoldTotal += qty;
        }
        subtotal = money(subtotal);

        const discount = chance(rOrder, 0.12) ? money(subtotal * pick(rOrder, [0.05, 0.1, 0.15])) : 0;
        const tax = money((subtotal - discount) * 0.05); // 5% GST
        const totalAmount = money(subtotal - discount + tax);

        const servedAt =
          status === OrderStatus.PAID || status === OrderStatus.SERVED
            ? new Date(createdAt.getTime() + int(rOrder, 15, 55) * 60_000)
            : null;
        const paidAt =
          status === OrderStatus.PAID
            ? new Date(createdAt.getTime() + int(rOrder, 30, 90) * 60_000)
            : null;

        orders.push({
          id: orderId,
          restaurantId: rid,
          orderNumber: `ORD-${String(++seq).padStart(4, "0")}`,
          tableId: type === OrderType.DINE_IN ? pick(rOrder, tables).id : null,
          customerId,
          status,
          type,
          subtotal,
          tax,
          discount,
          totalAmount,
          servedAt,
          paidAt,
          createdAt,
          updatedAt: paidAt ?? servedAt ?? createdAt,
        });
      }
    }

    // Bulk insert. Orders first — OrderItem's composite FK points at them.
    for (let i = 0; i < orders.length; i += 500) {
      await prisma.order.createMany({ data: orders.slice(i, i + 500) });
    }
    bump("order", orders.length);

    // Hand the order-number counter forward past everything the seed just wrote.
    // Leave it at 0 and the first REAL order minted by the app is ORD-0001 all over
    // again — straight into the @@unique([restaurantId, orderNumber]) and a failed sale.
    await prisma.restaurant.update({
      where: { id: rid },
      data: { orderSeq: seq },
    });
    for (let i = 0; i < orderItems.length; i += 1000) {
      await prisma.orderItem.createMany({ data: orderItems.slice(i, i + 1000) });
    }
    bump("orderItem", orderItems.length);

    // ── customer rollups: DERIVED from paid orders, never invented ───────────
    // CANCELLED orders are excluded — a cancelled meal is not spend, and counting it
    // would inflate exactly the "top customers" figure the CRM exists to report.
    const roll = new Map<string, { spend: number; visits: number; last: Date }>();
    for (const o of orders) {
      if (o.status !== OrderStatus.PAID || !o.customerId) continue;
      const r = roll.get(o.customerId) ?? { spend: 0, visits: 0, last: o.createdAt };
      r.spend = money(r.spend + o.totalAmount);
      r.visits += 1;
      if (o.createdAt > r.last) r.last = o.createdAt;
      roll.set(o.customerId, r);
    }
    for (const [customerId, r] of roll) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { totalSpend: r.spend, visitCount: r.visits, lastVisitAt: r.last },
      });
    }

    // ── inventory ───────────────────────────────────────────────────────────
    for (const spec of t.inventory) {
      // Everything is sized off the burn rate, not off a hand-picked number.
      const dailyBurn = t.baseVolume * MEAN_DOW * spec.burn;
      const peakDailyBurn = t.baseVolume * PEAK_DOW * spec.burn * 1.15; // worst Saturday
      const threshold = stock(dailyBurn * spec.coverDays);

      // Healthy items are topped up to ~a week and a half of cover.
      const target = stock(threshold + dailyBurn * 10);

      // A `runsLow` item trades normally, then gets under-ordered over the LAST FOUR
      // WEEKS — demand outran the standing order. That taper is the point: it leaves a
      // genuine downward trend and ends BELOW the reorder line, so "what should I
      // reorder?" has a real answer. Restock everything to full and the answer is
      // "nothing"; starve everything and it is "everything". Neither is a demo.
      //
      // The floor sits above one peak day's draw, so a working kitchen is never asked
      // to serve stock it does not physically have.
      const TAPER_DAYS = 28;
      const lateTarget = stock(Math.max(threshold * 0.7, peakDailyBurn * 1.6));
      const lateEvery = 21;
      const floorOf = (late: boolean) =>
        late ? peakDailyBurn * 1.1 : Math.max(threshold * 1.05, peakDailyBurn * 1.2);

      let balance = stock(target);

      const item = await prisma.inventoryItem.create({
        data: {
          restaurantId: rid,
          name: spec.name,
          unit: spec.unit,
          currentStock: balance,
          lowStockThreshold: threshold,
          costPerUnit: spec.cost,
          supplier: spec.supplier,
        },
      });
      bump("inventoryItem");

      const txns: {
        id: string; inventoryItemId: string; restaurantId: string; type: TransactionType;
        quantity: number; balanceAfter: number; notes: string | null; createdAt: Date;
      }[] = [];

      /**
       * Applies a movement and records it.
       *
       * A withdrawal is capped at what is ON HAND, and the CAPPED amount is what gets
       * recorded. Clamping the resulting balance instead (`Math.max(0, balance - qty)`)
       * while still writing the full `qty` is what breaks an audit trail: the row then
       * claims "took 12.9 from a stock of 9", and balanceAfter[n] no longer equals
       * balanceAfter[n-1] ± quantity. The ledger has to be able to prove itself.
       */
      const push = (type: TransactionType, qty: number, at: Date, notes: string) => {
        const inbound = type === TransactionType.STOCK_IN;
        const applied = stock(inbound ? qty : Math.min(qty, balance));
        if (applied <= 0) return;
        balance = stock(balance + (inbound ? applied : -applied));
        txns.push({
          id: randomUUID(),
          inventoryItemId: item.id,
          restaurantId: rid, // composite FK pins this to the parent item's tenant
          type,
          quantity: applied,
          balanceAfter: balance,
          notes,
          createdAt: at,
        });
      };

      // Opening stock is a real, dated movement — otherwise the ledger starts from a
      // number that no transaction accounts for, and SUM(in) - SUM(out) never equals
      // currentStock.
      const opening = new Date(NOW);
      opening.setDate(opening.getDate() - DAYS - 1);
      opening.setHours(8, 0, 0, 0);
      balance = 0;
      push(TransactionType.STOCK_IN, target, opening, "Opening stock");

      for (let d = DAYS; d >= 0; d--) {
        const day = new Date(NOW);
        day.setDate(day.getDate() - d);
        const dow = day.getDay();
        const dayOrders = Math.round(t.baseVolume * DOW_MULTIPLIER[dow]);

        const late = spec.runsLow === true && d <= TAPER_DAYS;
        const effTarget = late ? lateTarget : target;
        const effEvery = late ? lateEvery : 7;

        const at = (h: number, m: number) => {
          const x = new Date(day);
          x.setHours(h, m, 0, 0);
          return x;
        };

        // Deliveries land in the MORNING, before the day's service — which is also the
        // order the ledger must read in when sorted by createdAt.
        if (d % effEvery === 0 && d !== 0 && balance < effTarget) {
          const t0 = at(8, int(rInv, 0, 45));
          if (t0 <= NOW) push(TransactionType.STOCK_IN, effTarget - balance, t0, `Delivery — ${spec.supplier}`);
        }

        // A kitchen about to run dry buys more — BEFORE service, not after it.
        if (balance < floorOf(late)) {
          const t1 = at(9, int(rInv, 0, 30));
          if (t1 <= NOW) push(TransactionType.STOCK_IN, effTarget - balance, t1, "Emergency top-up");
        }

        const used = stock(dayOrders * spec.burn * (0.85 + rInv() * 0.3));
        const t2 = at(23, 30);
        if (t2 <= NOW) push(TransactionType.STOCK_OUT, used, t2, "Consumed by service");

        if (chance(rInv, 0.04)) {
          const t3 = at(23, 45);
          if (t3 <= NOW) push(TransactionType.WASTE, stock(used * 0.15), t3, "Spoilage");
        }
      }

      for (let i = 0; i < txns.length; i += 1000) {
        await prisma.inventoryTransaction.createMany({ data: txns.slice(i, i + 1000) });
      }
      bump("inventoryTransaction", txns.length);

      // currentStock IS the last balanceAfter. Derive it — if these two ever disagree,
      // the audit trail is lying.
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: { currentStock: balance },
      });
    }

    const revenue = orders
      .filter((o) => o.status === OrderStatus.PAID)
      .reduce((s, o) => s + o.totalAmount, 0);
    console.log(
      `  ${t.name.padEnd(18)} ${orders.length} orders · ₹${Math.round(revenue).toLocaleString("en-IN")} revenue · ${itemsSoldTotal} items sold`,
    );
  }

  console.log("\nRow counts:");
  for (const [table, n] of Object.entries(counts).sort()) {
    console.log(`  ${table.padEnd(22)} ${n}`);
  }
  console.log(`\nDemo logins (password: ${DEMO_PASSWORD})`);
  for (const t of TENANTS) console.log(`  ${t.owner.email}`);
  console.log();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
