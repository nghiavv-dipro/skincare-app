# 🧾 Inventories API Documentation

## Overview
API này được phía kho cung cấp để ứng dụng Shopify App có thể **đồng bộ số lượng tồn kho** định kỳ (ví dụ: mỗi giờ một lần).

---

## 🏢 Danh sách kho

| warehouse_id | Tên kho | Mô tả |
|---------------|----------|--------|
| 7 | Narita - JP | Kho đóng gói |
| 9 | Ba Đình - HN | Kho phát hàng |

---

## 🛠️ Endpoint

**GET** `/inventories`

### Query Parameters

| Parameter | Type | Required | Description | Example |
|------------|------|-----------|--------------|----------|
| `page` | integer | No | Trang hiện tại của dữ liệu phân trang | `1` |
| `limit` | integer | No | Số lượng bản ghi mỗi trang | `10` |
| `warehouse_id` | integer | Yes | ID kho cần lấy tồn kho | `7` hoặc `9` |

---

## 🧩 Example Request

```bash
GET /inventories?page=1&limit=10&warehouse_id=7
```

---

## ✅ Example Response

```json
{
  "current_page": 1,
  "data": [
    {
      "id": 342,
      "product_id": "a030910d-6868-482d-be1e-e0b11aa87a68",
      "warehouse_id": 7,
      "inventory_quantity": 100,
      "created_at": "2025-10-25 14:58:04",
      "updated_at": "2025-10-25 14:58:42",
      "inbound_quantity": 100,
      "sale_quantity": 0,
      "sale_inventory_quantity": 100,
      "product": {
        "id": "a030910d-6868-482d-be1e-e0b11aa87a68",
        "name": "DHC - Dầu tẩy trang 70ml",
        "sku": "4511413305478",
        "image_url": "https://cocolux.com/images/cdn_images/2021/05/products/1621041471010-dau-tay-trang-olive-dhc-deep-cleansing-oil-70ml.jpeg",
        "price": 0,
        "seller_id": "USE000006",
        "currency_id": "VND",
        "width": 5,
        "length": 5,
        "height": 18,
        "volumetric": 450,
        "weight": 0.12,
        "total_quantity_inventory": 200,
        "total_sale_quantity": 2,
        "created_at": "2025-10-24 11:15:24",
        "updated_at": "2025-10-25 14:58:42",
        "path_file": null,
        "item_in_box": 30,
        "is_combo": false
      }
    },
    {
      "id": 341,
      "product_id": "a030910d-7b0e-4813-8124-a55bd2efd22a",
      "warehouse_id": 7,
      "inventory_quantity": 200,
      "created_at": "2025-10-25 14:56:43",
      "updated_at": "2025-10-25 14:56:58",
      "inbound_quantity": 200,
      "sale_quantity": 0,
      "sale_inventory_quantity": 200,
      "product": {
        "id": "a030910d-7b0e-4813-8124-a55bd2efd22a",
        "name": "KUMANO - Sữa rửa mặt trắng da Hatomugi 130g màu trắng",
        "sku": "4513574027060",
        "image_url": "https://tosol-prod.s3.ap-northeast-1.amazonaws.com/products/9c33ec38-08a7-4308-a377-5bdee6492973.jpg",
        "price": 0,
        "seller_id": "USE000006",
        "currency_id": "VND",
        "width": 6,
        "length": 16.5,
        "height": 16.5,
        "volumetric": 1633.5,
        "weight": 0.1,
        "total_quantity_inventory": 200,
        "total_sale_quantity": 0,
        "created_at": "2025-10-24 11:15:24",
        "updated_at": "2025-10-25 14:56:58",
        "path_file": null,
        "item_in_box": 48,
        "is_combo": false
      }
    }
  ],
  "from": 1,
  "last_page": 1,
  "per_page": 10,
  "to": 2,
  "total": 2,
  "meta": []
}
```

---

## 📦 Response Fields

### Level 1 — Inventory Item

| Field | Type | Description |
|--------|------|-------------|
| `id` | integer | ID tồn kho |
| `product_id` | string | ID sản phẩm |
| `warehouse_id` | integer | ID kho |
| `inventory_quantity` | integer | Số lượng có thể đóng gói |
| `inbound_quantity` | integer | Số lượng nhập kho |
| `sale_quantity` | integer | Số lượng đã bán |
| `sale_inventory_quantity` | integer | Số lượng có thể bán |
| `created_at` | string | Thời điểm tạo |
| `updated_at` | string | Thời điểm cập nhật |
| `product` | object | Thông tin chi tiết sản phẩm (xem bên dưới) |

---

### Level 2 — Product Object

| Field | Type | Description |
|--------|------|-------------|
| `id` | string | ID sản phẩm |
| `name` | string | Tên sản phẩm |
| `sku` | string | Mã SKU |
| `image_url` | string | Ảnh sản phẩm |
| `price` | number | Giá sản phẩm |
| `seller_id` | string | ID người bán |
| `currency_id` | string | Mã tiền tệ |
| `width`, `length`, `height` | number | Kích thước sản phẩm |
| `volumetric` | number | Thể tích quy đổi |
| `weight` | number | Trọng lượng sản phẩm |
| `total_quantity_inventory` | integer | Tổng số lượng có thể đóng gói ở tất cả kho |
| `total_sale_quantity` | integer | Tổng số lượng đã bán ở tất cả kho |
| `item_in_box` | integer | Số lượng item trong 1 thùng |
| `is_combo` | boolean | Sản phẩm có phải combo không |
| `path_file` | string / null | Đường dẫn file (nếu có) |
| `created_at` | string | Ngày tạo |
| `updated_at` | string | Ngày cập nhật |

---

## ⏱️ Recommended Usage

Ứng dụng **Shopify App** nên gọi API này mỗi **1 giờ/lần** để:

- Lấy dữ liệu tồn kho mới nhất (`inventory_quantity`, `sale_inventory_quantity`)  
- Cập nhật lại tồn kho sản phẩm tương ứng trên Shopify qua [Shopify Inventory API](https://shopify.dev/docs/api/admin-rest/2023-10/resources/inventorylevel)

---

## 🔐 Authentication

Tùy hệ thống kho, cần xác thực bằng:

- Header `Authorization: Bearer <token>` (nếu có yêu cầu)  
- Hoặc IP whitelist của server app EC2

---

## 📅 Pagination

API hỗ trợ phân trang tiêu chuẩn:

- `page`: số trang hiện tại  
- `limit`: số lượng bản ghi/trang  
- Response bao gồm các trường:  
  - `current_page`, `last_page`, `total`, `from`, `to`, `per_page`

---

## ⚠️ Notes

- Chỉ nên gọi API này **server-side**, tránh lộ key.  
- Không lưu dữ liệu dài hạn — chỉ dùng để cập nhật realtime.  
- Có thể lọc thêm theo `warehouse_id` nếu có nhiều kho khác nhau.

---

_Last updated: 2025-10-30_
