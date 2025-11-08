import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import vi from "./locales/vi.json";
import ja from "./locales/ja.json";

const resources = {
  en: { translation: en },
  vi: { translation: vi },
  ja: { translation: ja },
};

// Initialize i18n - same config for both server and client to avoid hydration issues
i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "vi",
    lng: "vi", // Always start with 'vi' on initial render
    interpolation: {
      escapeValue: false,
    },
  });

// On client-side, restore language from localStorage after hydration
if (typeof window !== "undefined") {
  const savedLanguage = localStorage.getItem("i18nextLng");
  if (savedLanguage && savedLanguage !== i18n.language) {
    i18n.changeLanguage(savedLanguage);
  }
}

export default i18n;
