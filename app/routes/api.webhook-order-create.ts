import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { PrismaClient } from "@prisma/client";
import { unauthenticated } from "../shopify.server";
import { getTrackingNumber, updateOrderMetafields } from "../services/warehouseOrderApi.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = require("../db.server").default as any;
const prisma = db as PrismaClient;

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = `webhook_${Date.now()}`;
  const timestamp = new Date().toISOString();

  console.log(`📦 [${webhookId}] ===== ORDER CREATED WEBHOOK ===== ${timestamp}`);

  try {
    // Parse webhook payload
    const body = await request.text();
    const payload = JSON.parse(body);

    console.log(`📦 [${webhookId}] Order received: ${payload.name} (#${payload.id})`);

    // Get shop from database (assuming we have at least one session)
    const sessionRecord = await prisma.session.findFirst({
      where: {
        isOnline: false,
      },
      orderBy: {
        id: 'desc',
      },
    });

    if (!sessionRecord) {
      console.error(`❌ [${webhookId}] No active shop session found`);
      return json({ error: "No active shop session" }, { status: 500 });
    }

    const shop = sessionRecord.shop;
    console.log(`📦 [${webhookId}] Using shop: ${shop}`);

    // Get admin API client for the shop using unauthenticated access
    const { admin } = await unauthenticated.admin(shop);

    const orderId = payload.id; // Numeric order ID
    const shopifyOrderId = payload.admin_graphql_api_id; // gid://shopify/Order/xxx

    // Get tracking number from warehouse API (same logic as button)
    console.log(`📦 [${webhookId}] Calling getTrackingNumber for order: ${orderId}`);
    const result = await getTrackingNumber(admin, orderId);

    if (!result.success) {
      console.error(`❌ [${webhookId}] Failed to get tracking number:`, result.error);
      return json({
        success: false,
      }, { status: 500 });
    }

    console.log(`✅ [${webhookId}] Tracking number: ${result.trackingNumber}, Status: ${result.deliveryStatus}`);

    // Update order metafields with tracking info
    console.log(`📦 [${webhookId}] Updating metafields for order: ${shopifyOrderId}`);
    const updated = await updateOrderMetafields(admin, shopifyOrderId, [
      {
        key: "sale_order_id",
        value: result.trackingNumber,
      },
      {
        key: "delivery_status",
        value: result.deliveryStatus,
      },
    ]);

    if (!updated) {
      console.error(`❌ [${webhookId}] Failed to update metafields`);
      return json({
        success: false,
        error: "Failed to update order metafields"
      }, { status: 500 });
    }

    console.log(`✅ [${webhookId}] Order metafields updated successfully`);

    return json({
      success: true,
      message: "Order processed successfully",
      trackingNumber: result.trackingNumber,
      deliveryStatus: result.deliveryStatus,
      webhookId: webhookId,
      timestamp: timestamp,
    });

  } catch (error) {
    console.error(`❌ [${webhookId}] Error:`, error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const testId = `webhook_get_test_${Date.now()}`;
  console.log(`[API Webhook] GET request to webhook endpoint`);

  return json({
    success: true,
    message: "Webhook endpoint is accessible via GET",
    timestamp: new Date().toISOString(),
    testId: testId,
    url: request.url,
  });
};
