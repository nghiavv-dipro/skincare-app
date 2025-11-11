/**
 * Inventory Sync Service
 * Đồng bộ tồn kho từ warehouse API lên Shopify cho nhiều locations
 */

import { fetchWarehouseInventory, validateInventoryData } from "./warehouseApi.server.js";

/**
 * Sleep/delay utility for rate limiting
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute GraphQL query with retry logic for 503 errors
 * @param {Object} admin - Shopify admin API client
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<Object>}
 */
async function graphqlWithRetry(admin, query, variables = {}, maxRetries = 3) {
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await admin.graphql(query, { variables });
      const data = await response.json();

      // Check for GraphQL errors
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      return data;
    } catch (error) {
      retryCount++;

      // Check if it's a 503 error (service unavailable)
      const is503 = error.response?.code === 503 ||
                     error.message?.includes('503') ||
                     error.message?.includes('Service Unavailable');

      if (is503 && retryCount < maxRetries) {
        const backoffDelay = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
        console.warn(`[Inventory Sync] ⚠️ Shopify API unavailable (503), retry ${retryCount}/${maxRetries} after ${backoffDelay}ms`);
        await sleep(backoffDelay);
      } else {
        // Other errors or max retries reached, throw
        throw error;
      }
    }
  }

  throw new Error('Max retries reached');
}

/**
 * Đồng bộ inventory từ warehouse lên Shopify
 *
 * @param {Object} admin - Shopify admin API client
 * @returns {Promise<{success: boolean, results: Array, errors: Array, summary: Object}>}
 */
export async function syncInventoryToShopify(admin) {
  const startTime = Date.now();
  const results = [];
  const errors = [];

  try {
    console.log("[Inventory Sync] Starting inventory sync...");

    // Step 1: Lấy thông tin tồn kho từ warehouse
    const warehouseInventory = await fetchWarehouseInventory();

    if (!validateInventoryData(warehouseInventory)) {
      throw new Error("Invalid inventory data from warehouse API");
    }

    console.log(`[Inventory Sync] Fetched ${warehouseInventory.length} items from warehouse`);

    // Log warehouse inventory details
    console.log("\n[Inventory Sync] ===== WAREHOUSE INVENTORY DATA =====");
    warehouseInventory.forEach((item, index) => {
      console.log(`\n[${index + 1}/${warehouseInventory.length}] SKU: ${item.sku}`);
      console.log(`  Product: ${item.product_name}`);
      console.log(`  Locations:`);
      item.locations.forEach(loc => {
        console.log(`    📍 ${loc.location_name}: ${loc.quantity} units`);
      });
    });
    console.log("\n[Inventory Sync] ======================================\n");

    // Step 2: Sync từng sản phẩm với rate limiting
    const DELAY_BETWEEN_PRODUCTS = 300; // 300ms delay between products to avoid rate limit
    let processedCount = 0;

    for (const item of warehouseInventory) {
      try {
        const result = await syncProductInventory(admin, item);
        results.push(...result); // result là array vì có nhiều locations

        processedCount++;

        // Add delay between products (except for the last one)
        if (processedCount < warehouseInventory.length) {
          await sleep(DELAY_BETWEEN_PRODUCTS);
        }
      } catch (error) {
        console.error(`[Inventory Sync] Error syncing SKU ${item.sku}:`, error);
        errors.push({
          sku: item.sku,
          error: error.message,
        });
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      total: warehouseInventory.length,
      success: results.filter((r) => r.success && !r.skipped).length,
      failed: errors.length,
      skipped: results.filter((r) => r.skipped).length,
      totalLocations: results.length,
      duration: `${(duration / 1000).toFixed(2)}s`,
    };

    console.log("[Inventory Sync] Sync completed:", summary);

    return {
      success: errors.length === 0,
      results,
      errors,
      summary,
    };
  } catch (error) {
    console.error("[Inventory Sync] Fatal error:", error);
    throw error;
  }
}

/**
 * Sync inventory cho một sản phẩm cụ thể tại tất cả locations
 *
 * @param {Object} admin - Shopify admin API client
 * @param {Object} item - {sku, product_name, locations: [{location_name, quantity}]}
 * @returns {Promise<Array<{success: boolean, sku: string, location: string, message: string}>>}
 */
async function syncProductInventory(admin, item) {
  const { sku, product_name, locations: warehouseLocations } = item;

  console.log(`\n[Sync Product] Processing SKU: ${sku} (${product_name})`);
  console.log(`[Sync Product] Warehouse locations (${warehouseLocations.length}):`);
  warehouseLocations.forEach(loc => {
    console.log(`  - ${loc.location_name}: ${loc.quantity} units`);
  });

  // Step 1: Tìm product variant theo SKU
  const variantData = await graphqlWithRetry(
    admin,
    `#graphql
      query getVariantBySku($query: String!) {
        productVariants(first: 1, query: $query) {
          edges {
            node {
              id
              sku
              displayName
              inventoryItem {
                id
              }
            }
          }
        }
      }`,
    {
      query: `sku:${sku}`,
    }
  );

  const variants = variantData.data.productVariants.edges;

  if (variants.length === 0) {
    console.log(`[Sync Product] ❌ SKU ${sku} not found in Shopify`);
    return [{
      success: false,
      skipped: true,
      sku,
      location: "all",
      message: `Product variant with SKU ${sku} not found in Shopify`,
    }];
  }

  const variant = variants[0].node;
  const inventoryItemId = variant.inventoryItem.id;
  console.log(`[Sync Product] ✅ Found variant in Shopify: ${variant.displayName} (ID: ${variant.id})`);

  // Step 2: Lấy tất cả inventory levels cho product này
  const inventoryData = await graphqlWithRetry(
    admin,
    `#graphql
      query getInventoryLevels($inventoryItemId: ID!) {
        inventoryItem(id: $inventoryItemId) {
          inventoryLevels(first: 10) {
            edges {
              node {
                id
                quantities(names: ["available"]) {
                  name
                  quantity
                }
                location {
                  id
                  name
                }
              }
            }
          }
        }
      }`,
    {
      inventoryItemId,
    }
  );

  const inventoryLevels = inventoryData.data.inventoryItem.inventoryLevels.edges;

  console.log(`[Sync Product] Current Shopify inventory levels (${inventoryLevels.length}):`);
  inventoryLevels.forEach(level => {
    const qty = level.node.quantities.find(q => q.name === "available")?.quantity || 0;
    console.log(`  - ${level.node.location.name}: ${qty} units`);
  });

  // Step 2.5: Query tất cả locations có sẵn trong shop
  const locationsData = await graphqlWithRetry(
    admin,
    `#graphql
      query getLocations {
        locations(first: 10) {
          edges {
            node {
              id
              name
            }
          }
        }
      }`,
    {}
  );

  const allLocations = locationsData.data.locations.edges;

  if (inventoryLevels.length === 0 && allLocations.length === 0) {
    return [{
      success: false,
      skipped: true,
      sku,
      location: "all",
      message: `No locations found in shop for SKU ${sku}`,
    }];
  }

  // Step 3: Match warehouse locations với Shopify locations và update/activate
  const updateResults = [];

  for (const warehouseLoc of warehouseLocations) {
    try {
      // Tìm matching location trong inventory levels hiện tại
      let shopifyLocation = inventoryLevels.find((level) => {
        const locationName = level.node.location.name;
        return normalizeLocationName(locationName) === normalizeLocationName(warehouseLoc.location_name);
      });

      // Nếu chưa có inventory level cho location này, activate nó
      if (!shopifyLocation) {
        // Tìm location trong danh sách locations của shop
        const targetLocation = allLocations.find((loc) => {
          return normalizeLocationName(loc.node.name) === normalizeLocationName(warehouseLoc.location_name);
        });

        if (!targetLocation) {
          updateResults.push({
            success: false,
            skipped: true,
            sku,
            location: warehouseLoc.location_name,
            message: `Location "${warehouseLoc.location_name}" không tồn tại trong Shopify. Vui lòng tạo location này trong Settings > Locations.`,
          });
          continue;
        }

        // Activate inventory level cho location này
        console.log(`[Inventory Sync] Activating inventory for SKU ${sku} at ${targetLocation.node.name}...`);

        const activateData = await graphqlWithRetry(
          admin,
          `#graphql
            mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
              inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
                inventoryLevel {
                  id
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                  location {
                    id
                    name
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
          {
            inventoryItemId,
            locationId: targetLocation.node.id,
          }
        );

        const activateErrors = activateData.data.inventoryActivate.userErrors;

        if (activateErrors && activateErrors.length > 0) {
          updateResults.push({
            success: false,
            skipped: false,
            sku,
            location: warehouseLoc.location_name,
            error: activateErrors[0].message,
            message: `Failed to activate inventory for SKU ${sku} at ${warehouseLoc.location_name}: ${activateErrors[0].message}`,
          });
          continue;
        }

        // Sau khi activate thành công, lấy inventory level mới
        shopifyLocation = {
          node: activateData.data.inventoryActivate.inventoryLevel
        };

        console.log(`[Inventory Sync] ✅ Activated inventory for SKU ${sku} at ${targetLocation.node.name}`);
      }

      const currentLevel = shopifyLocation.node;
      const locationId = currentLevel.location.id;
      const locationName = currentLevel.location.name;

      // Lấy available quantity
      const availableQty = currentLevel.quantities.find((q) => q.name === "available");
      const currentQuantity = availableQty ? availableQty.quantity : 0;
      const newQuantity = warehouseLoc.quantity;

      // Skip nếu quantity giống nhau
      if (currentQuantity === newQuantity) {
        console.log(`[Sync Product] ⏭️  Skip ${locationName}: quantity unchanged (${newQuantity})`);
        updateResults.push({
          success: true,
          skipped: true,
          sku,
          location: locationName,
          message: `SKU ${sku} at ${locationName} already has correct quantity (${newQuantity})`,
        });
        continue;
      }

      // Step 4: Update inventory
      const delta = newQuantity - currentQuantity;
      console.log(`[Sync Product] 🔄 Updating ${locationName}: ${currentQuantity} → ${newQuantity} (${delta > 0 ? '+' : ''}${delta})`);
      const updateData = await graphqlWithRetry(
        admin,
        `#graphql
          mutation adjustInventoryQuantities($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) {
              userErrors {
                field
                message
              }
              inventoryAdjustmentGroup {
                reason
                changes {
                  name
                  delta
                }
              }
            }
          }`,
        {
          input: {
            reason: "correction",
            name: "available",
            changes: [
              {
                inventoryItemId,
                locationId,
                delta,
              },
            ],
          },
        }
      );

      const userErrors = updateData.data.inventoryAdjustQuantities.userErrors;

      if (userErrors && userErrors.length > 0) {
        console.log(`[Sync Product] ❌ Failed to update ${locationName}: ${userErrors[0].message}`);
        throw new Error(`Shopify API error: ${userErrors[0].message}`);
      }

      const wasActivated = currentQuantity === 0 && !inventoryLevels.find((level) =>
        normalizeLocationName(level.node.location.name) === normalizeLocationName(locationName)
      );

      console.log(
        `[Sync Product] ✅ ${wasActivated ? 'Activated & Updated' : 'Updated'} ${locationName}: ${currentQuantity} → ${newQuantity} (${delta > 0 ? '+' : ''}${delta})`
      );

      updateResults.push({
        success: true,
        skipped: false,
        sku,
        location: locationName,
        previousQuantity: currentQuantity,
        newQuantity: newQuantity,
        delta,
        wasActivated: wasActivated,
        message: wasActivated
          ? `✨ Activated & updated SKU ${sku} at ${locationName} to ${newQuantity}`
          : `Successfully updated SKU ${sku} at ${locationName} from ${currentQuantity} to ${newQuantity}`,
      });
    } catch (error) {
      console.error(`[Sync Product] ❌ Error updating ${sku} at ${warehouseLoc.location_name}:`, error.message);
      updateResults.push({
        success: false,
        skipped: false,
        sku,
        location: warehouseLoc.location_name,
        error: error.message,
        message: `Failed to update SKU ${sku} at ${warehouseLoc.location_name}: ${error.message}`,
      });
    }
  }

  // Log summary for this product
  const successCount = updateResults.filter(r => r.success && !r.skipped).length;
  const skippedCount = updateResults.filter(r => r.skipped).length;
  const failedCount = updateResults.filter(r => !r.success).length;
  console.log(`[Sync Product] Summary for ${sku}: ${successCount} updated, ${skippedCount} skipped, ${failedCount} failed\n`);

  return updateResults;
}

/**
 * Normalize location name để matching
 * @param {string} name
 * @returns {string}
 */
function normalizeLocationName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " "); // Normalize spaces
}
