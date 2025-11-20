import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  validateShopifyProxyRequest,
  getShopFromRequest,
  getCustomerIdFromRequest,
  isCustomerLoggedIn,
} from "../utils/shopifyProxyAuth.server";
import { shopifyLogger as logger } from "../utils/logger.server.js";
import { unauthenticated } from "../shopify.server";

// Keep these imports for potential future use
// import { createVerificationToken } from "../services/emailVerification.server";
// import { sendEmailVerification } from "../services/email.server";

/**
 * Customer API Proxy Endpoint
 * URL: /api/proxy/customer
 * Shopify App Proxy: https://yourshop.myshopify.com/apps/proxy/customer
 *
 * Validates HMAC signature and handles customer-related requests
 */

/**
 * GET handler - Retrieve customer information
 * Also supports email change via query parameters for testing
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestId = `customer_get_${Date.now()}`;

  logger.info("Customer GET request", {
    requestId,
    url: request.url,
  });

  // Validate Shopify proxy signature
  const validation = await validateShopifyProxyRequest(request);

  if (!validation.isValid) {
    logger.warn("Invalid proxy request", {
      requestId,
      error: validation.error,
    });

    return Response.json(
      {
        success: false,
        error: validation.error || "Invalid request signature",
      },
      { status: 403 }
    );
  }

  try {
    const shop = getShopFromRequest(request);
    const customerId = getCustomerIdFromRequest(request);
    const isLoggedIn = isCustomerLoggedIn(request);

    logger.info("Customer GET - authenticated", {
      requestId,
      shop,
      customerId,
      isLoggedIn,
    });

    // Check if this is an email change request via query params
    const url = new URL(request.url);
    const old_email = url.searchParams.get("old_email");
    const new_email = url.searchParams.get("new_email");

    if (old_email && new_email) {
      logger.info("Email change request via GET", {
        requestId,
        old_email,
        new_email,
        shop,
        customerId,
      });

      return await handleEmailUpdate(requestId, shop, customerId, { old_email, new_email });
    }

    // Default GET response - return customer info
    return Response.json({
      success: true,
      message: "Customer GET endpoint",
      data: {
        shop,
        customerId,
        isLoggedIn,
      },
      requestId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error in customer GET", {
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        requestId,
      },
      { status: 500 }
    );
  }
};

/**
 * POST handler - Update customer email
 *
 * Currently handles email updates only. This can be extended to support
 * other customer data operations such as:
 * - Updating preferences
 * - Managing addresses
 * - Newsletter subscriptions
 * - Custom metadata updates
 *
 * To extend, add action type parameter in request body and route accordingly
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = `customer_post_${Date.now()}`;

  logger.info("Customer POST request", {
    requestId,
    url: request.url,
    method: request.method,
  });

  // Only allow POST method
  if (request.method !== "POST") {
    return Response.json(
      {
        success: false,
        error: "Method not allowed. Only POST is supported.",
      },
      { status: 405 }
    );
  }

  // Validate Shopify proxy signature
  const validation = await validateShopifyProxyRequest(request);

  if (!validation.isValid) {
    logger.warn("Invalid proxy request", {
      requestId,
      error: validation.error,
    });

    return Response.json(
      {
        success: false,
        error: validation.error || "Invalid request signature",
      },
      { status: 403 }
    );
  }

  try {
    const shop = getShopFromRequest(request);
    const customerId = getCustomerIdFromRequest(request);
    const isLoggedIn = isCustomerLoggedIn(request);

    // Parse request body
    const body = await request.text();
    let parsedBody = null;

    try {
      if (body) {
        parsedBody = JSON.parse(body);
      }
    } catch (e) {
      logger.warn("Invalid JSON body", {
        requestId,
        body,
      });
      return Response.json(
        {
          success: false,
          error: "Invalid JSON body",
        },
        { status: 400 }
      );
    }

    logger.info("Customer POST - authenticated", {
      requestId,
      shop,
      customerId,
      isLoggedIn,
      body: parsedBody,
    });

    // Handle email update
    return await handleEmailUpdate(requestId, shop, customerId, parsedBody);
  } catch (error) {
    logger.error("Error in customer POST", {
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        requestId,
      },
      { status: 500 }
    );
  }
};

/**
 * Handle email update request
 * Verifies old email and updates to new email directly
 *
 * @param requestId - Unique request identifier for logging
 * @param shop - Shop domain
 * @param customerId - Shopify customer ID
 * @param data - Request data containing old_email and new_email
 */
async function handleEmailUpdate(
  requestId: string,
  shop: string | null,
  customerId: string | null,
  data: any
) {
  logger.info("Update customer email request", {
    requestId,
    shop,
    customerId,
    data,
  });

  // Validate required fields
  if (!customerId) {
    return Response.json({
      success: false,
      error: "Customer must be logged in to update email",
    }, { status: 401 });
  }

  if (!shop) {
    return Response.json({
      success: false,
      error: "Shop information missing",
    }, { status: 400 });
  }

  const { old_email, new_email } = data;

  if (!old_email || !new_email) {
    return Response.json({
      success: false,
      error: "Both old_email and new_email are required",
    }, { status: 400 });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(new_email)) {
    return Response.json({
      success: false,
      error: "Invalid new email format",
    }, { status: 400 });
  }

  try {
    // Get customer from Shopify to verify old email
    const { admin } = await unauthenticated.admin(shop);

    const response = await admin.graphql(
      `#graphql
      query getCustomer($id: ID!) {
        customer(id: $id) {
          id
          email
          firstName
          lastName
        }
      }`,
      {
        variables: {
          id: `gid://shopify/Customer/${customerId}`,
        },
      }
    );

    const responseJson = await response.json();
    const customer = responseJson.data?.customer;

    if (!customer) {
      logger.warn("Customer not found", {
        requestId,
        customerId,
        shop,
      });

      return Response.json({
        success: false,
        error: "Customer not found",
      }, { status: 404 });
    }

    // Verify old email matches
    if (customer.email !== old_email) {
      logger.warn("Old email does not match", {
        requestId,
        customerId,
        providedOldEmail: old_email,
        actualEmail: customer.email,
      });

      return Response.json({
        success: false,
        error: "Old email does not match your current email",
      }, { status: 400 });
    }

    // Update customer email
    const updateResponse = await admin.graphql(
      `#graphql
      mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            email
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
            id: `gid://shopify/Customer/${customerId}`,
            email: new_email,
          },
        },
      }
    );

    const updateResponseJson = await updateResponse.json();
    const userErrors = updateResponseJson.data?.customerUpdate?.userErrors;

    if (userErrors && userErrors.length > 0) {
      logger.error("Failed to update customer email", {
        requestId,
        customerId,
        userErrors,
      });

      return Response.json({
        success: false,
        error: userErrors[0].message || "Failed to update email",
      }, { status: 400 });
    }

    logger.info("Customer email updated successfully", {
      requestId,
      customerId,
      oldEmail: old_email,
      newEmail: new_email,
    });

    return Response.json({
      success: true,
      message: "Email updated successfully",
      data: {
        old_email,
        new_email,
        customerId,
        shop,
      },
      requestId,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error("Error updating customer email", {
      requestId,
      customerId,
      old_email,
      new_email,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return Response.json({
      success: false,
      error: "Failed to process email update. Please try again later.",
      requestId,
    }, { status: 400 });
  }
}
