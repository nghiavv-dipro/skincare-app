import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getTrackingNumber, updateOrderMetafields } from "../services/warehouseOrderApi.server";

export async function action({ request }) {
  try {
    // Authenticate the webhook
    const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

    console.log(`[Webhook] Received ${topic} webhook from ${shop}`);

    // Validate it's an orders/create webhook
    if (topic !== "ORDERS_CREATE") {
      return json({ error: "Invalid webhook topic" }, { status: 400 });
    }

    const orderId = payload.id?.toString();
    console.log(`[Webhook] Processing order #${payload.name} (ID: ${orderId})`);

    // Get tracking number from carrier API
    console.log(`[Webhook] Getting tracking number from carrier...`);
    const trackingResult = await getTrackingNumber(admin, orderId);

    if (trackingResult.success) {
      console.log(`[Webhook] ✅ Tracking number received: ${trackingResult.trackingNumber}`);

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
        console.log(`[Webhook] ✅ Saved tracking info to Shopify order metafield`);
      } else {
        console.warn(`[Webhook] ⚠️ Failed to save tracking info to Shopify`);
      }

      return json({
        success: true,
        message: "Order processed successfully",
        trackingNumber: trackingResult.trackingNumber,
      });
    } else {
      console.error(`[Webhook] ❌ Failed to get tracking number: ${trackingResult.error}`);

      return json({
        success: false,
        error: trackingResult.error,
        message: "Tracking number fetch failed",
      }, { status: 500 });
    }
  } catch (error) {
    console.error("[Webhook] Fatal error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}

export function loader() {
  throw new Response(null, { status: 404 });
}