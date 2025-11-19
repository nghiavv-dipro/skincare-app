/**
 * Warehouse Order API Service
 * Tạo sale order (mã xuất kho) ở warehouse khi có order mới từ Shopify
 */

/**
 * Helper function to remove Vietnamese diacritics
 * Chuyển đổi tiếng Việt có dấu sang không dấu để tránh lỗi khi gọi API vận chuyển
 * @param {string} str - String cần chuyển đổi
 * @returns {string}
 */
function removeVietnameseDiacritics(str) {
  if (!str) return '';

  const diacriticsMap = {
    'à': 'a', 'á': 'a', 'ạ': 'a', 'ả': 'a', 'ã': 'a',
    'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ậ': 'a', 'ẩ': 'a', 'ẫ': 'a',
    'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ặ': 'a', 'ẳ': 'a', 'ẵ': 'a',
    'è': 'e', 'é': 'e', 'ẹ': 'e', 'ẻ': 'e', 'ẽ': 'e',
    'ê': 'e', 'ề': 'e', 'ế': 'e', 'ệ': 'e', 'ể': 'e', 'ễ': 'e',
    'ì': 'i', 'í': 'i', 'ị': 'i', 'ỉ': 'i', 'ĩ': 'i',
    'ò': 'o', 'ó': 'o', 'ọ': 'o', 'ỏ': 'o', 'õ': 'o',
    'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ộ': 'o', 'ổ': 'o', 'ỗ': 'o',
    'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ợ': 'o', 'ở': 'o', 'ỡ': 'o',
    'ù': 'u', 'ú': 'u', 'ụ': 'u', 'ủ': 'u', 'ũ': 'u',
    'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ự': 'u', 'ử': 'u', 'ữ': 'u',
    'ỳ': 'y', 'ý': 'y', 'ỵ': 'y', 'ỷ': 'y', 'ỹ': 'y',
    'đ': 'd',
    'À': 'A', 'Á': 'A', 'Ạ': 'A', 'Ả': 'A', 'Ã': 'A',
    'Â': 'A', 'Ầ': 'A', 'Ấ': 'A', 'Ậ': 'A', 'Ẩ': 'A', 'Ẫ': 'A',
    'Ă': 'A', 'Ằ': 'A', 'Ắ': 'A', 'Ặ': 'A', 'Ẳ': 'A', 'Ẵ': 'A',
    'È': 'E', 'É': 'E', 'Ẹ': 'E', 'Ẻ': 'E', 'Ẽ': 'E',
    'Ê': 'E', 'Ề': 'E', 'Ế': 'E', 'Ệ': 'E', 'Ể': 'E', 'Ễ': 'E',
    'Ì': 'I', 'Í': 'I', 'Ị': 'I', 'Ỉ': 'I', 'Ĩ': 'I',
    'Ò': 'O', 'Ó': 'O', 'Ọ': 'O', 'Ỏ': 'O', 'Õ': 'O',
    'Ô': 'O', 'Ồ': 'O', 'Ố': 'O', 'Ộ': 'O', 'Ổ': 'O', 'Ỗ': 'O',
    'Ơ': 'O', 'Ờ': 'O', 'Ớ': 'O', 'Ợ': 'O', 'Ở': 'O', 'Ỡ': 'O',
    'Ù': 'U', 'Ú': 'U', 'Ụ': 'U', 'Ủ': 'U', 'Ũ': 'U',
    'Ư': 'U', 'Ừ': 'U', 'Ứ': 'U', 'Ự': 'U', 'Ử': 'U', 'Ữ': 'U',
    'Ỳ': 'Y', 'Ý': 'Y', 'Ỵ': 'Y', 'Ỷ': 'Y', 'Ỹ': 'Y',
    'Đ': 'D',
  };

  return str.split('').map(char => diacriticsMap[char] || char).join('');
}

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
      price: parseFloat(lineItem.price), // Price in VND
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
      full_address: removeVietnameseDiacritics(fullAddress), // Remove diacritics to avoid carrier API errors
      full_name: shippingAddress.name?.trim() || `${shopifyOrder.customer?.first_name || ''} ${shopifyOrder.customer?.last_name || ''}`.trim() || '',
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
    console.log(`[Carrier API] 🔍 Getting delivery status for tracking number: ${trackingNumber}`);

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      console.error("[Carrier API] ❌ WAREHOUSE_API_URL not configured");
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    // Call carrier API to get delivery status
    console.log(`[Carrier API] 🌐 Calling warehouse API: GET ${process.env.WAREHOUSE_API_URL}/sale-orders/${trackingNumber}`);

    const response = await fetch(`${process.env.WAREHOUSE_API_URL}/sale-orders/${trackingNumber}`, {
      method: 'GET',
      headers: {
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
      },
    });

    console.log(`[Carrier API] 📥 Response status: ${response.status} ${response.statusText}`);

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
          console.error("[Carrier API] 📝 API error message:", errorData.message);
        }
      } catch (parseError) {
        console.error("[Carrier API] 📝 Raw error:", errorText);
      }

      // Return generic error message
      return {
        success: false,
        error: "Không thể lấy trạng thái vận đơn",
      };
    }

    const data = await response.json();

    console.log(`[Carrier API] ✅ Successfully got delivery status!`);
    console.log(`[Carrier API] 📋 Status: ${data.status_id}`);
    console.log(`[Carrier API] 📋 Full response:`, JSON.stringify(data, null, 2));

    return {
      success: true,
      deliveryStatus: data.status_id,
    };
  } catch (error) {
    console.error("[Carrier API] ❌ Fatal error getting delivery status:", error.message);
    console.error("[Carrier API] 📝 Error stack:", error.stack);
    console.error("[Carrier API] 📝 Tracking number:", trackingNumber);

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
    console.log(`[Warehouse Order API] 🔍 Fetching Shopify order: ${shopifyOrderId}`);

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

    if (data.errors) {
      console.error("[Warehouse Order API] ❌ GraphQL errors:", JSON.stringify(data.errors, null, 2));
      return null;
    }

    const order = data.data?.order;

    if (!order) {
      console.error("[Warehouse Order API] ❌ Order not found:", shopifyOrderId);
      return null;
    }

    console.log(`[Warehouse Order API] ✅ Found order: ${order.name}`);
    console.log(`[Warehouse Order API] 📦 Order has ${order.lineItems.edges.length} line items`);

    return order;
  } catch (error) {
    console.error("[Warehouse Order API] ❌ Error fetching Shopify order:", error.message);
    console.error("[Warehouse Order API] 📝 Error stack:", error.stack);
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
      price: parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount), // Price in VND
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
    currency_id: shopifyOrder.currencyCode || 'VND',
    items: items,
    shippingAddress: {
      full_address: removeVietnameseDiacritics(fullAddress), // Remove diacritics to avoid carrier API errors
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
    console.log(`[Carrier API] 🚀 Getting tracking number for order: ${orderId}`);

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      console.error("[Carrier API] ❌ WAREHOUSE_API_URL not configured");
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    if (!process.env.WAREHOUSE_SHOP_ID) {
      console.error("[Carrier API] ❌ WAREHOUSE_SHOP_ID not configured");
      throw new Error("WAREHOUSE_SHOP_ID not configured");
    }

    console.log(`[Carrier API] 📝 Config: API_URL=${process.env.WAREHOUSE_API_URL}, SHOP_ID=${process.env.WAREHOUSE_SHOP_ID}`);

    // Fetch order data from Shopify
    const shopifyOrderId = `gid://shopify/Order/${orderId}`;
    console.log(`[Carrier API] 🔍 Fetching Shopify order: ${shopifyOrderId}`);

    // Kiểm tra xem đã có sale_order_id trong metafields chưa
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
    const metafields = {};
    metafieldsData.data?.order?.metafields?.edges?.forEach(edge => {
      metafields[edge.node.key] = edge.node.value;
    });

    // Nếu đã có sale_order_id, trả về luôn không tạo mới
    if (metafields.sale_order_id) {
      console.log(`[Carrier API] ✅ Found existing sale_order_id: ${metafields.sale_order_id}`);
      console.log(`[Carrier API] 📝 Skipping API call to avoid creating duplicate order`);

      // Lấy delivery status từ API warehouse
      const statusResult = await getDeliveryStatus(metafields.sale_order_id);

      return {
        success: true,
        error: false,
        trackingNumber: metafields.sale_order_id,
        deliveryStatus: statusResult.success ? statusResult.deliveryStatus : null,
      };
    }

    console.log(`[Carrier API] 📝 No existing sale_order_id found, proceeding to create new order`);

    const shopifyOrder = await fetchShopifyOrder(admin, shopifyOrderId);

    if (!shopifyOrder) {
      console.error(`[Carrier API] ❌ Order ${orderId} not found in Shopify`);
      throw new Error(`Order ${orderId} not found in Shopify`);
    }

    console.log(`[Carrier API] ✅ Found Shopify order: ${shopifyOrder.name}`);
    console.log(`[Carrier API] 📦 Order details: ${shopifyOrder.lineItems.edges.length} line items`);

    // Format order data to match warehouse API requirements
    const warehouseOrderData = formatOrderForWarehouse(shopifyOrder);
    console.log(`[Carrier API] 📤 Sending order data to warehouse API:`, JSON.stringify(warehouseOrderData, null, 2));

    // Call warehouse API to create sale order and get tracking number
    console.log(`[Carrier API] 🌐 Calling warehouse API: POST ${process.env.WAREHOUSE_API_URL}/sale-orders`);

    const response = await fetch(`${process.env.WAREHOUSE_API_URL}/sale-orders`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
      },
      body: JSON.stringify(warehouseOrderData),
    });

    console.log(`[Carrier API] 📥 Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();

      // Log chi tiết lỗi API để debug
      console.error("[Carrier API] ❌ Warehouse API error:", {
        status: response.status,
        statusText: response.statusText,
        orderId: orderId,
        shopifyOrderId: shopifyOrderId,
        responseBody: errorText,
      });

      // Parse error message nếu có
      let apiErrorMessage = "Không thể tạo mã vận chuyển";
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.message) {
          console.error("[Carrier API] 📝 API error message:", errorData.message);
        }
        if (errorData.errors) {
          console.error("[Carrier API] 📝 API validation errors:", JSON.stringify(errorData.errors, null, 2));
        }
      } catch (parseError) {
        // Không parse được JSON, dùng raw text
        console.error("[Carrier API] 📝 Raw error:", errorText);
      }

      // Return generic error message (không expose API details)
      return {
        success: false,
        error: apiErrorMessage,
      };
    }

    const data = await response.json();

    console.log(`[Carrier API] ✅ Successfully created sale order!`);
    console.log(`[Carrier API] 📋 Sale order ID: ${data.id}`);
    console.log(`[Carrier API] 📋 Delivery status: ${data.status_id}`);
    console.log(`[Carrier API] 📋 Full response:`, JSON.stringify(data, null, 2));

    return {
      success: true,
      error: false,
      trackingNumber: data.id,
      deliveryStatus: data.status_id,
    };
  } catch (error) {
    console.error("[Carrier API] ❌ Fatal error getting tracking number:", error.message);
    console.error("[Carrier API] 📝 Error stack:", error.stack);
    console.error("[Carrier API] 📝 Order ID:", orderId);

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
 * Cancel sale order ở warehouse
 * @param {string} saleOrderId - Sale order ID (tracking number)
 * @returns {Promise<{success: boolean, data?: {id: string, status_id: string, payment_status_id: string, cancelled_at: string}, error?: string}>}
 */
export async function cancelSaleOrder(saleOrderId) {
  try {
    console.log(`[Warehouse Order API] 🚫 Cancelling sale order: ${saleOrderId}`);

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    // Call warehouse API to cancel sale order
    console.log(`[Warehouse Order API] 🌐 Calling warehouse API: POST ${process.env.WAREHOUSE_API_URL}/sale-orders/${saleOrderId}/cancel`);

    const response = await fetch(`${process.env.WAREHOUSE_API_URL}/sale-orders/${saleOrderId}/cancel`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
      },
    });

    console.log(`[Warehouse Order API] 📥 Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();

      // Log chi tiết lỗi API để debug
      console.error("[Warehouse Order API] ❌ Warehouse API error:", {
        status: response.status,
        statusText: response.statusText,
        saleOrderId: saleOrderId,
        responseBody: errorText,
      });

      // Parse error message nếu có
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.message) {
          console.error("[Warehouse Order API] API error message:", errorData.message);
        }
      } catch (parseError) {
        console.error("[Warehouse Order API] Raw error:", errorText);
      }

      return {
        success: false,
        error: "Không thể hủy đơn hàng",
      };
    }

    const data = await response.json();

    console.log(`[Warehouse Order API] ✅ Successfully cancelled sale order: ${saleOrderId}`);
    console.log(`[Warehouse Order API] 📋 Response:`, JSON.stringify(data, null, 2));

    return {
      success: true,
      data: data, // Include response data with id and status_id
    };
  } catch (error) {
    console.error("[Warehouse Order API] ❌ Error cancelling sale order:", error);

    return {
      success: false,
      error: "Không thể hủy đơn hàng",
    };
  }
}

/**
 * Check if order should be fulfilled based on delivery status
 * @param {string} deliveryStatus - Delivery status from warehouse
 * @returns {boolean}
 */
export function shouldFulfillOrder(deliveryStatus) {
  // List of statuses that should trigger fulfillment
  const fulfillableStatuses = [
    'waiting-for-transfer',
    'transfering-to-warehouse',
    'arrived-at-warehouse',
    'ready-to-deliver',
    'shipping',
    'delivery-complete',
  ];

  return fulfillableStatuses.includes(deliveryStatus);
}

/**
 * Fulfill Shopify order (mark as Fulfilled)
 * @param {Object} admin - Shopify admin API client
 * @param {string} orderId - Shopify order ID (gid://shopify/Order/xxx)
 * @param {string} trackingNumber - Tracking number for the fulfillment
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function fulfillOrder(admin, orderId, trackingNumber) {
  try {
    console.log(`[Warehouse] 📦 Start fulfilling order: ${orderId}`);

    /** -----------------------------------------
     *  STEP 1 — Fetch Fulfillment Orders + financial info
     * ----------------------------------------*/
    const orderResponse = await admin.graphql(
      `#graphql
        query getOrder($id: ID!) {
          order(id: $id) {
            id
            name
            displayFulfillmentStatus
            fulfillmentStatus
            financialStatus
            displayFinancialStatus
            fulfillable
            shippingAddress { country }
            cancelReason
            fulfillmentOrders(first: 10) {
              edges {
                node {
                  id
                  status
                  requestStatus
                  supportedActionTypes
                  assignedLocation { id name }
                  lineItems(first: 50) {
                    edges {
                      node {
                        id
                        remainingQuantity
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
      { variables: { id: orderId } }
    );

    const orderData = await orderResponse.json();
    console.log("[Warehouse] 🧾 Order GraphQL Response:", JSON.stringify(orderData, null, 2));

    const order = orderData.data?.order;
    if (!order) {
      console.error("[Warehouse] ❌ Order not found");
      return { success: false, error: "Order not found" };
    }

    /** -----------------------------------------
     *  STEP 1B — Debug logs
     * ----------------------------------------*/
    console.log("[Debug] financialStatus:", order.financialStatus);
    console.log("[Debug] displayFinancialStatus:", order.displayFinancialStatus);
    console.log("[Debug] fulfillmentStatus:", order.fulfillmentStatus);
    console.log("[Debug] displayFulfillmentStatus:", order.displayFulfillmentStatus);
    console.log("[Debug] fulfillable:", order.fulfillable);
    console.log("[Debug] cancelReason:", order.cancelReason);
    console.log("[Debug] shippingCountry:", order.shippingAddress?.country);
    console.log("[Debug] fulfillmentOrders count:", order.fulfillmentOrders?.edges.length);

    if (order.displayFulfillmentStatus === "FULFILLED") {
      console.log("[Warehouse] ⏭️ Order already fulfilled");
      return { success: true, alreadyFulfilled: true };
    }

    const fulfillmentOrders = order.fulfillmentOrders?.edges || [];
    if (fulfillmentOrders.length === 0) {
      console.warn("[Warehouse] ⚠️ No fulfillment orders found. Check if order is paid and fulfillable.");
      return { success: false, error: "No fulfillment orders found" };
    }

    /** -----------------------------------------
     *  STEP 2 — Process each FulfillmentOrder
     * ----------------------------------------*/
    for (const foEdge of fulfillmentOrders) {
      const fulfillmentOrder = foEdge.node;
      const { id: foId, status, lineItems } = fulfillmentOrder;

      console.log(`[Debug] FO ${foId} status: ${status}`);
      console.log(`[Debug] FO supportedActionTypes:`, fulfillmentOrder.supportedActionTypes);
      console.log(`[Debug] FO assignedLocation:`, fulfillmentOrder.assignedLocation);

      if (status === "CLOSED") {
        console.log(`[Warehouse] ⏭️ FO ${foId} already closed`);
        continue;
      }

      // Map line items with remainingQuantity > 0
      const itemsToFulfill = lineItems.edges
        .filter(edge => edge.node.remainingQuantity > 0)
        .map(edge => ({
          id: edge.node.id,
          quantity: edge.node.remainingQuantity,
        }));

      if (itemsToFulfill.length === 0) {
        console.log(`[Warehouse] ⏭️ No remaining quantity for FO ${foId}`);
        continue;
      }

      console.log(`[Warehouse] 📤 Fulfilling FO: ${foId}`);
      console.log(`[Warehouse] 📌 Line items:`, JSON.stringify(itemsToFulfill, null, 2));

      /** -----------------------------------------
       *  STEP 3 — Call fulfillmentCreateV2
       * ----------------------------------------*/
      const fulfillmentResponse = await admin.graphql(
        `#graphql
          mutation doFulfill($fulfillment: FulfillmentV2Input!) {
            fulfillmentCreateV2(fulfillment: $fulfillment) {
              fulfillment { id status }
              userErrors { field message }
            }
          }`,
        {
          variables: {
            fulfillment: {
              lineItemsByFulfillmentOrder: {
                fulfillmentOrderId: foId,
                fulfillmentOrderLineItems: itemsToFulfill,
              },
              trackingInfo: trackingNumber
                ? { number: trackingNumber, company: "Other" }
                : undefined,
            },
          },
        }
      );

      const fulfillmentData = await fulfillmentResponse.json();
      const userErrors = fulfillmentData.data?.fulfillmentCreateV2?.userErrors;

      if (userErrors?.length > 0) {
        console.error("[Warehouse] ❌ Fulfillment error:", JSON.stringify(userErrors, null, 2));
        return { success: false, error: userErrors[0].message };
      }

      console.log(`[Warehouse] ✅ Fulfilled FO ${foId}`);
    }

    console.log(`[Warehouse] 🎉 Order fulfilled successfully`);
    return { success: true };
  } catch (err) {
    console.error("[Warehouse] ❌ Exception:", err);
    return { success: false, error: err.message };
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