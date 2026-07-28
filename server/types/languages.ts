export const availableLocales = ['en', 'zh-CN', 'zh-TW'] as const;

export type AvailableLocale = (typeof availableLocales)[number];
