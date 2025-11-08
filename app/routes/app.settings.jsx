import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Select,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Switch } from "../components/Switch";

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
  const { session } = await authenticate.admin(request);
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

  return json({ success: false });
};

export default function Settings() {
  const { t, i18n } = useTranslation();
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const submit = useSubmit();

  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);
  const [enableWebhookSync, setEnableWebhookSync] = useState(loaderData.enableWebhookSync);
  const [isSaving, setIsSaving] = useState(false);

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
      } else {
        shopify.toast.show(t("settings.language.saveSuccess"));
      }
      setIsSaving(false);
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
