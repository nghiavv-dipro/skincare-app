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

    // Check if USE_MOCK_WAREHOUSE_API is enabled
    const useMock = process.env.USE_MOCK_WAREHOUSE_API === 'true';

    if (useMock) {
      console.log("[Warehouse Order API] Using mock mode - simulating sale order creation");
      return createMockSaleOrder(shopifyOrder);
    }

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
      throw new Error(`Warehouse API returned ${response.status}: ${errorText}`);
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
    console.error("[Warehouse Order API] Error creating sale order:", error);
    return {
      success: false,
      error: error.message,
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
 * Mock function for testing without calling real API
 * @param {Object} shopifyOrder
 * @returns {Object}
 */
function createMockSaleOrder(shopifyOrder) {
  const mockSaleOrderId = `OR00700${String(Date.now()).slice(-6)}`;
  const mockOutboundOrderId1 = `OBS0090${String(Date.now()).slice(-6)}`;
  const mockOutboundOrderId2 = `OBT0070${String(Date.now()).slice(-6)}`;

  console.log(`[Mock Warehouse Order API] Created mock sale order: ${mockSaleOrderId}`);

  return {
    success: true,
    saleOrderId: mockSaleOrderId,
    outboundOrderIds: [mockOutboundOrderId1, mockOutboundOrderId2],
    warehouseOrderData: {
      id: mockSaleOrderId,
      shop_order_id: shopifyOrder.id,
      status_id: "order-confirmed",
      outbound_orders: [
        { id: mockOutboundOrderId1 },
        { id: mockOutboundOrderId2 },
      ],
    },
  };
}

/**
 * Lấy delivery status từ carrier API
 * @param {string} trackingNumber - Tracking number từ carrier
 * @returns {Promise<{success: boolean, deliveryStatus: string, error?: string}>}
 */
export async function getDeliveryStatus(trackingNumber) {
  try {
    console.log(`[Carrier API] Getting delivery status for tracking number: ${trackingNumber}`);

    // Check if USE_MOCK_WAREHOUSE_API is enabled
    const useMock = process.env.USE_MOCK_WAREHOUSE_API === 'true';

    if (useMock) {
      console.log("[Carrier API] Using mock mode - simulating delivery status fetch");
      return getMockDeliveryStatus(trackingNumber);
    }

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    // Call carrier API to get delivery status
    const response = await fetch(`${process.env.WAREHOUSE_API_URL}/tracking/${trackingNumber}/status`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Carrier API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    console.log(`[Carrier API] ✅ Got delivery status: ${data.delivery_status}`);

    return {
      success: true,
      deliveryStatus: data.delivery_status,
      statusDetails: data.status_details,
    };
  } catch (error) {
    console.error("[Carrier API] Error getting delivery status:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Mock function for getting delivery status
 * @param {string} trackingNumber
 * @returns {Object}
 */
function getMockDeliveryStatus(trackingNumber) {
  const mockStatuses = ['pending', 'processing', 'shipped', 'in_transit', 'delivered'];
  const randomStatus = mockStatuses[Math.floor(Math.random() * mockStatuses.length)];

  console.log(`[Mock Carrier API] Mock delivery status for ${trackingNumber}: ${randomStatus}`);

  return {
    success: true,
    deliveryStatus: randomStatus,
    statusDetails: {
      updated_at: new Date().toISOString(),
      location: randomStatus === 'delivered' ? 'Destination' : 'In transit',
    },
  };
}

/**
 * Lấy tracking number từ carrier API
 * @param {string} orderId - Shopify Order ID
 * @returns {Promise<{success: boolean, trackingNumber: string, trackingUrl?: string, error?: string}>}
 */
export async function getTrackingNumber(orderId) {
  try {
    console.log(`[Carrier API] Getting tracking number for order: ${orderId}`);

    // Check if USE_MOCK_WAREHOUSE_API is enabled
    const useMock = process.env.USE_MOCK_WAREHOUSE_API === 'true';

    if (useMock) {
      console.log("[Carrier API] Using mock mode - simulating tracking number fetch");
      return getMockTrackingNumber(orderId);
    }

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    // Call carrier API to get tracking number for this order
    const response = await fetch(`${process.env.WAREHOUSE_API_URL}/orders/${orderId}/tracking`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Carrier API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    console.log(`[Carrier API] ✅ Got tracking number: ${data.tracking_number}`);

    return {
      success: true,
      trackingNumber: data.tracking_number,
      trackingUrl: data.tracking_url,
      carrier: data.carrier,
    };
  } catch (error) {
    console.error("[Carrier API] Error getting tracking number:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Mock function for getting tracking number
 * @param {string} orderId
 * @returns {Object}
 */
function getMockTrackingNumber(orderId) {
  const mockTrackingNumber = `TRK${String(Date.now()).slice(-10)}`;
  const mockCarriers = ['DHL', 'FedEx', 'UPS', 'USPS', 'EMS'];
  const randomCarrier = mockCarriers[Math.floor(Math.random() * mockCarriers.length)];

  console.log(`[Mock Carrier API] Mock tracking number for order ${orderId}: ${mockTrackingNumber}`);

  return {
    success: true,
    trackingNumber: mockTrackingNumber,
    trackingUrl: `https://tracking.example.com/${mockTrackingNumber}`,
    carrier: randomCarrier,
  };
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
