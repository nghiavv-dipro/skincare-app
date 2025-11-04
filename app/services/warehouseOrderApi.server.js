/**
 * Warehouse Order API Service (Improved with Retry Logic & Structured Logging)
 * Tạo sale order (mã xuất kho) ở warehouse khi có order mới từ Shopify
 */

import { fetchWithRetry, warehouseRetryOptions } from '../utils/retry.server.js';
import { warehouseLogger, logOrderProcessing, logError } from '../utils/logger.server.js';

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
  const startTime = Date.now();

  try {
    warehouseLogger.info(`Creating sale order for Shopify order ${shopifyOrder.name}`);

    // Validate config
    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    if (!process.env.WAREHOUSE_SHOP_ID) {
      throw new Error("WAREHOUSE_SHOP_ID not configured");
    }

    // Transform Shopify order to warehouse format
    const warehouseOrderData = await transformShopifyOrderToWarehouse(shopifyOrder, admin);

    // Call warehouse API with retry logic
    const response = await fetchWithRetry(
      `${process.env.WAREHOUSE_API_URL}/sale-orders`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
        },
        body: JSON.stringify(warehouseOrderData),
        timeout: 30000,
      },
      warehouseRetryOptions
    );

    const data = await response.json();
    const duration = Date.now() - startTime;

    warehouseLogger.info(`Sale order created successfully`, {
      saleOrderId: data.id,
      shopifyOrder: shopifyOrder.name,
      duration: `${duration}ms`,
    });

    logOrderProcessing(shopifyOrder.name, 'createWarehouseOrder', 'success', {
      saleOrderId: data.id,
      duration: `${duration}ms`,
    });

    return {
      success: true,
      saleOrderId: data.id,
      outboundOrderIds: data.outbound_orders?.map(o => o.id) || [],
      warehouseOrderData: data,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logError('WarehouseOrderAPI', error, {
      shopifyOrder: shopifyOrder.name,
      duration: `${duration}ms`,
      action: 'createWarehouseSaleOrder',
    });

    logOrderProcessing(shopifyOrder.name, 'createWarehouseOrder', 'failed', {
      error: error.message,
      duration: `${duration}ms`,
    });

    return {
      success: false,
      error: "Không thể tạo đơn hàng kho, vui lòng thử lại",
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
      warehouseLogger.warn(`Line item ${lineItem.title} has no SKU, skipping`);
      continue;
    }

    items.push({
      sku: lineItem.sku,
      quantity: lineItem.quantity,
      price: parseFloat(lineItem.price),
      tax_rate: 0,
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
    warehouse_id: parseInt(process.env.WAREHOUSE_ID || '7'),
    shop_id: process.env.WAREHOUSE_SHOP_ID,
    currency_id: shopifyOrder.currency || 'VND',
    items: items,
    shippingAddress: {
      full_address: removeVietnameseDiacritics(fullAddress),
      full_name: shippingAddress.name?.trim() || `${shopifyOrder.customer?.first_name || ''} ${shopifyOrder.customer?.last_name || ''}`.trim() || '',
      phone_number: shippingAddress.phone || shopifyOrder.customer?.phone || '',
      note: shopifyOrder.note || '',
      customer_pay: true,
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
  const startTime = Date.now();

  try {
    warehouseLogger.info(`Getting delivery status for tracking: ${trackingNumber}`);

    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    // Call carrier API with retry
    const response = await fetchWithRetry(
      `${process.env.WAREHOUSE_API_URL}/sale-orders/${trackingNumber}`,
      {
        method: 'GET',
        headers: {
          'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
        },
        timeout: 15000,
      },
      warehouseRetryOptions
    );

    const data = await response.json();
    const duration = Date.now() - startTime;

    warehouseLogger.info(`Delivery status retrieved`, {
      trackingNumber,
      status: data.status_id,
      duration: `${duration}ms`,
    });

    return {
      success: true,
      deliveryStatus: data.status_id,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logError('WarehouseOrderAPI', error, {
      trackingNumber,
      duration: `${duration}ms`,
      action: 'getDeliveryStatus',
    });

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
    logError('WarehouseOrderAPI', error, {
      shopifyOrderId,
      action: 'fetchShopifyOrder',
    });
    return null;
  }
}

/**
 * Format Shopify order data to warehouse API format
 * @param {Object} shopifyOrder - Order data from Shopify GraphQL
 * @returns {Object}
 */
function formatOrderForWarehouse(shopifyOrder) {
  const items = [];

  for (const edge of shopifyOrder.lineItems.edges) {
    const lineItem = edge.node;

    if (!lineItem.sku) {
      warehouseLogger.warn(`Line item ${lineItem.title} has no SKU, skipping`);
      continue;
    }

    items.push({
      sku: lineItem.sku,
      quantity: lineItem.quantity,
      price: parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount),
      tax_rate: 0,
    });
  }

  const shippingAddress = shopifyOrder.shippingAddress;
  const fullAddress = [
    shippingAddress.address1,
    shippingAddress.address2,
    shippingAddress.city,
    shippingAddress.province,
    shippingAddress.country,
  ].filter(Boolean).join(', ');

  return {
    warehouse_id: parseInt(process.env.WAREHOUSE_ID || '7'),
    shop_id: process.env.WAREHOUSE_SHOP_ID,
    currency_id: shopifyOrder.currencyCode || 'VND',
    items: items,
    shippingAddress: {
      full_address: removeVietnameseDiacritics(fullAddress),
      full_name: shippingAddress.name || `${shopifyOrder.customer?.firstName || ''} ${shopifyOrder.customer?.lastName || ''}`.trim(),
      phone_number: shippingAddress.phone || shopifyOrder.customer?.phone || '',
      note: shopifyOrder.note || '',
      customer_pay: true,
    },
  };
}

/**
 * Lấy tracking number từ carrier API
 * @param {Object} admin - Shopify admin API client
 * @param {string} orderId - Shopify Order ID (numeric)
 * @returns {Promise<{success: boolean, trackingNumber: string, deliveryStatus: string, error?: string}>}
 */
export async function getTrackingNumber(admin, orderId) {
  const startTime = Date.now();

  try {
    warehouseLogger.info(`Getting tracking number for order: ${orderId}`);

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

    // Format order data
    const warehouseOrderData = formatOrderForWarehouse(shopifyOrder);

    warehouseLogger.debug(`Sending order data to warehouse`, {
      orderId,
      itemsCount: warehouseOrderData.items.length,
    });

    // Call warehouse API with retry
    const response = await fetchWithRetry(
      `${process.env.WAREHOUSE_API_URL}/sale-orders`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
        },
        body: JSON.stringify(warehouseOrderData),
        timeout: 30000,
      },
      warehouseRetryOptions
    );

    const data = await response.json();
    const duration = Date.now() - startTime;

    warehouseLogger.info(`Tracking number retrieved`, {
      orderId,
      trackingNumber: data.id,
      deliveryStatus: data.status_id,
      duration: `${duration}ms`,
    });

    logOrderProcessing(orderId, 'getTrackingNumber', 'success', {
      trackingNumber: data.id,
      duration: `${duration}ms`,
    });

    return {
      success: true,
      trackingNumber: data.id,
      deliveryStatus: data.status_id,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logError('WarehouseOrderAPI', error, {
      orderId,
      duration: `${duration}ms`,
      action: 'getTrackingNumber',
    });

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
      warehouseLogger.error('Error saving metafields', { orderId, errors });
      return false;
    }

    warehouseLogger.info(`Saved warehouse order info to Shopify`, { orderId });
    return true;
  } catch (error) {
    logError('WarehouseOrderAPI', error, {
      orderId,
      action: 'saveWarehouseOrderToShopify',
    });
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
      warehouseLogger.error('Error updating metafields', { orderId, errors });
      return false;
    }

    warehouseLogger.info(`Updated metafields for order`, { orderId });
    return true;
  } catch (error) {
    logError('WarehouseOrderAPI', error, {
      orderId,
      action: 'updateOrderMetafields',
    });
    return false;
  }
}
