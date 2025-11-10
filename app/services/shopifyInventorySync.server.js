/**
 * Shopify Inventory Sync Service
 * Đồng bộ tồn kho từ warehouse lên Shopify
 * Chạy mỗi 1 giờ bởi cron job
 */

import { fetchWarehouseInventory } from "./warehouseApi.server.js";

/**
 * Sleep/delay utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

    const DELAY_BETWEEN_UPDATES = 500; // 500ms delay between updates to avoid rate limit
    let updateCount = 0;

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

        // Add delay between updates to avoid rate limiting
        updateCount++;
        if (updateCount % 10 === 0) {
          console.log(`[Inventory Sync] Processed ${updateCount}/${warehouseInventory.length} items, pausing...`);
          await sleep(DELAY_BETWEEN_UPDATES);
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
  let pageCount = 0;
  const MAX_RETRIES = 3;
  const ITEMS_PER_PAGE = 50; // Reduced from 100 to avoid rate limits
  const DELAY_BETWEEN_PAGES = 1000; // 1 second delay between pages

  try {
    while (hasNextPage) {
      pageCount++;
      console.log(`[Inventory Sync] Fetching page ${pageCount}...`);

      const query = `#graphql
        query getProductVariants${cursor ? '($cursor: String!)' : ''} {
          productVariants(first: ${ITEMS_PER_PAGE}${cursor ? ', after: $cursor' : ''}) {
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

      // Retry logic with exponential backoff
      let retryCount = 0;
      let success = false;
      let data = null;

      while (retryCount < MAX_RETRIES && !success) {
        try {
          const response = await admin.graphql(query, { variables });
          data = await response.json();
          success = true;
        } catch (error) {
          retryCount++;

          // Check if it's a 503 error
          if (error.response?.code === 503 || error.message?.includes('503')) {
            const backoffDelay = Math.pow(2, retryCount) * 2000; // 2s, 4s, 8s
            console.warn(`[Inventory Sync] ⚠️ Shopify API unavailable (503), retry ${retryCount}/${MAX_RETRIES} after ${backoffDelay}ms`);
            await sleep(backoffDelay);
          } else {
            // Other errors, throw immediately
            throw error;
          }
        }
      }

      if (!success || !data) {
        console.error("[Inventory Sync] ❌ Failed to fetch variants after retries");
        break;
      }

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

      console.log(`[Inventory Sync] Page ${pageCount}: fetched ${edges.length} variants (${variants.length} total)`);

      // Check pagination
      const pageInfo = data.data?.productVariants?.pageInfo;
      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor || null;

      // Add delay between pages to avoid rate limiting
      if (hasNextPage) {
        console.log(`[Inventory Sync] Waiting ${DELAY_BETWEEN_PAGES}ms before next page...`);
        await sleep(DELAY_BETWEEN_PAGES);
      }
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

