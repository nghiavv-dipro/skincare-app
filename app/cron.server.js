/**
 * Cron Jobs Setup
 * Scheduled tasks for the Shopify app
 */

import cron from "node-cron";
import { syncInventoryToShopify } from "./services/shopifyInventorySync.server.js";
import { unauthenticated } from "./shopify.server.js";
import prisma from "./db.server";

// Track if cron jobs are running
let cronJobsStarted = false;

/**
 * Initialize and start all cron jobs
 */
export function startCronJobs() {
  // Prevent multiple initializations
  if (cronJobsStarted) {
    console.log("[Cron] Cron jobs already started");
    return;
  }

  // Check if inventory sync is enabled
  const inventorySyncEnabled = process.env.ENABLE_INVENTORY_SYNC !== "false";

  if (!inventorySyncEnabled) {
    console.log("[Cron] ⚠️ Inventory sync is disabled (set ENABLE_INVENTORY_SYNC=true to enable)");
    return;
  }

  console.log("[Cron] Starting cron jobs...");

  // ============================================
  // Inventory Sync - Runs every hour at minute 0
  // ============================================
  // Cron format: minute hour day month weekday
  // "0 * * * *" = At minute 0 of every hour
  cron.schedule("0 * * * *", async () => {
    console.log(`[Cron] Triggered hourly inventory sync at ${new Date().toISOString()}`);

    try {
      // Get the first available shop session
      const session = await prisma.session.findFirst({
        where: {
          isOnline: false,
        },
        orderBy: {
          id: "desc",
        },
      });

      if (!session) {
        console.error("[Cron] ❌ No active shop session found");
        return;
      }

      const shop = session.shop;
      console.log(`[Cron] Running inventory sync for shop: ${shop}`);

      // Get admin API client
      const { admin } = await unauthenticated.admin(shop);

      // Run inventory sync
      const result = await syncInventoryToShopify(admin);

      console.log(`[Cron] ✅ Inventory sync completed:`, {
        status: result.status,
        updated: result.updatedItems,
        failed: result.failedItems,
        skipped: result.skippedItems,
      });
    } catch (error) {
      console.error("[Cron] ❌ Error running inventory sync:", error);
    }
  });

  console.log("[Cron] ✅ Cron jobs started successfully");
  console.log("[Cron] - Inventory Sync: Every hour at minute 0");

  cronJobsStarted = true;
}

/**
 * Manual trigger for inventory sync (for testing)
 * @param {string} shop - Shop domain
 * @returns {Promise<Object>}
 */
export async function triggerInventorySyncManually(shop) {
  try {
    console.log(`[Manual Sync] Starting inventory sync for shop: ${shop}`);

    const { admin } = await unauthenticated.admin(shop);
    const result = await syncInventoryToShopify(admin);

    console.log(`[Manual Sync] Completed:`, result);
    return result;
  } catch (error) {
    console.error("[Manual Sync] Error:", error);
    return {
      status: "failed",
      error: error.message,
    };
  }
}
