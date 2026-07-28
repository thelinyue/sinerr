import { type AvailableLocale } from '@server/types/languages';
import React from 'react';

type AvailableLanguageObject = Record<
  string,
  { code: AvailableLocale; display: string }
>;

export const availableLanguages: AvailableLanguageObject = {
  en: {
    code: 'en',
    display: 'English',
  },
  'zh-CN': {
    code: 'zh-CN',
    display: '简体中文',
  },
  'zh-TW': {
    code: 'zh-TW',
    display: '繁體中文',
  },
};

export interface LanguageContextProps {
  locale: AvailableLocale;
  children: (locale: string) => React.ReactNode;
  setLocale?: React.Dispatch<React.SetStateAction<AvailableLocale>>;
}

export const LanguageContext = React.createContext<
  Omit<LanguageContextProps, 'children'>
>({
  locale: 'zh-CN',
});
