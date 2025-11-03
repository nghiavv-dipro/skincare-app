import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
// Initialize cron jobs when server starts
import { startCronJobs } from "./cron.server.js";
import { DeliveryMethod } from "@shopify/shopify-api";
import { getTrackingNumber, updateOrderMetafields } from "./services/warehouseOrderApi.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  webhooks: {
    DELIVERY_METHOD: DeliveryMethod.Http,
    HANDLERS: {
      "ORDERS_CREATE": {
        deliveryMethod: DeliveryMethod.Http,
        callback: async (shop, body) => {
          try {
            const payload = JSON.parse(body);
            const orderId = payload.id?.toString();

            console.log(`[Webhook ORDERS_CREATE] Order created from ${shop}: #${payload.name} (ID: ${orderId})`);

            // Get admin API client for this shop
            const { admin } = await shopify.unauthenticated.admin(shop);

            // Get tracking number from warehouse API
            console.log(`[Webhook ORDERS_CREATE] Getting tracking number from warehouse...`);
            const trackingResult = await getTrackingNumber(admin, orderId);

            if (trackingResult.success) {
              console.log(`[Webhook ORDERS_CREATE] ✅ Tracking number received: ${trackingResult.trackingNumber}`);

              // Save tracking info to Shopify order metafields
              const shopifyOrderId = `gid://shopify/Order/${orderId}`;
              const saved = await updateOrderMetafields(admin, shopifyOrderId, [
                {
                  key: "sale_order_id",
                  value: trackingResult.trackingNumber,
                },
                {
                  key: "delivery_status",
                  value: trackingResult.deliveryStatus,
                },
              ]);

              if (saved) {
                console.log(`[Webhook ORDERS_CREATE] ✅ Saved tracking info to Shopify order metafield`);
              } else {
                console.warn(`[Webhook ORDERS_CREATE] ⚠️ Failed to save tracking info to Shopify`);
              }
            } else {
              console.error(`[Webhook ORDERS_CREATE] ❌ Failed to get tracking number: ${trackingResult.error}`);
            }
          } catch (error) {
            console.error("[Webhook ORDERS_CREATE] Fatal error:", error);
          }
        },
      },
    },
  },
  hooks: {
      afterAuth: async ({session}) => {
      shopify.registerWebhooks({session});
    },
   },
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

startCronJobs();
