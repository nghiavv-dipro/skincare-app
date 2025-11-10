import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, Form, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Select,
  InlineStack,
  Button,
  Banner,
  Badge,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Switch } from "../components/Switch";
import { syncInventoryToShopify } from "../services/inventorySync.server";
import {
  createSyncLog,
  failSyncLog,
} from "../services/syncLogger.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Get current session settings
  const currentSession = await prisma.session.findFirst({
    where: {
      shop: session.shop,
      isOnline: false,
    },
    orderBy: {
      id: "desc",
    },
  });

  return json({
    enableWebhookSync: currentSession?.enableWebhookSync ?? true,
  });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "language") {
    const language = formData.get("language");
    return json({ success: true, language });
  }

  if (actionType === "webhook") {
    const enableWebhookSync = formData.get("enableWebhookSync") === "true";

    // Update all sessions for this shop
    await prisma.session.updateMany({
      where: {
        shop: session.shop,
      },
      data: {
        enableWebhookSync,
      },
    });

    return json({ success: true, webhook: true, enableWebhookSync });
  }

  if (actionType === "inventorySync") {
    let syncLog = null;

    try {
      // Tạo sync log
      syncLog = await createSyncLog(session.shop);

      // Chạy sync
      const result = await syncInventoryToShopify(admin);

      return json({
        success: result.success,
        inventorySync: true,
        shop: session.shop,
        timestamp: new Date().toISOString(),
        summary: result.summary,
        results: result.results,
        errors: result.errors,
      });
    } catch (error) {
      console.error("[Settings Inventory Sync] Error:", error);

      // Log error
      if (syncLog) {
        await failSyncLog(syncLog.id, error);
      }

      return json({
        success: false,
        inventorySync: true,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return json({ success: false });
};

export default function Settings() {
  const { t, i18n } = useTranslation();
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);
  const [enableWebhookSync, setEnableWebhookSync] = useState(loaderData.enableWebhookSync);
  const [isSaving, setIsSaving] = useState(false);
  const [syncResults, setSyncResults] = useState(null);

  const isSyncing = navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "inventorySync";

  const languageOptions = [
    { label: t("settings.language.english"), value: "en" },
    { label: t("settings.language.vietnamese"), value: "vi" },
    { label: t("settings.language.japanese"), value: "ja" },
  ];

  useEffect(() => {
    if (actionData?.success) {
      if (actionData.webhook) {
        // Update state from server response
        setEnableWebhookSync(actionData.enableWebhookSync);
        shopify.toast.show(t("settings.webhook.saveSuccess"));
      } else if (actionData.inventorySync) {
        // Update sync results
        setSyncResults(actionData);
        shopify.toast.show(t("settings.inventorySync.successMessage"));
      } else {
        shopify.toast.show(t("settings.language.saveSuccess"));
      }
      setIsSaving(false);
    } else if (actionData && !actionData.success && actionData.inventorySync) {
      // Handle sync error
      setSyncResults(actionData);
      shopify.toast.show(t("settings.inventorySync.failureMessage"), { isError: true });
    }
  }, [actionData, shopify, t]);

  const handleLanguageChange = (value) => {
    setSelectedLanguage(value);
    i18n.changeLanguage(value);
    // Save to localStorage to persist across page refreshes
    localStorage.setItem("i18nextLng", value);
    // Save to server using Remix submit
    const formData = new FormData();
    formData.append("actionType", "language");
    formData.append("language", value);
    submit(formData, { method: "post" });
  };

  const handleWebhookToggle = () => {
    const newValue = !enableWebhookSync;
    setIsSaving(true);

    const formData = new FormData();
    formData.append("actionType", "webhook");
    formData.append("enableWebhookSync", newValue.toString());

    submit(formData, { method: "post" });
  };

  return (
    <Page
      title={t("settings.title")}
      backAction={{ content: t("common.orders"), url: "/app" }}
    >
      <TitleBar title={t("settings.title")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Webhook Setting */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    {t("settings.webhook.title")}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("settings.webhook.description")}
                  </Text>
                </BlockStack>

                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd">
                    {enableWebhookSync ? t("settings.webhook.enabled") : t("settings.webhook.disabled")}
                  </Text>
                  <Switch
                    checked={enableWebhookSync}
                    onChange={handleWebhookToggle}
                    disabled={isSaving}
                  />
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Inventory Sync Setting */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    {t("settings.inventorySync.title")}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("settings.inventorySync.description")}
                  </Text>
                </BlockStack>

                <Form method="post">
                  <input type="hidden" name="actionType" value="inventorySync" />
                  <Button
                    variant="primary"
                    submit
                    loading={isSyncing}
                    disabled={isSyncing}
                  >
                    {isSyncing ? t("settings.inventorySync.syncing") : t("settings.inventorySync.syncButton")}
                  </Button>
                </Form>

                {syncResults && (
                  <BlockStack gap="300">
                    {syncResults.success ? (
                      <Banner tone="success">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodyMd">
                            {t("settings.inventorySync.successMessage")}
                            {syncResults.results &&
                              syncResults.results.filter(r => r.wasActivated).length > 0 && (
                                <Text as="span" variant="bodyMd" tone="success">
                                  {" "}✨ {t("settings.inventorySync.activated")} {syncResults.results.filter(r => r.wasActivated).length} {t("settings.inventorySync.newLocations")}
                                </Text>
                              )}
                          </Text>
                          <InlineStack gap="200">
                            <Badge tone="success">
                              {t("settings.inventorySync.summary.success")}: {syncResults.summary.success}
                            </Badge>
                            <Badge tone="warning">
                              {t("settings.inventorySync.summary.skipped")}: {syncResults.summary.skipped}
                            </Badge>
                            {syncResults.summary.failed > 0 && (
                              <Badge tone="critical">
                                {t("settings.inventorySync.summary.failed")}: {syncResults.summary.failed}
                              </Badge>
                            )}
                            <Badge>
                              {t("settings.inventorySync.summary.duration")}: {syncResults.summary.duration}
                            </Badge>
                          </InlineStack>
                        </BlockStack>
                      </Banner>
                    ) : (
                      <Banner tone="critical">
                        <Text as="p" variant="bodyMd">
                          {t("settings.inventorySync.failureMessage")}: {syncResults.error}
                        </Text>
                      </Banner>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* Language Setting */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    {t("settings.language.title")}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("settings.language.description")}
                  </Text>
                </BlockStack>

                <Select
                  label={t("settings.language.title")}
                  options={languageOptions}
                  value={selectedLanguage}
                  onChange={handleLanguageChange}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
