import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { i18n } from "@/lib/i18n";
import Image from "next/image";
import { Github } from "lucide-react";
import { CONFIG } from "./config";

export interface LayoutOptions {
  hideNavLinks?: boolean;
}

export function baseOptions(locale: string, options?: LayoutOptions): BaseLayoutProps {
  // Don't show locale prefix for default language when hideLocale is enabled
  const isDefaultLocale = locale === i18n.defaultLanguage;
  const prefix =
    isDefaultLocale && i18n.hideLocale === "default-locale" ? "" : `/${locale}`;

  return {
    nav: {
      title: (
        <div className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="TalkCody"
            width={24}
            height={24}
            className="h-6 w-auto dark:invert"
          />
          <span className="font-semibold">TalkCody</span>
        </div>
      ),
      url: prefix || "/",
    },
    links: options?.hideNavLinks
      ? [
          // Docs sidebar: only GitHub icon
          {
            type: "icon",
            icon: <Github className="size-4.5" />,
            text: "GitHub",
            label: "GitHub",
            url: CONFIG.github.repo,
            external: true,
          },
        ]
      : [
          {
            text: locale === "zh" ? "文档" : "Docs",
            url: `${prefix}/docs`,
          },
          {
            text: locale === "zh" ? "博客" : "Blog",
            url: `${prefix}/blog`,
          },
          {
            text: "GitHub",
            url: CONFIG.github.repo,
            external: true,
          },
          {
            text: "X",
            url: CONFIG.x,
            external: true,
          },
        ],
    i18n,
  };
}
