import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getTrackingNumber, updateOrderMetafields } from "../services/warehouseOrderApi.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Authenticate the webhook
    const { topic, shop, admin, payload } = await authenticate.webhook(request);

    console.log(`[API Webhook] Received ${topic} webhook from ${shop}`);
    console.log('Order Payload: ');
    console.log(payload);

    if (!admin) {
      console.error(`[API Webhook] ❌ Admin client not available`);
      return json({
        success: false,
        error: "Authentication failed - admin client not available",
      }, { status: 500 });
    }

    const orderId = payload.id?.toString();
    console.log(`[API Webhook] Processing order #${payload.name} (ID: ${orderId})`);

    // Get tracking number from carrier API
    console.log(`[API Webhook] Getting tracking number from carrier...`);
    const trackingResult = await getTrackingNumber(admin, orderId);

    if (trackingResult.success) {
      console.log(`[API Webhook] ✅ Tracking number received: ${trackingResult.trackingNumber}`);

      // Save tracking info to Shopify order metafields
      const shopifyOrderId = `gid://shopify/Order/${orderId}`;
      const saved = await updateOrderMetafields(admin, shopifyOrderId, [
        {
          key: "sale_order_id",
          value: trackingResult.trackingNumber,
        },
        {
          key: "delivery_status",
          value: trackingResult.deliveryStatus,
        },
      ]);

      if (saved) {
        console.log(`[API Webhook] ✅ Saved tracking info to Shopify order metafield`);
      } else {
        console.warn(`[API Webhook] ⚠️ Failed to save tracking info to Shopify`);
      }

      return json({
        success: true,
        message: "Order processed successfully",
        trackingNumber: trackingResult.trackingNumber,
      });
    } else {
      const errorMessage = (trackingResult as any).error || "Unknown error";
      console.error(`[API Webhook] ❌ Failed to get tracking number: ${errorMessage}`);

      return json({
        success: false,
        error: errorMessage,
        message: "Tracking number fetch failed",
      }, { status: 500 });
    }
  } catch (error) {
    console.error("[API Webhook] Fatal error:", error);
    return json({ error: (error as any).message }, { status: 500 });
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
    url: request.url
  });
};
