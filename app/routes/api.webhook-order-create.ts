import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = `webhook_${Date.now()}`;
  const timestamp = new Date().toISOString();

  console.log(
    `📦 [${webhookId}] ===== ORDER CREATED WEBHOOK ===== ${timestamp}`,
  );

  try {
    // Parse webhook payload
    const body = await request.text();
    const orderPayload = JSON.parse(body);
    console.log(`📦 [${webhookId}] orderPayload:`, JSON.stringify(orderPayload, null, 2));

    console.log(
      `📦 [${webhookId}] Order received: ${orderPayload.name} (#${orderPayload.id})`,
    );

    // Format data for warehouse API
    // Use shipping_address, fallback to billing_address or customer.default_address
    const shippingAddress =
      orderPayload.shipping_address ||
      orderPayload.billing_address ||
      orderPayload.customer?.default_address;

    if (!shippingAddress) {
      console.error(`❌ [${webhookId}] No shipping/billing address found`);
      return json({
        success: false,
        error: "No shipping or billing address found for this order"
      }, { status: 400 });
    }

    const fullAddress = [
      shippingAddress.address1,
      shippingAddress.address2,
      shippingAddress.city,
      shippingAddress.province,
      shippingAddress.country,
    ]
      .filter(Boolean)
      .join(", ");

    const items = orderPayload.line_items
      .map((item: { sku: any; quantity: any; price: string }) => ({
        sku: item.sku,
        quantity: item.quantity,
        price: parseFloat(item.price),
        tax_rate: 0,
      }))
      .filter((item: { sku: any }) => item.sku); // Only items with SKU

    if (items.length === 0) {
      console.error(`❌ [${webhookId}] No items with SKU found`);
      return json({
        success: false,
        error: "No items with SKU found in this order"
      }, { status: 400 });
    }

    const warehouseOrderData = {
      warehouse_id: parseInt(process.env.WAREHOUSE_ID || "7"),
      shop_id: process.env.WAREHOUSE_SHOP_ID,
      currency_id: orderPayload.currency || "VND",
      items: items,
      shippingAddress: {
        full_address: fullAddress,
        full_name: shippingAddress.name || "",
        phone_number: shippingAddress.phone || orderPayload.phone || "",
        note: orderPayload.note || "",
        customer_pay: true,
      },
    };

    console.log(`📦 [${webhookId}] Calling warehouse API...`);
    console.log(`📦 [${webhookId}] Request body:`, JSON.stringify(warehouseOrderData, null, 2));

    // Call warehouse API
    const headers: HeadersInit = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (process.env.WAREHOUSE_WEBHOOK_TOKEN) {
      headers.Authorization = `Bearer ${process.env.WAREHOUSE_WEBHOOK_TOKEN}`;
    }

    const response = await fetch(
      `${process.env.WAREHOUSE_API_URL}/sale-orders`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(warehouseOrderData),
      },
    );
    console.log(`📦 [${webhookId}] response`);
    console.log(response);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [${webhookId}] Warehouse API error:`, errorText);
      return json(
        {
          success: false,
          error: "Failed to create warehouse order",
        },
        { status: 500 },
      );
    }

    const warehouseResult = await response.json();
    const trackingNumber = warehouseResult.id;
    const deliveryStatus = warehouseResult.status_id;

    console.log(
      `✅ [${webhookId}] Tracking number: ${trackingNumber}, Status: ${deliveryStatus}`,
    );

    // Update order metafields
    const { admin } = await authenticate.admin(request);
    const orderId = orderPayload.admin_graphql_api_id;

    const metafieldResponse = await admin.graphql(
      `#graphql
        mutation updateOrderMetafield($input: OrderInput!) {
          orderUpdate(input: $input) {
            order {
              id
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
                key: "sale_order_id",
                value: String(trackingNumber),
                type: "single_line_text_field",
              },
              {
                namespace: "custom",
                key: "delivery_status",
                value: String(deliveryStatus),
                type: "single_line_text_field",
              },
            ],
          },
        },
      },
    );

    const metafieldData = await metafieldResponse.json();
    const errors = metafieldData.data?.orderUpdate?.userErrors;

    if (errors && errors.length > 0) {
      console.error(`❌ [${webhookId}] Metafield update errors:`, errors);
      return json(
        {
          success: false,
          error: "Failed to update metafields",
        },
        { status: 500 },
      );
    }

    console.log(`✅ [${webhookId}] Order metafields updated successfully`);

    return json({
      success: true,
      message: "Order processed successfully",
      trackingNumber: trackingNumber,
      deliveryStatus: deliveryStatus,
      webhookId: webhookId,
      timestamp: timestamp,
    });
  } catch (error) {
    console.error(`❌ [${webhookId}] Error:`, error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
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
