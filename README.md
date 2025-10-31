# 🛍️ Orders Remix Shopify App

A **Shopify embedded app** built with **Remix**. It receives **new order webhooks**, stores them in a **Prisma/SQLite** database, and displays a **paginated admin table** using **Shopify Polaris**.

This README includes both local testing and full Shopify cloud/tunnel/webhook usage instructions as used in real-world developer and assignment scenarios.

---

## ✨ Features

- 🔔 **Shopify Webhook Integration**: Subscribes automatically to `orders/create` and other Shopify topics.
- 💾 **Database Integration**: Persists order details in a relational store via **Prisma/SQLite**.
- 🧭 **Embedded Admin UI**: Paginated (5 per page) Polaris table, embedded inside Shopify Admin.
- 🌐 **Tunnel-Ready**: Works with Shopify Local Tunnel (e.g., Cloudflare) to receive live Shopify webhooks securely.
- 🧪 **Local + Cloud Testing**: Test with Postman/curl or live Shopify test orders.

---

## ✅ Prerequisites

- [Node.js (LTS)](https://nodejs.org/)
- [Git](https://git-scm.com/)
- [Shopify Partner account](https://partners.shopify.com/)
- Shopify CLI  
  ```bash
  npm install -g @shopify/cli @shopify/app


## ⚙️ Setup Instructions

1.  **Clone the Repository**
    ```bash
    git clone [https://github.com//orders-remix-app.git](https://github.com//orders-remix-app.git)
    cd orders-remix-app
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Initialize the Database**
    ```bash
    npx prisma migrate dev --name init
    ```
    > 💡 **Optional:** Use `npx prisma studio` to visually inspect or edit the database.

---

## 🚀 Running the App (with Cloud Tunnel)

Shopify CLI uses a random port each time—check your terminal output for the correct port number.

1.  **Start the Development Server**
    ```bash
    npm run dev
    ```
    Watch for terminal output like this to get your port number:
    ```
    Local:   http://localhost:49201/
    Preview: [https://your-store.myshopify.com/admin/apps/your-app](https://your-store.myshopify.com/admin/apps/your-app)
    ```

2.  **Expose Your App with Cloudflare Tunnel**
    Replace `49201` with the actual port from the step above.
    ```bash
    npx cloudflared tunnel --url http://localhost:49201
    ```

3.  **Update `shopify.app.toml`**
    Replace `your-tunnel-url` with the public URL provided by Cloudflare.
    ```toml
    application_url = "https://your-tunnel-url/"

    [auth]
    redirect_urls = [
      "https://your-tunnel-url/api/auth"
    ]

    [webhooks]
    api_version = "2025-07"

    [[webhooks.subscriptions]]
    topics = ["orders/create"]
    uri = "/webhooks/orders_create"
    ```

---

## 📦 Receiving and Testing Webhooks

### A. Local Testing (Postman or `curl`)

* **URL:** `http://localhost:<PORT>/webhooks/orders_create`
* **Method:** `POST`
* **Payload:**
    ```json
    {
      "id": "9876543210",
      "total_price": "123.45",
      "created_at": "2024-07-01T14:30:00Z",
      "customer": {
        "first_name": "John",
        "last_name": "Doe"
      }
    }
    ```
* **Expected Response:**
    ```json
    { "success": true }
    ```

### B. Live Shopify Order Testing (Tunnel Required)

1.  Install the app in your Shopify development store.
2.  Open the app from **Shopify Admin → Apps**.
3.  Create a test order in your store.
4.  Shopify will send a `POST` request to your public webhook URL.
5.  Visit the `/orders` page in your app's admin UI to confirm the new order is saved.

> ⚠️ **Important:** Shopify cannot send webhooks to `localhost`. You **must** use a public tunnel like Cloudflare or Ngrok for live testing.

---

## 🧮 Viewing the Admin Table

1.  In your Shopify Admin, go to **Apps → Orders Remix App**.
2.  You will see the embedded UI displaying 5 orders per page.
3.  Use the **Next** and **Previous** buttons to navigate through the pages.

---

## 📁 Project Structure

app/
├── routes/
│   ├── webhooks.orders_create.jsx  # Webhook handler (POST)
│   └── orders.jsx                  # Admin UI with Polaris
├── db.server.js                    # Prisma client instance
└── shopify.server.js               # Shopify API/session config
prisma/
├── schema.prisma                   # Database schema (Order, Session)
└── migrations/
shopify.app.toml                    # App configuration
package.json

## 🛠️ Troubleshooting

* Always use the exact port and tunnel URL shown in your terminal.
* If you see the error `Cannot find module '~/db.server'`, change the import path:
    ```javascript
    import prisma from "../db.server";
    ```
* Shopify webhooks require a public **HTTPS** tunnel (e.g., Cloudflare, Ngrok).
* Ensure Polaris styles are imported in `app/root.jsx`:
    ```javascript
    import '@shopify/polaris/build/esm/styles.css';
    ```
* Wrap your application component in `<AppProvider>` within `app/root.jsx`.

---

## 📚 References

* [Shopify Remix Webhooks Documentation](https://shopify.dev/docs/apps/tools/cli/webhooks)
* [Using Cloudflare/Ngrok with Shopify CLI](https://shopify.dev/docs/apps/tools/cli/process#sharing-your-app)
* [Shopify Polaris UI Components](https://polaris.shopify.com/)# skincare-app
