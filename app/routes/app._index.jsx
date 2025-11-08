import { json } from "@remix-run/node";
import { useLoaderData, Link, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  BlockStack,
  InlineStack,
  Button,
  SkeletonBodyText,
  Spinner,
  TextField,
  Divider,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import { useState, useCallback } from "react";
import { ClientOnly } from "../components/ClientOnly";
import {
  buildPaginationVariables,
  mapSortField,
  buildSearchQuery,
} from "../utils/pagination.server";
import { buildPaginationUrl } from "../utils/pagination";
import { shopifyLogger } from "../utils/logger.server";

export const loader = async ({ request }) => {
  const startTime = Date.now();

  try {
    // Authenticate and get admin API client using session token
    const { admin } = await authenticate.admin(request);

    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") || null;
    const direction = url.searchParams.get("direction") || "next";
    const PAGE_SIZE = 50;

    // Get search query parameter
    const searchQuery = url.searchParams.get("search") || "";

    // Get sort parameters
    const sortField = url.searchParams.get("sortField") || "order_date";
    const sortDirection = url.searchParams.get("sortDirection") || "descending";

    // Map to Shopify sort key
    const shopifySortKey = mapSortField(sortField);
    const reverse = sortDirection === "descending";

    // Build search query
    const queryString = buildSearchQuery(searchQuery);

    // Build pagination variables
    const paginationVars = buildPaginationVariables({
      cursor,
      direction,
      pageSize: PAGE_SIZE,
    });

    shopifyLogger.info('Loading orders list', {
      cursor,
      direction,
      searchQuery,
      sortField: shopifySortKey,
      reverse,
    });

    // Query orders with proper cursor-based pagination
    const response = await admin.graphql(
      `#graphql
        query getOrders($first: Int, $last: Int, $after: String, $before: String, $query: String, $sortKey: OrderSortKeys, $reverse: Boolean) {
          orders(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
            edges {
              cursor
              node {
                id
                name
                createdAt
                customer {
                  displayName
                }
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                displayFinancialStatus
                displayFulfillmentStatus
                channelInformation {
                  channelDefinition {
                    channelName
                  }
                }
                lineItems(first: 250) {
                  edges {
                    node {
                      id
                    }
                  }
                }
                tags
                deliveryStatus: metafield(namespace: "custom", key: "delivery_status") {
                  value
                }
                saleOrderId: metafield(namespace: "custom", key: "sale_order_id") {
                  value
                }
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
          }
        }`,
      {
        variables: {
          ...paginationVars,
          query: queryString,
          sortKey: shopifySortKey,
          reverse: reverse,
        },
      }
    );

    const data = await response.json();
    const ordersData = data.data.orders;

    // Map Shopify order data to match UI format
    const orders = ordersData.edges.map((edge) => ({
      id: edge.node.id.split('/').pop(),
      order_id: edge.node.name.replace('#', ''),
      customer_name: edge.node.customer?.displayName || 'Guest',
      total_price: parseFloat(edge.node.totalPriceSet.shopMoney.amount),
      order_date: edge.node.createdAt,
      financial_status: edge.node.displayFinancialStatus,
      fulfillment_status: edge.node.displayFulfillmentStatus,
      channel: edge.node.channelInformation?.channelDefinition?.channelName || 'Online Store',
      items_count: edge.node.lineItems.edges.length,
      tags: edge.node.tags,
      delivery_status: edge.node.deliveryStatus?.value || '',
      sale_order_id: edge.node.saleOrderId?.value || '',
      cursor: edge.cursor,
    }));

    const duration = Date.now() - startTime;
    shopifyLogger.info('Orders loaded successfully', {
      count: orders.length,
      duration: `${duration}ms`,
    });

    return json({
      orders,
      pageInfo: ordersData.pageInfo,
      searchQuery,
      sortField,
      sortDirection,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    shopifyLogger.error('Error loading orders', {
      error: error.message,
      duration: `${duration}ms`,
    });

    throw error;
  }
};

export default function Index() {
  const { t, i18n } = useTranslation();
  const { orders, pageInfo, searchQuery, sortField, sortDirection } = useLoaderData();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const submit = useSubmit();

  const [searchValue, setSearchValue] = useState(searchQuery || "");

  const resourceName = { singular: "order", plural: "orders" };

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

  const formatPrice = (price) => {
    const formatted = price.toLocaleString(getLocale());
    const currency = getCurrencySymbol();
    return i18n.language === "vi" ? `${formatted} ${currency}` : `${currency}${formatted}`;
  };

  const handleSort = useCallback((index, direction) => {
    const sortFields = ["order_id", "order_date", "", "total_price", "", "items_count", "", ""];
    const field = sortFields[index];

    if (field) {
      const formData = new FormData();
      formData.append("sortField", field);
      formData.append("sortDirection", direction);
      if (searchQuery) {
        formData.append("search", searchQuery);
      }
      // Reset to first page when sorting
      submit(formData, { method: "get" });
    }
  }, [searchQuery, submit]);

  const handleSearchChange = useCallback((value) => {
    setSearchValue(value);
  }, []);

  const handleSearchSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append("search", searchValue);
    formData.append("sortField", sortField);
    formData.append("sortDirection", sortDirection);
    submit(formData, { method: "get" });
  }, [searchValue, sortField, sortDirection, submit]);

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    const formData = new FormData();
    formData.append("search", "");
    formData.append("sortField", sortField);
    formData.append("sortDirection", sortDirection);
    submit(formData, { method: "get" });
  }, [sortField, sortDirection, submit]);

  // Build pagination URLs
  const nextPageUrl = pageInfo.hasNextPage
    ? buildPaginationUrl('/app', {
        cursor: pageInfo.endCursor,
        direction: 'next',
        search: searchQuery,
        sortField,
        sortDirection,
      })
    : null;

  const previousPageUrl = pageInfo.hasPreviousPage
    ? buildPaginationUrl('/app', {
        cursor: pageInfo.startCursor,
        direction: 'previous',
        search: searchQuery,
        sortField,
        sortDirection,
      })
    : null;

  return (
    <Page fullWidth>
      <TitleBar title={t("ordersList.title")} />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="300" blockAlign="end" align="space-between">
                  <div style={{ flex: 1 }}>
                    <TextField
                      value={searchValue}
                      onChange={handleSearchChange}
                      onClearButtonClick={handleSearchClear}
                      clearButton
                      placeholder={t("ordersList.search.placeholder")}
                      autoComplete="off"
                      connectedRight={
                        <Button onClick={handleSearchSubmit} loading={isLoading}>
                          {t("ordersList.search.button")}
                        </Button>
                      }
                    />
                  </div>
                </InlineStack>
                <BlockStack gap="400">
                {isLoading ? (
                  <BlockStack gap="400">
                    <InlineStack align="center" blockAlign="center">
                      <Spinner size="large" />
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {t("ordersList.loading")}
                      </Text>
                    </InlineStack>
                    <SkeletonBodyText lines={5} />
                  </BlockStack>
                ) : orders.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("ordersList.emptyState")}
                  </Text>
                ) : (
                  <>
                    <ClientOnly>
                      <IndexTable
                        resourceName={resourceName}
                        itemCount={orders.length}
                        headings={[
                          {
                            title: t("ordersList.table.orderId"),
                            sortable: true,
                            sortDirection: sortField === "order_id" ? sortDirection : undefined,
                          },
                          {
                            title: t("ordersList.table.orderDate"),
                            sortable: true,
                            sortDirection: sortField === "order_date" ? sortDirection : undefined,
                          },
                          { title: t("ordersList.table.customer") },
                          {
                            title: t("ordersList.table.totalPrice"),
                            sortable: true,
                            sortDirection: sortField === "total_price" ? sortDirection : undefined,
                          },
                          { title: t("ordersList.table.paymentStatus") },
                          {
                            title: t("ordersList.table.quantity"),
                            sortable: true,
                            sortDirection: sortField === "items_count" ? sortDirection : undefined,
                          },
                          { title: t("ordersList.table.saleOrderId") },
                          { title: t("ordersList.table.deliveryStatus") },
                        ]}
                        sortable={[true, true, false, true, false, true, false, false]}
                        sortDirection={sortDirection}
                        sortColumnIndex={
                          sortField === "order_id" ? 0 :
                          sortField === "order_date" ? 1 :
                          sortField === "total_price" ? 3 :
                          sortField === "items_count" ? 5 : undefined
                        }
                        onSort={handleSort}
                        selectable={false}
                      >
                        {orders.map((order, i) => (
                          <IndexTable.Row
                            id={order.id.toString()}
                            key={order.id}
                            position={i}
                          >
                            <IndexTable.Cell>
                              <Link to={`/app/orders/${order.id}`}>
                                <Text variant="bodyMd" fontWeight="semibold">
                                  #{order.order_id}
                                </Text>
                              </Link>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text variant="bodySm">
                                {new Date(order.order_date).toLocaleDateString(getLocale(), {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                })} {new Date(order.order_date).toLocaleTimeString(getLocale(), {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              {order.customer_name}
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              {formatPrice(order.total_price)}
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <InlineStack gap="100" blockAlign="center">
                                <Text variant="bodySm">
                                  {order.financial_status === "PAID" ? t("ordersList.paymentStatus.paid") : t("ordersList.paymentStatus.unpaid")}
                                </Text>
                              </InlineStack>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              {t("ordersList.itemsCount", { count: order.items_count })}
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text variant="bodySm">
                                {order.sale_order_id || '-'}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text variant="bodySm" tone="subdued">
                                {order.delivery_status || '-'}
                              </Text>
                            </IndexTable.Cell>
                          </IndexTable.Row>
                        ))}
                      </IndexTable>
                    </ClientOnly>

                    {/* Pagination Controls */}
                    <Box paddingBlockStart="400">
                      <Divider />
                    </Box>
                    <Box paddingBlockStart="400" paddingBlockEnd="200">
                      <InlineStack align="center" blockAlign="center" gap="300">
                        {previousPageUrl ? (
                          <Link to={previousPageUrl}>
                            <Button disabled={isLoading} loading={isLoading}>
                              {t("ordersList.pagination.previous")}
                            </Button>
                          </Link>
                        ) : (
                          <Button disabled>
                            {t("ordersList.pagination.previous")}
                          </Button>
                        )}

                        <Text as="span" variant="bodyMd">
                          {t("ordersList.pagination.showing", { count: orders.length })}
                        </Text>

                        {nextPageUrl ? (
                          <Link to={nextPageUrl}>
                            <Button disabled={isLoading} loading={isLoading}>
                              {t("ordersList.pagination.next")}
                            </Button>
                          </Link>
                        ) : (
                          <Button disabled>
                            {t("ordersList.pagination.next")}
                          </Button>
                        )}
                      </InlineStack>
                    </Box>
                  </>
                )}
              </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
