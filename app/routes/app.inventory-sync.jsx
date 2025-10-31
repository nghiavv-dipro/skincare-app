import { json } from "@remix-run/node";
import { useActionData, useNavigation, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  InlineStack,
  Divider,
  Badge,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { syncInventoryToShopify } from "../services/inventorySync.server";
import {
  createSyncLog,
  completeSyncLog,
  failSyncLog,
} from "../services/syncLogger.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  let syncLog = null;

  try {
    // Tạo sync log
    syncLog = await createSyncLog(session.shop);

    // Chạy sync
    const result = await syncInventoryToShopify(admin);

    // Update log với kết quả
    await completeSyncLog(syncLog.id, result);

    return json({
      success: result.success,
      shop: session.shop,
      timestamp: new Date().toISOString(),
      summary: result.summary,
      results: result.results,
      errors: result.errors,
      logId: syncLog.id,
    });
  } catch (error) {
    console.error("[Inventory Sync Page] Error:", error);

    // Log error
    if (syncLog) {
      await failSyncLog(syncLog.id, error);
    }

    return json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

export default function InventorySync() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  return (
    <Page>
      <TitleBar title="Đồng bộ tồn kho" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Đồng bộ Inventory tự động
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Hệ thống tự động đồng bộ số lượng tồn kho từ API kho lên
                    Shopify mỗi giờ.
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Thông tin đồng bộ
                  </Text>
                  <List type="bullet">
                    <List.Item>Tần suất: Mỗi giờ một lần</List.Item>
                    <List.Item>
                      Số sản phẩm: 16 sản phẩm skincare
                    </List.Item>
                    <List.Item>
                      Số kho: 2 locations (Japan, Viet Nam Ha Noi)
                    </List.Item>
                    <List.Item>
                      Phương thức: Tự động qua cron job hoặc external scheduler
                    </List.Item>
                    <List.Item>
                      Matching: Dựa trên mã SKU và tên location
                    </List.Item>
                  </List>
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Manual Sync
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Bạn có thể thực hiện đồng bộ thủ công bất cứ lúc nào bằng
                    cách nhấn nút bên dưới.
                  </Text>

                  <Form method="post">
                    <InlineStack gap="300" align="start">
                      <Button
                        variant="primary"
                        submit
                        loading={isLoading}
                        disabled={isLoading}
                      >
                        {isLoading ? "Đang đồng bộ..." : "Đồng bộ ngay"}
                      </Button>
                    </InlineStack>
                  </Form>
                </BlockStack>

                {actionData && (
                  <>
                    <Divider />
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingMd">
                        Kết quả đồng bộ
                      </Text>

                      {actionData.success ? (
                        <Banner tone="success">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd">
                              Đồng bộ thành công!
                              {actionData.results &&
                                actionData.results.filter(r => r.wasActivated).length > 0 && (
                                  <Text as="span" variant="bodyMd" tone="success">
                                    {" "}✨ Đã kích hoạt {actionData.results.filter(r => r.wasActivated).length} location mới!
                                  </Text>
                                )}
                            </Text>
                            <InlineStack gap="200">
                              <Badge tone="success">
                                Thành công: {actionData.summary.success}
                              </Badge>
                              <Badge tone="warning">
                                Bỏ qua: {actionData.summary.skipped}
                              </Badge>
                              {actionData.summary.failed > 0 && (
                                <Badge tone="critical">
                                  Lỗi: {actionData.summary.failed}
                                </Badge>
                              )}
                              <Badge>
                                Thời gian: {actionData.summary.duration}
                              </Badge>
                            </InlineStack>
                          </BlockStack>
                        </Banner>
                      ) : (
                        <Banner tone="critical">
                          <Text as="p" variant="bodyMd">
                            Đồng bộ thất bại: {actionData.error}
                          </Text>
                        </Banner>
                      )}

                      {actionData.results && actionData.results.length > 0 && (
                        <Card>
                          <BlockStack gap="300">
                            <Text as="h4" variant="headingSm">
                              Chi tiết cập nhật ({actionData.summary.totalLocations} locations)
                            </Text>
                            <BlockStack gap="200">
                              {actionData.results
                                .filter((r) => !r.skipped)
                                .slice(0, 20)
                                .map((result, index) => (
                                  <InlineStack
                                    key={index}
                                    align="space-between"
                                    blockAlign="center"
                                  >
                                    <BlockStack gap="100">
                                      <InlineStack gap="200" blockAlign="center">
                                        <Text as="p" variant="bodySm" fontWeight="semibold">
                                          SKU: {result.sku}
                                        </Text>
                                        {result.wasActivated && (
                                          <Badge tone="success">NEW</Badge>
                                        )}
                                      </InlineStack>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        📍 {result.location}
                                      </Text>
                                    </BlockStack>
                                    {result.success && (
                                      <Text
                                        as="p"
                                        variant="bodySm"
                                        tone="subdued"
                                      >
                                        {result.previousQuantity} →{" "}
                                        {result.newQuantity} (
                                        {result.delta > 0 ? "+" : ""}
                                        {result.delta})
                                      </Text>
                                    )}
                                  </InlineStack>
                                ))}
                              {actionData.results.filter((r) => !r.skipped).length > 20 && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  ... và {actionData.results.filter((r) => !r.skipped).length - 20} cập nhật khác
                                </Text>
                              )}
                            </BlockStack>
                          </BlockStack>
                        </Card>
                      )}

                      {actionData.errors && actionData.errors.length > 0 && (
                        <Banner tone="warning">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              Các SKU không thể đồng bộ:
                            </Text>
                            <List type="bullet">
                              {actionData.errors.map((error, index) => (
                                <List.Item key={index}>
                                  {error.sku}: {error.error}
                                </List.Item>
                              ))}
                            </List>
                          </BlockStack>
                        </Banner>
                      )}
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Setup External Cron
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Để setup đồng bộ tự động mỗi giờ, sử dụng external cron
                    service:
                  </Text>
                  <List type="number">
                    <List.Item>Truy cập cron-job.org</List.Item>
                    <List.Item>
                      Tạo job mới với URL: /api/sync-inventory
                    </List.Item>
                    <List.Item>Method: POST</List.Item>
                    <List.Item>Schedule: Every hour (0 * * * *)</List.Item>
                  </List>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    API Endpoint
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    POST /api/sync-inventory
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Requires Shopify authentication
                  </Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
