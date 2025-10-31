/**
 * Shopify Inventory Sync Service
 * Đồng bộ tồn kho từ warehouse lên Shopify
 * Chạy mỗi 1 giờ bởi cron job
 */

import { fetchWarehouseInventory } from "./warehouseApi.server.js";

/**
 * Main function to sync inventory from warehouse to Shopify
 * @param {Object} admin - Shopify admin API client
 * @returns {Promise<Object>} - Sync result
 */
export async function syncInventoryToShopify(admin) {
  const syncStartTime = new Date();
  console.log(`[Inventory Sync] Starting inventory sync at ${syncStartTime.toISOString()}`);

  let syncLog = {
    status: "success",
    totalItems: 0,
    updatedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    errorMessage: null,
  };

  try {
    // Step 1: Fetch warehouse inventory
    console.log("[Inventory Sync] Fetching warehouse inventory...");
    const warehouseInventory = await fetchWarehouseInventory();
    syncLog.totalItems = warehouseInventory.length;
    console.log(`[Inventory Sync] Fetched ${warehouseInventory.length} items from warehouse`);

    if (warehouseInventory.length === 0) {
      console.warn("[Inventory Sync] ⚠️ No inventory data from warehouse");
      syncLog.status = "partial";
      syncLog.errorMessage = "No inventory data from warehouse";
      return syncLog;
    }

    // Step 2: Fetch Shopify product variants with their inventory information
    console.log("[Inventory Sync] Fetching Shopify product variants...");
    const shopifyVariants = await fetchShopifyVariantsWithInventory(admin);
    console.log(`[Inventory Sync] Fetched ${shopifyVariants.length} variants from Shopify`);

    if (shopifyVariants.length === 0) {
      console.warn("[Inventory Sync] ⚠️ No Shopify variants found");
      syncLog.status = "partial";
      syncLog.errorMessage = "No Shopify variants found";
      return syncLog;
    }

    // Step 3: Match warehouse inventory with Shopify variants by SKU
    console.log("[Inventory Sync] Matching and updating inventory...");

    for (const warehouseItem of warehouseInventory) {
      try {
        // Find matching Shopify variant by SKU
        const variant = shopifyVariants.find(v => v.sku === warehouseItem.sku);

        if (!variant) {
          console.warn(`[Inventory Sync] ⚠️ No Shopify variant found for SKU: ${warehouseItem.sku}`);
          syncLog.skippedItems++;
          continue;
        }

        if (!variant.inventoryItem || !variant.inventoryItem.id) {
          console.warn(`[Inventory Sync] ⚠️ No inventory item for variant ${variant.sku}`);
          syncLog.skippedItems++;
          continue;
        }

        // Get location ID (first available location)
        const locationId = variant.inventoryItem.inventoryLevels?.edges?.[0]?.node?.location?.id;
        if (!locationId) {
          console.warn(`[Inventory Sync] ⚠️ No location found for variant ${variant.sku}`);
          syncLog.skippedItems++;
          continue;
        }

        // Update inventory quantity
        const success = await updateShopifyInventoryLevel(
          admin,
          variant.inventoryItem.id,
          locationId,
          warehouseItem.quantity
        );

        if (success) {
          console.log(`[Inventory Sync] ✅ Updated ${variant.sku}: ${warehouseItem.quantity} (${warehouseItem.location})`);
          syncLog.updatedItems++;
        } else {
          console.error(`[Inventory Sync] ❌ Failed to update ${variant.sku}`);
          syncLog.failedItems++;
        }
      } catch (itemError) {
        console.error(`[Inventory Sync] Error processing SKU ${warehouseItem.sku}:`, itemError);
        syncLog.failedItems++;
      }
    }

    // Determine final status
    if (syncLog.failedItems > 0 && syncLog.updatedItems === 0) {
      syncLog.status = "failed";
      syncLog.errorMessage = "All items failed to update";
    } else if (syncLog.failedItems > 0) {
      syncLog.status = "partial";
      syncLog.errorMessage = `${syncLog.failedItems} items failed to update`;
    }

    console.log(`[Inventory Sync] ✅ Sync completed:`, {
      total: syncLog.totalItems,
      updated: syncLog.updatedItems,
      failed: syncLog.failedItems,
      skipped: syncLog.skippedItems,
      status: syncLog.status,
    });
  } catch (error) {
    console.error("[Inventory Sync] Fatal error:", error);
    syncLog.status = "failed";
    syncLog.errorMessage = error.message;
  }

  return syncLog;
}

/**
 * Fetch all Shopify product variants with their inventory information
 * @param {Object} admin - Shopify admin API client
 * @returns {Promise<Array>}
 */
async function fetchShopifyVariantsWithInventory(admin) {
  const variants = [];
  let hasNextPage = true;
  let cursor = null;

  try {
    while (hasNextPage) {
      const query = `#graphql
        query getProductVariants${cursor ? '($cursor: String!)' : ''} {
          productVariants(first: 100${cursor ? ', after: $cursor' : ''}) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              cursor
              node {
                id
                sku
                inventoryItem {
                  id
                  inventoryLevels(first: 10) {
                    edges {
                      node {
                        id
                        available
                        location {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }`;

      const variables = cursor ? { cursor } : {};
      const response = await admin.graphql(query, { variables });
      const data = await response.json();

      if (data.errors) {
        console.error("[Inventory Sync] GraphQL errors:", data.errors);
        break;
      }

      const edges = data.data?.productVariants?.edges || [];

      // Extract variants
      edges.forEach(edge => {
        if (edge.node.sku) { // Only include variants with SKU
          variants.push(edge.node);
        }
      });

      // Check pagination
      const pageInfo = data.data?.productVariants?.pageInfo;
      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor || null;
    }

    return variants;
  } catch (error) {
    console.error("[Inventory Sync] Error fetching Shopify variants:", error);
    return [];
  }
}

/**
 * Update inventory level for a specific inventory item at a location
 * @param {Object} admin - Shopify admin API client
 * @param {string} inventoryItemId - Inventory item GID
 * @param {string} locationId - Location GID
 * @param {number} quantity - New quantity
 * @returns {Promise<boolean>}
 */
async function updateShopifyInventoryLevel(admin, inventoryItemId, locationId, quantity) {
  try {
    const response = await admin.graphql(
      `#graphql
        mutation inventorySetQuantity($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup {
              id
              reason
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
            reason: "correction",
            name: "available",
            quantities: [
              {
                inventoryItemId: inventoryItemId,
                locationId: locationId,
                quantity: quantity,
              }
            ],
          },
        },
      }
    );

    const data = await response.json();
    const errors = data.data?.inventorySetQuantities?.userErrors;

    if (errors && errors.length > 0) {
      console.error("[Inventory Sync] Error updating inventory:", errors);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Inventory Sync] Error calling Shopify API:", error);
    return false;
  }
}

