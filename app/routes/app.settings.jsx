import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Select,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const language = formData.get("language");

  // In a real app, you might save this to user preferences in DB
  return json({ success: true, language });
};

export default function Settings() {
  const { t, i18n } = useTranslation();
  const actionData = useActionData();
  const shopify = useAppBridge();

  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);

  const languageOptions = [
    { label: t("settings.language.english"), value: "en" },
    { label: t("settings.language.vietnamese"), value: "vi" },
    { label: t("settings.language.japanese"), value: "ja" },
  ];

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(t("settings.language.saveSuccess"));
    }
  }, [actionData, shopify, t]);

  const handleLanguageChange = (value) => {
    setSelectedLanguage(value);
    i18n.changeLanguage(value);
    // Optionally save to server
    const formData = new FormData();
    formData.append("language", value);
    fetch("/app/settings", {
      method: "POST",
      body: formData,
    });
  };

  return (
    <Page
      title={t("settings.title")}
      backAction={{ content: t("common.orders"), url: "/app" }}
    >
      <TitleBar title={t("settings.title")} />
      <Layout>
        <Layout.Section>
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
        </Layout.Section>
      </Layout>
    </Page>
  );
}
