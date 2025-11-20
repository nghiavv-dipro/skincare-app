/**
 * Shopify App Proxy Authentication Middleware
 * Validates HMAC signature from query parameters
 *
 * Shopify params
 * - signature: HMAC signature
 * - shop: shop domain
 * - timestamp: request timestamp
 * - logged_in_customer_id: customer ID if logged in
 *
 * Reference: https://shopify.dev/docs/apps/build/online-store/app-proxies
 */

import { createHmac } from "crypto";
import { shopifyLogger as logger } from "./logger.server.js";

interface ProxyValidationResult {
  isValid: boolean;
  error?: string;
  shop?: string;
  customerId?: string;
  timestamp?: string;
}

/**
 * Validate Shopify App Proxy HMAC signature
 * @param request - Request object
 * @returns Validation result with shop and customer info
 */
export async function validateShopifyProxyRequest(
  request: Request
): Promise<ProxyValidationResult> {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Get signature from query params
  const signature = params.get("signature");

  if (!signature) {
    logger.warn("Missing signature in proxy request", {
      url: request.url,
    });
    return {
      isValid: false,
      error: "Missing signature parameter",
    };
  }

  // Get shop from query params
  const shop = params.get("shop");
  if (!shop) {
    logger.warn("Missing shop in proxy request", {
      url: request.url,
    });
    return {
      isValid: false,
      error: "Missing shop parameter",
    };
  }

  // Get app secret from environment
  const appSecret = process.env.SHOPIFY_API_SECRET;
  if (!appSecret) {
    logger.error("SHOPIFY_API_SECRET not configured");
    return {
      isValid: false,
      error: "Server configuration error",
    };
  }

  // Build query string for HMAC calculation
  // Shopify expects: all params except 'signature', sorted alphabetically
  // Multi-value params are joined with comma, then all params joined without separator

  // Group params by key (to handle multi-value params)
  const paramsMap = new Map<string, string[]>();

  params.forEach((value, key) => {
    if (key !== "signature") {
      if (!paramsMap.has(key)) {
        paramsMap.set(key, []);
      }
      paramsMap.get(key)!.push(value);
    }
  });

  // Build array of "key=value1,value2" strings
  const paramsArray: string[] = [];
  paramsMap.forEach((values, key) => {
    // Join multiple values with comma
    const joinedValues = values.join(',');
    paramsArray.push(`${key}=${joinedValues}`);
  });

  // Sort alphabetically by the entire "key=value" string
  paramsArray.sort();

  // Join all params without any separator
  const queryString = paramsArray.join("");

  // Calculate HMAC
  const calculatedHmac = createHmac("sha256", appSecret)
    .update(queryString, 'utf8')
    .digest("hex");

  // Compare signatures (case-insensitive)
  const isValid = calculatedHmac.toLowerCase() === signature.toLowerCase();

  if (!isValid) {
    logger.warn("Invalid HMAC signature", {
      shop,
      receivedSignature: signature,
      calculatedSignature: calculatedHmac,
      queryString,
    });
    return {
      isValid: false,
      error: "Invalid signature",
    };
  }

  // Extract additional info
  const customerId = params.get("logged_in_customer_id") || undefined;
  const timestamp = params.get("timestamp") || undefined;

  logger.info("Valid proxy request", {
    shop,
    customerId,
    timestamp,
  });

  return {
    isValid: true,
    shop,
    customerId,
    timestamp,
  };
}

/**
 * Helper to get shop domain from validated request
 */
export function getShopFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("shop");
}

/**
 * Helper to get customer ID from validated request
 */
export function getCustomerIdFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("logged_in_customer_id");
}

/**
 * Helper to check if customer is logged in
 */
export function isCustomerLoggedIn(request: Request): boolean {
  const customerId = getCustomerIdFromRequest(request);
  return customerId !== null && customerId !== "";
}
