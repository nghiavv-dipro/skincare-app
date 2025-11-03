/**
 * Warehouse Order API Service
 * Tạo sale order (mã xuất kho) ở warehouse khi có order mới từ Shopify
 */

/**
 * Tạo sale order ở warehouse
 * @param {Object} shopifyOrder - Order data từ Shopify
 * @param {Object} admin - Shopify admin API client
 * @returns {Promise<{success: boolean, saleOrderId: string, outboundOrderIds: Array, error?: string}>}
 */
export async function createWarehouseSaleOrder(shopifyOrder, admin) {
  try {
    console.log(`[Warehouse Order API] Creating sale order for Shopify order #${shopifyOrder.name}`);

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    if (!process.env.WAREHOUSE_SHOP_ID) {
      throw new Error("WAREHOUSE_SHOP_ID not configured");
    }

    // Transform Shopify order to warehouse format
    const warehouseOrderData = await transformShopifyOrderToWarehouse(shopifyOrder, admin);

    // Call warehouse API
    const response = await fetch(`${process.env.WAREHOUSE_API_URL}/sale-orders`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
      },
      body: JSON.stringify(warehouseOrderData),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Log chi tiết lỗi API để debug
      console.error("[Warehouse Order API] ❌ Warehouse API error:", {
        status: response.status,
        statusText: response.statusText,
        shopifyOrder: shopifyOrder.name,
        responseBody: errorText,
      });

      // Parse error message nếu có
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.message) {
          console.error("[Warehouse Order API] API error message:", errorData.message);
        }
        if (errorData.errors) {
          console.error("[Warehouse Order API] API validation errors:", errorData.errors);
        }
      } catch (parseError) {
        console.error("[Warehouse Order API] Raw error:", errorText);
      }

      // Return generic error message
      return {
        success: false,
        error: "Không thể lấy mã vận chuyển, vui lòng thử lại",
      };
    }

    const data = await response.json();

    console.log(`[Warehouse Order API] ✅ Created sale order: ${data.id}`);

    return {
      success: true,
      saleOrderId: data.id,
      outboundOrderIds: data.outbound_orders?.map(o => o.id) || [],
      warehouseOrderData: data,
    };
  } catch (error) {
    console.error("[Warehouse Order API] ❌ Error creating sale order:", error);

    // Return generic error message
    return {
      success: false,
      error: "Không thể lấy mã vận chuyển, vui lòng thử lại",
    };
  }
}

/**
 * Transform Shopify order data sang format warehouse API
 * @param {Object} shopifyOrder - Shopify order webhook payload
 * @param {Object} admin - Shopify admin API client
 * @returns {Promise<Object>}
 */
async function transformShopifyOrderToWarehouse(shopifyOrder, admin) {
  // Get line items with SKU
  const items = [];

  for (const lineItem of shopifyOrder.line_items) {
    // Skip nếu không có SKU
    if (!lineItem.sku) {
      console.warn(`[Warehouse Order API] Line item ${lineItem.title} has no SKU, skipping`);
      continue;
    }

    items.push({
      sku: lineItem.sku,
      quantity: lineItem.quantity,
      price: parseFloat(lineItem.price) * 100, // Convert to cents if needed
      tax_rate: 0, // Can calculate from line_item.tax_lines if needed
    });
  }

  // Build shipping address
  const shippingAddress = shopifyOrder.shipping_address;
  const fullAddress = [
    shippingAddress.address1,
    shippingAddress.address2,
    shippingAddress.city,
    shippingAddress.province,
    shippingAddress.country,
  ].filter(Boolean).join(', ');

  const warehouseOrderData = {
    warehouse_id: parseInt(process.env.WAREHOUSE_ID || '7'), // Default to 7 (Narita - JP)
    shop_id: process.env.WAREHOUSE_SHOP_ID,
    currency_id: shopifyOrder.currency || 'VND',
    items: items,
    shippingAddress: {
      full_address: fullAddress,
      full_name: shippingAddress.name || shopifyOrder.customer?.first_name + ' ' + shopifyOrder.customer?.last_name,
      phone_number: shippingAddress.phone || shopifyOrder.customer?.phone || '',
      note: shopifyOrder.note || '',
      customer_pay: true, // Default: customer pays shipping
    },
  };

  return warehouseOrderData;
}

/**
 * Lấy delivery status từ carrier API
 * @param {string} trackingNumber - Tracking number từ carrier
 * @returns {Promise<{success: boolean, deliveryStatus: string, error?: string}>}
 */
export async function getDeliveryStatus(trackingNumber) {
  try {
    console.log(`[Carrier API] Getting delivery status for tracking number: ${trackingNumber}`);

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    // Call carrier API to get delivery status
    const response = await fetch(`${process.env.WAREHOUSE_API_URL}/sale-orders/${trackingNumber}`, {
      method: 'GET',
      headers: {
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Log chi tiết lỗi API để debug
      console.error("[Carrier API] ❌ Warehouse API error:", {
        status: response.status,
        statusText: response.statusText,
        trackingNumber: trackingNumber,
        responseBody: errorText,
      });

      // Parse error message nếu có
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.message) {
          console.error("[Carrier API] API error message:", errorData.message);
        }
      } catch (parseError) {
        console.error("[Carrier API] Raw error:", errorText);
      }

      // Return generic error message
      return {
        success: false,
        error: "Không thể lấy trạng thái vận đơn",
      };
    }

    const data = await response.json();

    console.log(`[Carrier API] ✅ Got delivery status: ${data.delivery_status}`);

    return {
      success: true,
      deliveryStatus: data.status_id,
    };
  } catch (error) {
    console.error("[Carrier API] ❌ Error getting delivery status:", error);

    // Return generic error message
    return {
      success: false,
      error: "Không thể lấy trạng thái vận đơn",
    };
  }
}

/**
 * Fetch Shopify order data using GraphQL
 * @param {Object} admin - Shopify admin API client
 * @param {string} shopifyOrderId - Shopify order ID (gid://shopify/Order/xxx format)
 * @returns {Promise<Object|null>}
 */
async function fetchShopifyOrder(admin, shopifyOrderId) {
  try {
    const response = await admin.graphql(
      `#graphql
        query getOrder($id: ID!) {
          order(id: $id) {
            id
            name
            note
            currencyCode
            customer {
              firstName
              lastName
              phone
            }
            shippingAddress {
              name
              address1
              address2
              city
              province
              country
              phone
            }
            lineItems(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                    }
                  }
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

    const data = await response.json();
    return data.data?.order || null;
  } catch (error) {
    console.error("[Warehouse Order API] Error fetching Shopify order:", error);
    return null;
  }
}

/**
 * Format Shopify order data to warehouse API format
 * @param {Object} shopifyOrder - Order data from Shopify GraphQL
 * @returns {Object}
 */
function formatOrderForWarehouse(shopifyOrder) {
  // Extract line items with SKU
  const items = [];

  for (const edge of shopifyOrder.lineItems.edges) {
    const lineItem = edge.node;

    // Skip if no SKU
    if (!lineItem.sku) {
      console.warn(`[Warehouse Order API] Line item ${lineItem.title} has no SKU, skipping`);
      continue;
    }

    items.push({
      sku: lineItem.sku,
      quantity: lineItem.quantity,
      price: parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount) * 100, // Convert to cents
      tax_rate: 0,
    });
  }

  // Build shipping address
  const shippingAddress = shopifyOrder.shippingAddress;
  const fullAddress = [
    shippingAddress.address1,
    shippingAddress.address2,
    shippingAddress.city,
    shippingAddress.province,
    shippingAddress.country,
  ].filter(Boolean).join(', ');

  return {
    warehouse_id: parseInt(process.env.WAREHOUSE_ID || '7'), // Default to 7 (Narita - JP)
    shop_id: process.env.WAREHOUSE_SHOP_ID,
    currency_id: 'VND',
    items: items,
    shippingAddress: {
      full_address: fullAddress,
      full_name: shippingAddress.name || `${shopifyOrder.customer?.firstName || ''} ${shopifyOrder.customer?.lastName || ''}`.trim(),
      phone_number: shippingAddress.phone || shopifyOrder.customer?.phone || '',
      note: shopifyOrder.note || '',
      customer_pay: true, // Default: customer pays shipping
    },
  };
}

/**
 * Lấy tracking number từ carrier API
 * @param {Object} admin - Shopify admin API client
 * @param {string} orderId - Shopify Order ID (numeric)
 * @returns {Promise<{success: boolean, trackingNumber: string,  deliveryStatus: string,, trackingUrl?: string, error?: string}>}
 */
export async function getTrackingNumber(admin, orderId) {
  try {
    console.log(`[Carrier API] Getting tracking number for order: ${orderId}`);

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    if (!process.env.WAREHOUSE_SHOP_ID) {
      throw new Error("WAREHOUSE_SHOP_ID not configured");
    }

    // Fetch order data from Shopify
    const shopifyOrderId = `gid://shopify/Order/${orderId}`;
    const shopifyOrder = await fetchShopifyOrder(admin, shopifyOrderId);

    if (!shopifyOrder) {
      throw new Error(`Order ${orderId} not found in Shopify`);
    }

    // Format order data to match warehouse API requirements
    const warehouseOrderData = formatOrderForWarehouse(shopifyOrder);
    console.log(`[Carrier API] Sending order data to warehouse API:`, JSON.stringify(warehouseOrderData, null, 2));

    // Call warehouse API to create sale order and get tracking number
    const response = await fetch(`${process.env.WAREHOUSE_API_URL}/sale-orders`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
      },
      body: JSON.stringify(warehouseOrderData),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Log chi tiết lỗi API để debug
      console.error("[Carrier API] ❌ Warehouse API error:", {
        status: response.status,
        statusText: response.statusText,
        responseBody: errorText,
      });

      // Parse error message nếu có
      let apiErrorMessage = "Không thể tạo mã vận chuyển";
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.message) {
          console.error("[Carrier API] API error message:", errorData.message);
        }
        if (errorData.errors) {
          console.error("[Carrier API] API validation errors:", errorData.errors);
        }
      } catch (parseError) {
        // Không parse được JSON, dùng raw text
        console.error("[Carrier API] Raw error:", errorText);
      }

      // Return generic error message (không expose API details)
      return {
        success: false,
        error: apiErrorMessage,
      };
    }

    const data = await response.json();

    console.log(`[Carrier API] ✅ Got tracking number: ${data.id}`);

    return {
      success: true,
      error: false,
      trackingNumber: data.id,
      deliveryStatus: data.status_id,
    };
  } catch (error) {
    console.error("[Carrier API] ❌ Error getting tracking number:", error);

    // Return generic error message
    return {
      success: false,
      error: "Không thể lấy mã vận đơn từ kho",
    };
  }
}

/**
 * Lưu thông tin warehouse order vào Shopify order metafields
 * @param {Object} admin - Shopify admin API client
 * @param {string} orderId - Shopify order ID (gid://shopify/Order/xxx)
 * @param {Object} warehouseData - Data từ warehouse API
 * @returns {Promise<boolean>}
 */
export async function saveWarehouseOrderToShopify(admin, orderId, warehouseData) {
  try {
    const response = await admin.graphql(
      `#graphql
        mutation updateOrderMetafield($input: OrderInput!) {
          orderUpdate(input: $input) {
            order {
              id
              metafields(first: 10) {
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
                key: "sale_order_id",
                value: warehouseData.saleOrderId,
                type: "single_line_text_field",
              }
            ],
          },
        },
      }
    );

    const data = await response.json();
    const errors = data.data?.orderUpdate?.userErrors;

    if (errors && errors.length > 0) {
      console.error("[Warehouse Order API] Error saving metafields:", errors);
      return false;
    }

    console.log(`[Warehouse Order API] Saved warehouse order info to Shopify order ${orderId}`);
    return true;
  } catch (error) {
    console.error("[Warehouse Order API] Error saving to Shopify:", error);
    return false;
  }
}

/**
 * Cập nhật metafields cho Shopify order
 * @param {Object} admin - Shopify admin API client
 * @param {string} orderId - Shopify order ID (gid://shopify/Order/xxx)
 * @param {Array} metafields - Array of metafield objects {key, value, type}
 * @returns {Promise<boolean>}
 */
export async function updateOrderMetafields(admin, orderId, metafields) {
  try {
    const response = await admin.graphql(
      `#graphql
        mutation updateOrderMetafield($input: OrderInput!) {
          orderUpdate(input: $input) {
            order {
              id
              metafields(first: 10) {
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
            metafields: metafields.map(field => ({
              namespace: "custom",
              key: field.key,
              value: field.value,
              type: field.type || "single_line_text_field",
            })),
          },
        },
      }
    );

    const data = await response.json();
    const errors = data.data?.orderUpdate?.userErrors;

    if (errors && errors.length > 0) {
      console.error("[Warehouse Order API] Error updating metafields:", errors);
      return false;
    }

    console.log(`[Warehouse Order API] Updated metafields for Shopify order ${orderId}`);
    return true;
  } catch (error) {
    console.error("[Warehouse Order API] Error updating metafields:", error);
    return false;
  }
}
