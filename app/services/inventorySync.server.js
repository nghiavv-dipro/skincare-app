/**
 * Inventory Sync Service
 * Đồng bộ tồn kho từ warehouse API lên Shopify cho nhiều locations
 */

import { fetchWarehouseInventory, validateInventoryData } from "./warehouseApi.server.js";

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

    // Step 2: Sync từng sản phẩm
    for (const item of warehouseInventory) {
      try {
        const result = await syncProductInventory(admin, item);
        results.push(...result); // result là array vì có nhiều locations
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
  const { sku, locations: warehouseLocations } = item;

  // Step 1: Tìm product variant theo SKU
  const variantResponse = await admin.graphql(
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
      variables: {
        query: `sku:${sku}`,
      },
    }
  );

  const variantData = await variantResponse.json();
  const variants = variantData.data.productVariants.edges;

  if (variants.length === 0) {
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

  // Step 2: Lấy tất cả inventory levels cho product này
  const inventoryResponse = await admin.graphql(
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
      variables: {
        inventoryItemId,
      },
    }
  );

  const inventoryData = await inventoryResponse.json();
  const inventoryLevels = inventoryData.data.inventoryItem.inventoryLevels.edges;

  // Step 2.5: Query tất cả locations có sẵn trong shop
  const locationsResponse = await admin.graphql(
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
      }`
  );

  const locationsData = await locationsResponse.json();
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

        const activateResponse = await admin.graphql(
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
            variables: {
              inventoryItemId,
              locationId: targetLocation.node.id,
            },
          }
        );

        const activateData = await activateResponse.json();
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
      const updateResponse = await admin.graphql(
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
          variables: {
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
          },
        }
      );

      const updateData = await updateResponse.json();
      const userErrors = updateData.data.inventoryAdjustQuantities.userErrors;

      if (userErrors && userErrors.length > 0) {
        throw new Error(`Shopify API error: ${userErrors[0].message}`);
      }

      const wasActivated = currentQuantity === 0 && !inventoryLevels.find((level) =>
        normalizeLocationName(level.node.location.name) === normalizeLocationName(locationName)
      );

      console.log(
        `[Inventory Sync] ${wasActivated ? '🆕 Activated & Updated' : 'Updated'} SKU ${sku} at ${locationName}: ${currentQuantity} -> ${newQuantity} (delta: ${delta > 0 ? "+" : ""}${delta})`
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
      console.error(`[Inventory Sync] Error updating ${sku} at ${warehouseLoc.location_name}:`, error);
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
