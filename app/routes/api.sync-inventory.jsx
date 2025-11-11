import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { syncInventoryToShopify } from "../services/inventorySync.server";

/**
 * API endpoint để đồng bộ inventory
 * POST /api/sync-inventory
 *
 * Sử dụng:
 * - Manual trigger từ admin UI
 * - External cron service
 * - Testing
 */
export const action = async ({ request }) => {
  // Chỉ cho phép POST request
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Authenticate với Shopify
    const { admin, session } = await authenticate.admin(request);

    console.log(`[API Sync] Starting inventory sync for shop: ${session.shop}`);

    // Chạy sync (đã bao gồm logging trong service)
    const result = await syncInventoryToShopify(admin);

    return json({
      success: result.success,
      shop: session.shop,
      timestamp: new Date().toISOString(),
      summary: result.summary,
      results: result.results,
      errors: result.errors,
      // Legacy format for backward compatibility
      status: result.success ? "success" : "failed",
      totalItems: result.summary.total,
      updatedItems: result.summary.success,
      failedItems: result.summary.failed,
      skippedItems: result.summary.skipped,
    });
  } catch (error) {
    console.error("[API Sync] Error:", error);

    return json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
};

/**
 * GET request để xem thông tin về sync endpoint
 */
export const loader = async ({ request }) => {
  return json({
    endpoint: "/api/sync-inventory",
    method: "POST",
    description: "Đồng bộ inventory từ warehouse API lên Shopify",
    authentication: "Requires Shopify session",
    usage: {
      manual: "Call from admin UI button",
      cron: "Setup external cron to POST to this endpoint every hour",
    },
    example_cron_services: [
      "cron-job.org",
      "EasyCron",
      "Cronitor",
      "GitHub Actions (scheduled workflows)",
    ],
  });
};
