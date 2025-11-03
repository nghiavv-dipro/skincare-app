import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";

/**
 * Webhook endpoint for warehouse to update delivery status
 *
 * Warehouse sends POST request with:
 * {
 *   "event": "updated" | "created",
 *   "event_at": "2025-10-24 10:38:08",
 *   "subject": {
 *     "id": "OR00100005255",
 *     "status_id": "order-confirmed",
 *     "payment_status_id": "voided"
 *   },
 *   "changes": {
 *     "attributes": {
 *       "status_id": "packaging"
 *     },
 *     "old": {
 *       "status_id": "order-confirmed"
 *     }
 *   }
 * }
 */

export async function action({ request }) {
  try {
    console.log("[Warehouse Status Webhook] Received status update from warehouse");

    // ============================================
    // Security: Verify Authorization Bearer Token
    // ============================================
    const authHeader = request.headers.get("Authorization");
    const expectedToken = process.env.WAREHOUSE_WEBHOOK_TOKEN;

    if (!expectedToken) {
      console.error("[Warehouse Status Webhook] WAREHOUSE_WEBHOOK_TOKEN not configured");
      return json({ error: "Server configuration error" }, { status: 500 });
    }

    if (!authHeader) {
      console.error("[Warehouse Status Webhook] Missing Authorization header");
      return json({ error: "Unauthorized - Missing Authorization header" }, { status: 401 });
    }

    // Expected format: "Bearer Token <token>"
    const tokenMatch = authHeader.match(/^Bearer Token (.+)$/);
    if (!tokenMatch) {
      console.error("[Warehouse Status Webhook] Invalid Authorization header format");
      return json({ error: "Unauthorized - Invalid Authorization format" }, { status: 401 });
    }

    const receivedToken = tokenMatch[1];
    if (receivedToken !== expectedToken) {
      console.error("[Warehouse Status Webhook] Invalid token");
      return json({ error: "Unauthorized - Invalid token" }, { status: 401 });
    }

    console.log("[Warehouse Status Webhook] ✅ Authorization verified");

    // Parse webhook payload
    const payload = await request.json();
    console.log("[Warehouse Status Webhook] Payload:", JSON.stringify(payload, null, 2));

    // Validate payload
    if (!payload.subject?.id) {
      console.error("[Warehouse Status Webhook] Missing subject.id in payload");
      return json({ error: "Missing sale_order_id in payload" }, { status: 400 });
    }

    if (!payload.changes?.attributes?.status_id) {
      console.error("[Warehouse Status Webhook] Missing changes.attributes.status_id in payload");
      return json({ error: "Missing status_id in payload" }, { status: 400 });
    }

    const saleOrderId = payload.subject.id;
    const newStatus = payload.changes.attributes.status_id;

    console.log(`[Warehouse Status Webhook] Processing: sale_order_id=${saleOrderId}, new_status=${newStatus}`);

    // Get shop from database (assuming we have at least one session)
    // In a multi-shop app, you might need to track which shop owns which sale_order_id
    const sessionRecord = await prisma.session.findFirst({
      where: {
        isOnline: false,
      },
      orderBy: {
        id: 'desc',
      },
    });

    if (!sessionRecord) {
      console.error("[Warehouse Status Webhook] No active shop session found");
      return json({ error: "No active shop session" }, { status: 500 });
    }

    const shop = sessionRecord.shop;
    console.log(`[Warehouse Status Webhook] Using shop: ${shop}`);

    // Get admin API client for the shop using unauthenticated access
    const { admin } = await unauthenticated.admin(shop);

    // Find the Shopify order that has this sale_order_id in metafields
    const shopifyOrderId = await findOrderBySaleOrderId(admin, saleOrderId);

    if (!shopifyOrderId) {
      console.warn(`[Warehouse Status Webhook] ⚠️ No Shopify order found with sale_order_id: ${saleOrderId}`);
      return json({
        success: false,
        error: "Order not found",
        message: `No order found with sale_order_id: ${saleOrderId}`
      }, { status: 404 });
    }

    console.log(`[Warehouse Status Webhook] Found Shopify order: ${shopifyOrderId}`);

    // Update delivery_status metafield on the order
    const updated = await updateOrderDeliveryStatus(admin, shopifyOrderId, newStatus);

    if (updated) {
      console.log(`[Warehouse Status Webhook] ✅ Updated delivery status to "${newStatus}" for order ${shopifyOrderId}`);
      return json({
        success: true,
        message: "Delivery status updated successfully",
        orderId: shopifyOrderId,
        newStatus: newStatus,
      });
    } else {
      console.error(`[Warehouse Status Webhook] ❌ Failed to update delivery status for order ${shopifyOrderId}`);
      return json({
        success: false,
        error: "Failed to update delivery status",
      }, { status: 500 });
    }
  } catch (error) {
    console.error("[Warehouse Status Webhook] Fatal error:", error);
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

/**
 * Find Shopify order ID by sale_order_id metafield
 * @param {Object} admin - Shopify admin API client
 * @param {string} saleOrderId - The warehouse sale order ID (e.g., "OR00100005255")
 * @returns {Promise<string|null>} - Shopify order GID or null if not found
 */
async function findOrderBySaleOrderId(admin, saleOrderId) {
  try {
    // Search for orders with matching sale_order_id metafield
    const response = await admin.graphql(
      `#graphql
        query findOrderBySaleOrderId($query: String!) {
          orders(first: 10, query: $query) {
            edges {
              node {
                id
                name
                metafields(first: 10, namespace: "custom") {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
              }
            }
          }
        }`,
      {
        variables: {
          query: `metafield.custom.sale_order_id:${saleOrderId}`,
        },
      }
    );

    const data = await response.json();
    console.log("[Warehouse Status Webhook] Search response:", JSON.stringify(data, null, 2));

    const orders = data.data?.orders?.edges;

    if (!orders || orders.length === 0) {
      console.log(`[Warehouse Status Webhook] No orders found with sale_order_id: ${saleOrderId}`);
      return null;
    }

    // Verify that the found order actually has the matching sale_order_id
    for (const orderEdge of orders) {
      const order = orderEdge.node;
      const metafields = order.metafields?.edges || [];

      console.log(`[Warehouse Status Webhook] Checking order ${order.name} (${order.id})`);
      console.log(`[Warehouse Status Webhook] Metafields:`, JSON.stringify(metafields, null, 2));

      // Find the sale_order_id metafield
      const saleOrderIdMetafield = metafields.find(
        (mf) => mf.node.key === "sale_order_id"
      );

      if (saleOrderIdMetafield) {
        const foundSaleOrderId = saleOrderIdMetafield.node.value;
        console.log(`[Warehouse Status Webhook] Order ${order.name} has sale_order_id: ${foundSaleOrderId}`);

        // Verify exact match
        if (foundSaleOrderId === saleOrderId) {
          console.log(`[Warehouse Status Webhook] ✅ MATCH! Found order ${order.name} (${order.id})`);
          return order.id;
        } else {
          console.log(`[Warehouse Status Webhook] ❌ MISMATCH! Expected ${saleOrderId}, got ${foundSaleOrderId}`);
        }
      } else {
        console.log(`[Warehouse Status Webhook] Order ${order.name} has no sale_order_id metafield`);
      }
    }

    console.log(`[Warehouse Status Webhook] No exact match found for sale_order_id: ${saleOrderId}`);
    return null;
  } catch (error) {
    console.error("[Warehouse Status Webhook] Error finding order:", error);
    return null;
  }
}

/**
 * Update delivery_status metafield on Shopify order
 * @param {Object} admin - Shopify admin API client
 * @param {string} orderId - Shopify order GID (gid://shopify/Order/xxx)
 * @param {string} deliveryStatus - New delivery status from warehouse
 * @returns {Promise<boolean>}
 */
async function updateOrderDeliveryStatus(admin, orderId, deliveryStatus) {
  try {
    const response = await admin.graphql(
      `#graphql
        mutation updateOrderDeliveryStatus($input: OrderInput!) {
          orderUpdate(input: $input) {
            order {
              id
              metafields(first: 10, namespace: "custom") {
                edges {
                  node {
                    namespace
                    key
                    value
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          input: {
            id: orderId,
            metafields: [
              {
                namespace: "custom",
                key: "delivery_status",
                value: deliveryStatus,
                type: "single_line_text_field",
              },
            ],
          },
        },
      }
    );

    const data = await response.json();

    // Log full response for debugging
    console.log("[Warehouse Status Webhook] GraphQL Response:", JSON.stringify(data, null, 2));

    const errors = data.data?.orderUpdate?.userErrors;

    if (errors && errors.length > 0) {
      console.error("[Warehouse Status Webhook] Error updating metafield:", JSON.stringify(errors, null, 2));
      return false;
    }

    // Check if order was actually updated
    if (!data.data?.orderUpdate?.order) {
      console.error("[Warehouse Status Webhook] Order update returned no data");
      return false;
    }

    console.log(`[Warehouse Status Webhook] Successfully updated delivery_status metafield for order ${orderId}`);
    console.log("[Warehouse Status Webhook] Updated metafields:", JSON.stringify(data.data.orderUpdate.order.metafields, null, 2));
    return true;
  } catch (error) {
    console.error("[Warehouse Status Webhook] Error updating order:", error);
    return false;
  }
}

export function loader() {
  throw new Response(null, { status: 404 });
}
