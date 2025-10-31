import { json } from "@remix-run/node";
import { useLoaderData, useNavigation, useActionData, useSubmit, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Divider,
  Button,
  InlineStack,
  SkeletonBodyText,
  SkeletonDisplayText,
  Spinner,
  Thumbnail,
  Icon,
  Link as PolarisLink,
} from "@shopify/polaris";
import { LocationIcon, CheckIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import { getDeliveryStatus, getTrackingNumber, updateOrderMetafields } from "../services/warehouseOrderApi.server";

export const loader = async ({ request, params }) => {
  // Authenticate and get admin API client using session token
  const { admin } = await authenticate.admin(request);

  const { orderId } = params;

  // Reconstruct Shopify GraphQL ID from numeric ID
  const shopifyOrderId = `gid://shopify/Order/${orderId}`;

  // Query order details from Shopify API
  const response = await admin.graphql(
    `#graphql
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          customer {
            id
            displayName
            email
            phone
            numberOfOrders
            defaultAddress {
              address1
              address2
              city
              zip
              country
              phone
            }
          }
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          subtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalShippingPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          displayFinancialStatus
          displayFulfillmentStatus
          fulfillments {
            id
            status
            location {
              name
            }
            trackingInfo {
              number
              url
            }
          }
          shippingAddress {
            address1
            address2
            city
            zip
            country
            phone
          }
          billingAddress {
            address1
            address2
            city
            zip
            country
            phone
          }
          lineItems(first: 10) {
            edges {
              node {
                id
                title
                quantity
                sku
                image {
                  url
                  altText
                }
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }`,
    {
      variables: {
        id: shopifyOrderId,
      },
    },
  );

  const data = await response.json();

  if (!data.data.order) {
    throw new Response("Không tìm thấy đơn hàng", { status: 404 });
  }

  const shopifyOrder = data.data.order;

  // Extract metafields
  const metafields = {};
  shopifyOrder.metafields?.edges?.forEach(edge => {
    metafields[edge.node.key] = edge.node.value;
  });

  // Map Shopify order data to match UI format
  const order = {
    id: orderId,
    order_id: shopifyOrder.name.replace("#", ""),
    customer_name: shopifyOrder.customer?.displayName || "Guest",
    customer_email: shopifyOrder.customer?.email || "",
    customer_phone: shopifyOrder.customer?.phone || "",
    customer_order_count: shopifyOrder.customer?.numberOfOrders || 0,
    total_price: parseFloat(shopifyOrder.totalPriceSet.shopMoney.amount),
    subtotal_price: parseFloat(shopifyOrder.subtotalPriceSet.shopMoney.amount),
    shipping_price: parseFloat(
      shopifyOrder.totalShippingPriceSet.shopMoney.amount,
    ),
    tax_price: parseFloat(shopifyOrder.totalTaxSet.shopMoney.amount),
    order_date: shopifyOrder.createdAt,
    financial_status: shopifyOrder.displayFinancialStatus,
    fulfillment_status: shopifyOrder.displayFulfillmentStatus,
    fulfillment_location:
      shopifyOrder.fulfillments?.[0]?.location?.name || "VN",
    shipping_address: shopifyOrder.shippingAddress,
    billing_address: shopifyOrder.billingAddress,
    line_items: shopifyOrder.lineItems.edges.map((edge) => ({
      id: edge.node.id,
      title: edge.node.title,
      sku: edge.node.sku,
      quantity: edge.node.quantity,
      price: parseFloat(edge.node.originalUnitPriceSet.shopMoney.amount),
      image_url: edge.node.image?.url,
    })),
    delivery_status: metafields.delivery_status || null,
    tracking_number: metafields.sale_order_id || null,
  };

  return json({ order });
};

export const action = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const { orderId } = params;
  const shopifyOrderId = `gid://shopify/Order/${orderId}`;

  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "getDeliveryStatus") {
    const trackingNumber = formData.get("trackingNumber");

    if (!trackingNumber) {
      return json({
        success: false,
        error: "Tracking Number not found. Please get tracking number first.",
      });
    }

    // Get delivery status from carrier API using tracking number
    const result = await getDeliveryStatus(trackingNumber);

    if (result.success) {
      // Update the delivery status in Shopify metafields
      await updateOrderMetafields(admin, shopifyOrderId, [
        {
          key: "delivery_status",
          value: result.deliveryStatus,
        },
      ]);

      return json({
        success: true,
        actionType: "getDeliveryStatus",
        deliveryStatus: result.deliveryStatus,
        statusDetails: result.statusDetails,
      });
    } else {
      return json({
        success: false,
        actionType: "getDeliveryStatus",
        error: result.error,
      });
    }
  }

  if (actionType === "getTrackingNumber") {
    // Get tracking number from carrier API using order ID
    const result = await getTrackingNumber(orderId);

    if (result.success) {
      // Save tracking number to custom.sale_order_id (as per the flow)
      await updateOrderMetafields(admin, shopifyOrderId, [
        {
          key: "sale_order_id",
          value: result.trackingNumber,
        },
      ]);

      return json({
        success: true,
        actionType: "getTrackingNumber",
        trackingNumber: result.trackingNumber,
      });
    } else {
      return json({
        success: false,
        actionType: "getTrackingNumber",
        error: result.error,
      });
    }
  }

  return json({ success: false, error: "Unknown action type" });
};

export default function OrderDetail() {
  const { t, i18n } = useTranslation();
  const { order } = useLoaderData();
  const navigation = useNavigation();
  const actionData = useActionData();
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  // Only show full page loading on initial load, not when revalidating
  const isInitialLoading = navigation.state === "loading" && !order;

  const isSubmitting = navigation.state === "submitting";
  const submittingAction = navigation.formData?.get("actionType");

  // Show toast notification and revalidate data when action completes
  useEffect(() => {
    if (actionData) {
      if (actionData.success && actionData.actionType === "getDeliveryStatus") {
        shopify.toast.show(t("order.toast.deliveryStatusSuccess", { status: actionData.deliveryStatus }));
        revalidator.revalidate();
      } else if (actionData.success && actionData.actionType === "getTrackingNumber") {
        shopify.toast.show(t("order.toast.trackingNumberSuccess", { number: actionData.trackingNumber }));
        revalidator.revalidate();
      } else if (!actionData.success) {
        shopify.toast.show(t("order.toast.error", { message: actionData.error }), { isError: true });
      }
    }
  }, [actionData, shopify, revalidator, t]);

  const handleGetDeliveryStatus = () => {
    const formData = new FormData();
    formData.append("actionType", "getDeliveryStatus");
    formData.append("trackingNumber", order.tracking_number);
    submit(formData, { method: "post" });
  };

  const handleGetTrackingNumber = () => {
    const formData = new FormData();
    formData.append("actionType", "getTrackingNumber");
    submit(formData, { method: "post" });
  };

  // Get locale based on current language
  const getLocale = () => {
    switch (i18n.language) {
      case "vi":
        return "vi-VN";
      case "ja":
        return "ja-JP";
      case "en":
      default:
        return "en-US";
    }
  };

  // Get currency symbol based on current language
  const getCurrencySymbol = () => {
    switch (i18n.language) {
      case "vi":
        return "đ";
      case "ja":
        return "¥";
      case "en":
      default:
        return "$";
    }
  };

  const formatDate = (date) => {
    const d = new Date(date);
    return d.toLocaleDateString(getLocale(), {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatPrice = (price) => {
    const formatted = price.toLocaleString(getLocale());
    const currency = getCurrencySymbol();
    return i18n.language === "vi" ? `${formatted} ${currency}` : `${currency}${formatted}`;
  };

  return (
    <Page
      fullWidth
      title={
        <InlineStack gap="200" blockAlign="center">
          <Text as="h1" variant="headingLg">
            #{order.order_id}
          </Text>
        </InlineStack>
      }
      backAction={{ content: t("common.orders"), url: "/app" }}
    >
      <TitleBar title={t("order.title")} />
      {isInitialLoading ? (
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="large" />
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("order.loading.message")}
                  </Text>
                </InlineStack>
                <Divider />
                <SkeletonDisplayText size="medium" />
                <SkeletonBodyText lines={8} />
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <SkeletonBodyText lines={3} />
            </Card>
          </Layout.Section>
        </Layout>
      ) : (
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {/* Fulfillment Card */}
              <Card>
                <BlockStack gap="400">
                  {/* Status, Location, Tracking, and Delivery on one line */}
                  <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    {/* Status */}
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={CheckIcon} tone="success" />
                      <Text as="h3" variant="headingMd">
                        {order.fulfillment_status === "FULFILLED"
                          ? t("order.status.fulfilled", { count: order.line_items.length })
                          : t("order.status.unfulfilled")}
                      </Text>
                    </InlineStack>

                    {/* Location */}
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={LocationIcon} />
                      <Text variant="bodyMd" fontWeight="semibold">
                        {order.fulfillment_location}
                      </Text>
                    </InlineStack>

                    {/* Tracking Number */}
                    <InlineStack gap="200" blockAlign="center">
                      {isSubmitting && submittingAction === "getTrackingNumber" ? (
                        <>
                          <Spinner size="small" />
                          <Text variant="bodySm" tone="subdued">
                            {t("order.fulfillment.gettingTracking")}
                          </Text>
                        </>
                      ) : order.tracking_number ? (
                        <>
                          <Text variant="bodySm" tone="subdued">
                            {t("order.fulfillment.trackingNumber")}:
                          </Text>
                          <Text variant="bodySm" fontWeight="semibold">
                            {order.tracking_number}
                          </Text>
                        </>
                      ) : (
                        <Text variant="bodySm" tone="subdued">
                          {t("order.fulfillment.noTracking")}
                        </Text>
                      )}
                    </InlineStack>

                    {/* Delivery Status */}
                    <InlineStack gap="200" blockAlign="center">
                      {isSubmitting && submittingAction === "getDeliveryStatus" ? (
                        <>
                          <Spinner size="small" />
                          <Text variant="bodySm" tone="subdued">
                            {t("order.fulfillment.gettingDeliveryStatus")}
                          </Text>
                        </>
                      ) : order.delivery_status ? (
                        <>
                          <Text variant="bodySm" tone="subdued">
                            {t("order.fulfillment.deliveryStatus")}:
                          </Text>
                          <Text variant="bodySm" fontWeight="semibold">
                            {order.delivery_status}
                          </Text>
                        </>
                      ) : (
                        <Text variant="bodySm" tone="subdued">
                          {t("order.fulfillment.noDeliveryStatus")}
                        </Text>
                      )}
                    </InlineStack>
                  </InlineStack>

                  <Divider />

                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="bodyMd" fontWeight="semibold">
                      📅
                    </Text>
                    <Text variant="bodyMd">{formatDate(order.order_date)}</Text>
                  </InlineStack>

                  <Divider />

                  {/* Products List */}
                  <BlockStack gap="400">
                    {/* Header */}
                    <div style={{ display: 'flex', gap: '16px', paddingBottom: '8px', borderBottom: '1px solid var(--p-color-border-subdued)' }}>
                      <div style={{ width: '40px' }}></div>
                      <div style={{ flex: 1 }}>
                        <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
                          {t("order.product.title")}
                        </Text>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '120px 120px', gap: '16px', textAlign: 'right' }}>
                        <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
                          {t("order.product.price")}
                        </Text>
                        <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
                          {t("order.product.total")}
                        </Text>
                      </div>
                    </div>

                    {/* Product Rows */}
                    {order.line_items.map((item) => (
                      <div key={item.id} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                        <Thumbnail
                          source={
                            item.image_url ||
                            "https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
                          }
                          alt={item.title}
                          size="small"
                        />
                        <div style={{ flex: 1 }}>
                          <BlockStack gap="200">
                            <Text variant="bodyMd" fontWeight="semibold">
                              {item.title}
                            </Text>
                            <Text variant="bodySm" tone="subdued">
                              {item.sku}
                            </Text>
                          </BlockStack>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 120px', gap: '16px', textAlign: 'right' }}>
                          <div>
                            <Text variant="bodyMd">
                              {formatPrice(item.price)} × {item.quantity}
                            </Text>
                          </div>
                          <div>
                            <Text variant="bodyMd" fontWeight="semibold">
                              {formatPrice(item.price * item.quantity)}
                            </Text>
                          </div>
                        </div>
                      </div>
                    ))}
                  </BlockStack>

                  <InlineStack align="end" gap="300">
                    <Button
                      onClick={handleGetTrackingNumber}
                      loading={isSubmitting && submittingAction === "getTrackingNumber"}
                      disabled={isSubmitting}
                    >
                      {t("order.actions.getTrackingNumber")}
                    </Button>
                    <Button
                      onClick={handleGetDeliveryStatus}
                      loading={isSubmitting && submittingAction === "getDeliveryStatus"}
                      disabled={!order.tracking_number || isSubmitting}
                    >
                      {t("order.actions.getDeliveryStatus")}
                    </Button>
                  </InlineStack>
                  {!order.tracking_number && (
                    <Text variant="bodySm" tone="subdued">
                      {t("order.actions.note")}
                    </Text>
                  )}
                </BlockStack>
              </Card>

              {/* Payment Card */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={CheckIcon} tone="success" />
                      <Text as="h3" variant="headingMd">
                        {t("order.status.paid")}
                      </Text>
                    </InlineStack>
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" fontWeight="bold">
                        {t("order.payment.total")}
                      </Text>
                      <Text variant="bodyMd">
                        {t("order.payment.items", { count: order.line_items.length })}
                      </Text>
                      <Text variant="headingMd" fontWeight="bold">
                        {formatPrice(order.total_price)}
                      </Text>
                    </InlineStack>

                    <Divider />

                    <InlineStack align="space-between">
                      <Text variant="headingMd" fontWeight="bold">
                        {t("order.payment.paid")}
                      </Text>
                      <Text variant="headingMd" fontWeight="bold">
                        {formatPrice(order.total_price)}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    {t("order.customer.title")}
                  </Text>
                </InlineStack>

                <Divider />

                {/* Customer Info */}
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="bold">
                    {order.customer_name}
                  </Text>
                  {order.customer_order_count > 0 ? (
                    <Text variant="bodySm" tone="subdued">
                      {t("order.customer.orders", { count: order.customer_order_count })}
                    </Text>
                  ) : (
                    <Text variant="bodySm" tone="subdued">
                      {t("order.customer.noOrders")}
                    </Text>
                  )}
                  {/* Add birthday and gender if available */}
                  <Text variant="bodySm" tone="subdued">
                    {t("order.customer.phone")}:{" "}
                    {order.customer_phone ||
                      order.shipping_address?.phone ||
                      "N/A"}
                  </Text>
                </BlockStack>

                <Divider />

                {/* Contact Information */}
                <BlockStack gap="300">
                  <Text variant="bodyMd" fontWeight="semibold">
                    {t("order.customer.contactInfo")}
                  </Text>
                  {order.customer_email && (
                    <PolarisLink url={`mailto:${order.customer_email}`}>
                      <Text variant="bodyMd">{order.customer_email}</Text>
                    </PolarisLink>
                  )}
                  {!order.customer_phone && (
                    <Text variant="bodySm" tone="subdued">
                      {t("order.customer.noPhone")}
                    </Text>
                  )}
                </BlockStack>

                <Divider />

                {/* Shipping Address */}
                <BlockStack gap="300">
                  <Text variant="bodyMd" fontWeight="semibold">
                    {t("order.customer.shippingAddress")}
                  </Text>
                  {order.shipping_address ? (
                    <BlockStack gap="100">
                      <Text variant="bodyMd">{order.customer_name}</Text>
                      {order.shipping_address.address1 && (
                        <Text variant="bodyMd">
                          {order.shipping_address.address1}
                        </Text>
                      )}
                      {order.shipping_address.address2 && (
                        <Text variant="bodyMd">
                          {order.shipping_address.address2}
                        </Text>
                      )}
                      {order.shipping_address.zip && (
                        <Text variant="bodyMd">
                          {order.shipping_address.zip}
                        </Text>
                      )}
                      <Text variant="bodyMd">
                        {order.shipping_address.city}{" "}
                        {order.shipping_address.zip}
                      </Text>
                      <Text variant="bodyMd">
                        {order.shipping_address.country}
                      </Text>
                      {order.shipping_address.phone && (
                        <Text variant="bodyMd">
                          {order.shipping_address.phone}
                        </Text>
                      )}
                      <PolarisLink url="#">{t("order.customer.viewMap")}</PolarisLink>
                    </BlockStack>
                  ) : (
                    <Text variant="bodySm" tone="subdued">
                      {t("order.customer.noShippingAddress")}
                    </Text>
                  )}
                </BlockStack>

                <Divider />

                {/* Billing Address */}
                <BlockStack gap="300">
                  <Text variant="bodyMd" fontWeight="semibold">
                    {t("order.customer.billingAddress")}
                  </Text>
                  {order.billing_address &&
                  JSON.stringify(order.billing_address) ===
                    JSON.stringify(order.shipping_address) ? (
                    <Text variant="bodySm" tone="subdued">
                      {t("order.customer.sameAsShipping")}
                    </Text>
                  ) : order.billing_address ? (
                    <BlockStack gap="100">
                      <Text variant="bodyMd">{order.customer_name}</Text>
                      {order.billing_address.address1 && (
                        <Text variant="bodyMd">
                          {order.billing_address.address1}
                        </Text>
                      )}
                      {order.billing_address.address2 && (
                        <Text variant="bodyMd">
                          {order.billing_address.address2}
                        </Text>
                      )}
                      <Text variant="bodyMd">
                        {order.billing_address.city} {order.billing_address.zip}
                      </Text>
                      <Text variant="bodyMd">
                        {order.billing_address.country}
                      </Text>
                    </BlockStack>
                  ) : (
                    <Text variant="bodySm" tone="subdued">
                      {t("order.customer.noBillingAddress")}
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      )}
    </Page>
  );
}
