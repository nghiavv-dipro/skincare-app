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

export const loader = async ({ request }) => {
  // Authenticate and get admin API client using session token
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const PAGE_SIZE = 10;

  // Get search query parameter
  const searchQuery = url.searchParams.get("search") || "";

  // Get sort parameters
  const sortField = url.searchParams.get("sortField") || "order_date";
  const sortDirection = url.searchParams.get("sortDirection") || "descending";

  // Query orders directly from Shopify API using session token
  const response = await admin.graphql(
    `#graphql
      query getOrders($first: Int!) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true) {
          edges {
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
              lineItems(first: 1) {
                edges {
                  node {
                    id
                  }
                }
              }
              lineItemsCount: lineItems(first: 250) {
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
          }
        }
      }`,
    {
      variables: {
        first: PAGE_SIZE * page, // Fetch enough for pagination
      },
    }
  );

  const data = await response.json();
  const ordersData = data.data.orders;

  // Map Shopify order data to match UI format
  let allOrders = ordersData.edges.map((edge) => ({
    id: edge.node.id.split('/').pop(), // Extract numeric ID
    order_id: edge.node.name.replace('#', ''),
    customer_name: edge.node.customer?.displayName || 'Guest',
    total_price: parseFloat(edge.node.totalPriceSet.shopMoney.amount),
    order_date: edge.node.createdAt,
    financial_status: edge.node.displayFinancialStatus,
    fulfillment_status: edge.node.displayFulfillmentStatus,
    channel: edge.node.channelInformation?.channelDefinition?.channelName || 'Online Store',
    items_count: edge.node.lineItemsCount.edges.length,
    tags: edge.node.tags,
    delivery_status: edge.node.deliveryStatus?.value || '',
    sale_order_id: edge.node.saleOrderId?.value || '',
  }));

  // Apply search filtering
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    allOrders = allOrders.filter((order) => {
      return (
        order.order_id.toLowerCase().includes(query) ||
        order.customer_name.toLowerCase().includes(query) ||
        order.financial_status.toLowerCase().includes(query)
      );
    });
  }

  // Apply sorting
  allOrders.sort((a, b) => {
    let aValue, bValue;

    switch (sortField) {
      case "order_id":
        aValue = parseInt(a.order_id);
        bValue = parseInt(b.order_id);
        break;
      case "order_date":
        aValue = new Date(a.order_date).getTime();
        bValue = new Date(b.order_date).getTime();
        break;
      case "total_price":
        aValue = a.total_price;
        bValue = b.total_price;
        break;
      case "items_count":
        aValue = a.items_count;
        bValue = b.items_count;
        break;
      default:
        aValue = a.order_date;
        bValue = b.order_date;
    }

    if (sortDirection === "ascending") {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  // Paginate the results
  const skip = (page - 1) * PAGE_SIZE;
  const orders = allOrders.slice(skip, skip + PAGE_SIZE);
  const total = allOrders.length;

  return json({
    orders,
    page,
    total,
    pageCount: Math.ceil(total / PAGE_SIZE),
    searchQuery,
    sortField,
    sortDirection,
  });
};

export default function Index() {
  const { t, i18n } = useTranslation();
  const { orders, page, pageCount, searchQuery, sortField, sortDirection } = useLoaderData();
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
      submit(formData, { method: "get" });
    }
  }, [searchQuery, submit]);

  const handleSearchChange = useCallback((value) => {
    setSearchValue(value);
  }, []);

  const handleSearchSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append("search", searchValue);
    submit(formData, { method: "get" });
  }, [searchValue, submit]);

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    const formData = new FormData();
    formData.append("search", "");
    submit(formData, { method: "get" });
  }, [submit]);

  return (
    <Page fullWidth>
      <TitleBar title={t("ordersList.title")} />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="300" blockAlign="end">
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
                      <InlineStack align="center" gap="300">
                        <Link
                          to={`/app?page=${page - 1}${searchQuery ? `&search=${searchQuery}` : ''}${sortField ? `&sortField=${sortField}&sortDirection=${sortDirection}` : ''}`}
                          style={{
                            pointerEvents: page === 1 || isLoading ? "none" : "auto",
                          }}
                        >
                          <Button disabled={page === 1 || isLoading} loading={isLoading}>
                            {t("ordersList.pagination.previous")}
                          </Button>
                        </Link>
                        <Text as="span" variant="bodyMd">
                          {t("ordersList.pagination.page", { current: page, total: pageCount || 1 })}
                        </Text>
                        <Link
                          to={`/app?page=${page + 1}${searchQuery ? `&search=${searchQuery}` : ''}${sortField ? `&sortField=${sortField}&sortDirection=${sortDirection}` : ''}`}
                          style={{
                            pointerEvents: page === pageCount || isLoading ? "none" : "auto",
                          }}
                        >
                          <Button disabled={page === pageCount || isLoading} loading={isLoading}>
                            {t("ordersList.pagination.next")}
                          </Button>
                        </Link>
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
