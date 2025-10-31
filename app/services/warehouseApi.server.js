/**
 * Warehouse API Service
 * Kết nối với API thực tế của kho để lấy dữ liệu tồn kho
 */

const WAREHOUSE_LOCATION_MAP = {
  7: "Narita - JP",
  9: "Ba Đình - HN",
};

// Mock data từ Example Response trong API documentation
// warehouse_id 7 = Japan (Narita - JP)
const MOCK_WAREHOUSE_7_DATA = [
  {
    id: 342,
    product_id: "a030910d-6868-482d-be1e-e0b11aa87a68",
    warehouse_id: 7,
    inventory_quantity: 100,
    sale_inventory_quantity: 100,
    product: {
      id: "a030910d-6868-482d-be1e-e0b11aa87a68",
      name: "DHC - Dầu tẩy trang 70ml",
      sku: "4511413305478",
      image_url: "https://cocolux.com/images/cdn_images/2021/05/products/1621041471010-dau-tay-trang-olive-dhc-deep-cleansing-oil-70ml.jpeg",
    }
  },
  {
    id: 341,
    product_id: "a030910d-7b0e-4813-8124-a55bd2efd22a",
    warehouse_id: 7,
    inventory_quantity: 200,
    sale_inventory_quantity: 200,
    product: {
      id: "a030910d-7b0e-4813-8124-a55bd2efd22a",
      name: "KUMANO - Sữa rửa mặt trắng da Hatomugi 130g màu trắng",
      sku: "4513574027060",
      image_url: "https://tosol-prod.s3.ap-northeast-1.amazonaws.com/products/9c33ec38-08a7-4308-a377-5bdee6492973.jpg",
    }
  },
];

// warehouse_id 9 = Viet Nam Ha Noi (Ba Đình - HN)
const MOCK_WAREHOUSE_9_DATA = [
  {
    id: 442,
    product_id: "a030910d-6868-482d-be1e-e0b11aa87a68",
    warehouse_id: 9,
    inventory_quantity: 80,
    sale_inventory_quantity: 80,
    product: {
      id: "a030910d-6868-482d-be1e-e0b11aa87a68",
      name: "DHC - Dầu tẩy trang 70ml",
      sku: "4511413305478",
      image_url: "https://cocolux.com/images/cdn_images/2021/05/products/1621041471010-dau-tay-trang-olive-dhc-deep-cleansing-oil-70ml.jpeg",
    }
  },
  {
    id: 441,
    product_id: "a030910d-7b0e-4813-8124-a55bd2efd22a",
    warehouse_id: 9,
    inventory_quantity: 150,
    sale_inventory_quantity: 150,
    product: {
      id: "a030910d-7b0e-4813-8124-a55bd2efd22a",
      name: "KUMANO - Sữa rửa mặt trắng da Hatomugi 130g màu trắng",
      sku: "4513574027060",
      image_url: "https://tosol-prod.s3.ap-northeast-1.amazonaws.com/products/9c33ec38-08a7-4308-a377-5bdee6492973.jpg",
    }
  },
];

/**
 * Lấy thông tin tồn kho từ API kho
 * Gọi API thực tế và transform sang format cần thiết
 *
 * @returns {Promise<Array<{sku: string, product_name: string, locations: Array<{location_name: string, quantity: number}>}>>}
 */
export async function fetchWarehouseInventory() {
  try {
    // Check USE_MOCK_WAREHOUSE_API flag từ environment
    const useMock = process.env.USE_MOCK_WAREHOUSE_API === 'true';

    // Nếu useMock = true hoặc không có API URL, sử dụng mock data
    if (useMock) {
      console.log("[Warehouse API] Using mock data (USE_MOCK_WAREHOUSE_API=true)");
      return getMockInventory();
    }

    if (!process.env.WAREHOUSE_API_URL) {
      console.log("[Warehouse API] Using mock data (WAREHOUSE_API_URL not configured)");
      return getMockInventory();
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

    // Fallback to mock data nếu API fail
    console.log("[Warehouse API] Falling back to mock data due to API error");
    return getMockInventory();
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
    hasMorePages = data.current_page < data.last_page;
    currentPage++;

    console.log(`[Warehouse API] Fetched page ${data.current_page}/${data.last_page} for warehouse ${warehouseId} (${data.data.length} items)`);
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

  // Process warehouse 7 (Japan)
  for (const item of warehouse7Data) {
    const sku = item.product.sku;
    if (!inventoryMap.has(sku)) {
      inventoryMap.set(sku, {
        sku: sku,
        product_name: item.product.name,
        locations: [],
      });
    }

    inventoryMap.get(sku).locations.push({
      location_name: WAREHOUSE_LOCATION_MAP[7], // "Japan"
      quantity: item.sale_inventory_quantity || 0,
    });
  }

  // Process warehouse 9 (Viet Nam Ha Noi)
  for (const item of warehouse9Data) {
    const sku = item.product.sku;
    if (!inventoryMap.has(sku)) {
      inventoryMap.set(sku, {
        sku: sku,
        product_name: item.product.name,
        locations: [],
      });
    }

    inventoryMap.get(sku).locations.push({
      location_name: WAREHOUSE_LOCATION_MAP[9], // "Viet Nam Ha Noi"
      quantity: item.sale_inventory_quantity || 0,
    });
  }

  return Array.from(inventoryMap.values());
}

/**
 * Get mock inventory data for testing
 * Simulate API response và transform sang format app cần
 * @returns {Array}
 */
function getMockInventory() {
  // Simulate fetching from both warehouses
  const warehouse7Data = MOCK_WAREHOUSE_7_DATA;
  const warehouse9Data = MOCK_WAREHOUSE_9_DATA;

  // Merge và transform data giống như khi gọi API thực
  const inventory = mergeWarehouseData(warehouse7Data, warehouse9Data);

  // Random thay đổi số lượng một chút để test sync
  const inventoryWithRandomChanges = inventory.map((item) => ({
    ...item,
    locations: item.locations.map((loc) => ({
      ...loc,
      quantity: Math.max(0, loc.quantity + Math.floor(Math.random() * 11) - 5), // +/- 5
    })),
  }));

  console.log(`[Mock Data] Generated ${inventoryWithRandomChanges.length} products with ${inventoryWithRandomChanges.reduce((sum, p) => sum + p.locations.length, 0)} location entries`);

  return inventoryWithRandomChanges;
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
