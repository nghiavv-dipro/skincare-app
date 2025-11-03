import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Webhook handler for ORDERS_CREATE
 * Logic is processed in shopify.server.js callback
 * This route just authenticates and returns 200 OK
 */
export async function action({ request }) {
  try {
    // Authenticate the webhook (required by Shopify)
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[Webhook Route] Received ${topic} from ${shop}, order #${payload.name}`);

    // Return success - actual processing happens in callback
    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[Webhook Route] Authentication error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}

export function loader() {
  throw new Response(null, { status: 404 });
}
