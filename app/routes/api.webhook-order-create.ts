import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getTrackingNumber, updateOrderMetafields } from "../services/warehouseOrderApi.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const testId = `webhook_test_${Date.now()}`;
  const timestamp = new Date().toISOString();
  
  console.log(`🧪 [${testId}] ===== WEBHOOK TEST ENDPOINT ACCESSED ===== ${timestamp}`);
  console.log(`📋 [${testId}] Method: ${request.method}`);
  console.log(`📋 [${testId}] URL: ${request.url}`);
  console.log(`📋 [${testId}] Headers:`, Object.fromEntries(request.headers.entries()));
  
  try {
    const body = await request.text();
    console.log(`📦 [${testId}] Body length: ${body.length}`);
    
    if (body) {
      const parsed = JSON.parse(body);
      console.log(`📋 [${testId}] Body JSON: ${JSON.stringify(parsed)}`);
      console.log(`📋 [${testId}] Body: ${parsed}`);
      console.log(`📋 [${testId}] Parsed order ID: ${parsed.id}`);
    }
  } catch (e) {
    console.log('error')
  }
  
  return json({ 
    success: true, 
    message: "Webhook test endpoint reached",
    timestamp: timestamp,
    testId: testId
  });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const testId = `webhook_get_test_${Date.now()}`;
  console.log(`[API Webhook] GET request to webhook endpoint`);

  return json({
    success: true,
    message: "Webhook endpoint is accessible via GET",
    timestamp: new Date().toISOString(),
    testId: testId,
    url: request.url
  });
};
