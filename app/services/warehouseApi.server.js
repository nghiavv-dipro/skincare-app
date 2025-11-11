/**
 * Warehouse API Service
 * Kết nối với API thực tế của kho để lấy dữ liệu tồn kho
 */

const WAREHOUSE_LOCATION_MAP = {
  7: "Narita - JP",
  9: "Ba Đình - HN",
};

/**
 * Lấy thông tin tồn kho từ API kho
 * Gọi API thực tế và transform sang format cần thiết
 *
 * @returns {Promise<Array<{sku: string, product_name: string, locations: Array<{location_name: string, quantity: number}>}>>}
 */
export async function fetchWarehouseInventory() {
  try {
    if (!process.env.WAREHOUSE_API_URL) {
      throw new Error("WAREHOUSE_API_URL not configured");
    }

    console.log("[Warehouse API] Fetching inventory from real API...");

    // Fetch inventory từ cả 2 warehouses
    const warehouse7Data = await fetchWarehouseById(7); // Japan
    const warehouse9Data = await fetchWarehouseById(9); // Viet Nam Ha Noi

    // Transform và merge data từ 2 warehouses
    const inventory = mergeWarehouseData(warehouse7Data, warehouse9Data);

    console.log(`[Warehouse API] Fetched inventory for ${inventory.length} products across ${Object.keys(WAREHOUSE_LOCATION_MAP).length} locations`);
    return inventory;
  } catch (error) {
    console.error("[Warehouse API] Error fetching inventory:", error);
    throw error;
  }
}

/**
 * Fetch inventory từ một warehouse cụ thể
 * @param {number} warehouseId - ID của warehouse (7 hoặc 9)
 * @returns {Promise<Array>}
 */
async function fetchWarehouseById(warehouseId) {
  const allData = [];
  let currentPage = 1;
  let hasMorePages = true;
  const limit = 100; // Fetch 100 items per page

  while (hasMorePages) {
    const url = `${process.env.WAREHOUSE_API_URL}/inventories?page=${currentPage}&limit=${limit}&warehouse_id=${warehouseId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': process.env.WAREHOUSE_API_TOKEN ? `Bearer ${process.env.WAREHOUSE_API_TOKEN}` : undefined,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Warehouse API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Add items from this page
    if (data.data && Array.isArray(data.data)) {
      allData.push(...data.data);
    }

    // Check if there are more pages
    const currentPageNum = data.current_page || currentPage;
    const lastPageNum = data.last_page || 1;
    hasMorePages = currentPageNum < lastPageNum;
    currentPage++;

    const itemCount = data.data ? data.data.length : 0;
    console.log(`[Warehouse API] Fetched page ${currentPageNum}/${lastPageNum} for warehouse ${warehouseId} (${itemCount} items)`);
  }

  return allData;
}

/**
 * Merge và transform data từ nhiều warehouses
 * @param {Array} warehouse7Data - Data từ warehouse 7 (Japan)
 * @param {Array} warehouse9Data - Data từ warehouse 9 (Viet Nam)
 * @returns {Array<{sku: string, product_name: string, locations: Array}>}
 */
function mergeWarehouseData(warehouse7Data, warehouse9Data) {
  const inventoryMap = new Map();

  // Ensure inputs are arrays
  const warehouse7Items = Array.isArray(warehouse7Data) ? warehouse7Data : [];
  const warehouse9Items = Array.isArray(warehouse9Data) ? warehouse9Data : [];

  // Process warehouse 7 (Japan)
  for (const item of warehouse7Items) {
    // Skip items without valid product data
    if (!item || !item.product || !item.product.sku) {
      console.warn('[Warehouse API] Skipping item without valid product/sku in warehouse 7:', item);
      continue;
    }

    const sku = item.product.sku;

    // Skip empty SKUs
    if (sku.trim() === '') {
      console.warn('[Warehouse API] Skipping item with empty SKU in warehouse 7');
      continue;
    }

    if (!inventoryMap.has(sku)) {
      inventoryMap.set(sku, {
        sku: sku,
        product_name: item.product.name || 'Unknown Product',
        locations: [],
      });
    }

    inventoryMap.get(sku).locations.push({
      location_name: WAREHOUSE_LOCATION_MAP[7], // "Narita - JP"
      quantity: item.sale_inventory_quantity || 0,
    });
  }

  // Process warehouse 9 (Viet Nam Ha Noi)
  for (const item of warehouse9Items) {
    // Skip items without valid product data
    if (!item || !item.product || !item.product.sku) {
      console.warn('[Warehouse API] Skipping item without valid product/sku in warehouse 9:', item);
      continue;
    }

    const sku = item.product.sku;

    // Skip empty SKUs
    if (sku.trim() === '') {
      console.warn('[Warehouse API] Skipping item with empty SKU in warehouse 9');
      continue;
    }

    if (!inventoryMap.has(sku)) {
      inventoryMap.set(sku, {
        sku: sku,
        product_name: item.product.name || 'Unknown Product',
        locations: [],
      });
    }

    inventoryMap.get(sku).locations.push({
      location_name: WAREHOUSE_LOCATION_MAP[9], // "Ba Đình - HN"
      quantity: item.sale_inventory_quantity || 0,
    });
  }

  return Array.from(inventoryMap.values());
}

/**
 * Validate warehouse API response
 * @param {Array} inventory
 * @returns {boolean}
 */
export function validateInventoryData(inventory) {
  if (!Array.isArray(inventory)) {
    return false;
  }

  return inventory.every((item) => {
    return (
      typeof item.sku === "string" &&
      item.sku.length > 0 &&
      Array.isArray(item.locations) &&
      item.locations.length > 0 &&
      item.locations.every((loc) => (
        typeof loc.location_name === "string" &&
        typeof loc.quantity === "number" &&
        loc.quantity >= 0
      ))
    );
  });
}
