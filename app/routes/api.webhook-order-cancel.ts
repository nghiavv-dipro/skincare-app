import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { cancelSaleOrder, updateOrderMetafields } from "../services/warehouseOrderApi.server";
import { unauthenticated } from "../shopify.server.js";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = `webhook_cancel_${Date.now()}`;
  const timestamp = new Date().toISOString();

  console.log(`🚫 [${webhookId}] ===== ORDER CANCELLED WEBHOOK ===== ${timestamp}`);

  try {
    // Parse webhook payload
    const body = await request.text();
    const payload = JSON.parse(body);

    console.log(`🚫 [${webhookId}] Order cancelled: ${payload.name} (#${payload.id})`);
    console.log(`📦 [${webhookId}] Webhook payload:`, JSON.stringify(payload, null, 2));

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
      console.error(`❌ [${webhookId}] No active shop session found`);
      return json({
        success: false,
        error: "No active shop session found"
      }, { status: 404 });
    }

    // Check if webhook sync is enabled for this shop
    if (session.enableWebhookSync === false) {
      console.log(`⏭️ [${webhookId}] Webhook sync is disabled for shop: ${session.shop}. Skipping...`);
      return json({
        success: true,
        skipped: true,
        message: "Webhook sync is disabled for this shop",
        webhookId: webhookId,
        timestamp: timestamp,
      });
    }

    console.log(`✅ [${webhookId}] Webhook sync enabled. Processing order cancellation...`);

    const shop = session.shop;
    // Get admin API client
    const { admin } = await unauthenticated.admin(shop);

    const orderId = payload.id; // Numeric order ID
    // Construct GraphQL ID from numeric ID if admin_graphql_api_id is not provided
    const shopifyOrderId = payload.admin_graphql_api_id || `gid://shopify/Order/${orderId}`;

    // Get sale_order_id from order metafields
    console.log(`🔍 [${webhookId}] Fetching metafields for order: ${shopifyOrderId} (Order #${orderId})`);

    const metafieldsResponse = await admin.graphql(
      `#graphql
        query getOrderMetafields($id: ID!) {
          order(id: $id) {
            id
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }`,
      {
        variables: {
          id: shopifyOrderId,
        },
      }
    );

    const metafieldsData = await metafieldsResponse.json();
    const metafields: Record<string, string> = {};
    metafieldsData.data?.order?.metafields?.edges?.forEach((edge: any) => {
      metafields[edge.node.key] = edge.node.value;
    });

    const saleOrderId = metafields.sale_order_id;

    if (!saleOrderId) {
      console.warn(`⚠️ [${webhookId}] No sale_order_id found for order ${orderId}. Order may not have been synced to warehouse yet.`);
      return json({
        success: true,
        skipped: true,
        message: "No sale_order_id found, order not synced to warehouse",
        webhookId: webhookId,
        timestamp: timestamp,
      });
    }

    console.log(`✅ [${webhookId}] Found sale_order_id: ${saleOrderId}`);

    // Call warehouse API to cancel the sale order
    console.log(`🚫 [${webhookId}] Calling cancelSaleOrder for sale_order_id: ${saleOrderId}`);
    const result = await cancelSaleOrder(saleOrderId);

    if (!result.success) {
      console.error(`❌ [${webhookId}] Failed to cancel sale order:`, result.error);
      return json({
        success: false,
        error: result.error,
      }, { status: 500 });
    }

    console.log(`✅ [${webhookId}] Successfully cancelled sale order: ${saleOrderId}`);

    // Update delivery_status metafield with the cancelled status
    if (result.data?.status_id) {
      console.log(`📝 [${webhookId}] Updating delivery_status to: ${result.data.status_id}`);

      const updated = await updateOrderMetafields(admin, shopifyOrderId, [
        {
          key: "delivery_status",
          value: result.data.status_id,
          type: "single_line_text_field",
        }
      ]);

      if (updated) {
        console.log(`✅ [${webhookId}] Updated delivery_status to "${result.data.status_id}"`);
      } else {
        console.warn(`⚠️ [${webhookId}] Failed to update delivery_status metafield`);
      }
    }

    return json({
      success: true,
      message: "Order cancelled successfully",
      saleOrderId: saleOrderId,
      deliveryStatus: result.data?.status_id,
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
  const testId = `webhook_cancel_get_test_${Date.now()}`;
  console.log(`[API Webhook Cancel] GET request to webhook endpoint`);

  return json({
    success: true,
    message: "Webhook cancel endpoint is accessible via GET",
    timestamp: new Date().toISOString(),
    testId: testId,
    url: request.url,
  });
};
