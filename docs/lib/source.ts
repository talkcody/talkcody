import { type InferPageType, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { icons } from "lucide-react";
import { createElement } from "react";
import { SiAnthropic, SiOpenai, SiTelegram } from "@icons-pack/react-simple-icons";
import { blog, docs } from "@/.source";
import { i18n } from "@/lib/i18n";
import { FeishuIcon } from "@/components/icons/feishu-icon";

// Custom icons mapping (brand icons from simple-icons)
const customIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  Anthropic: SiAnthropic,
  OpenAI: SiOpenai,
  Telegram: SiTelegram,
  Feishu: FeishuIcon,
};

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: "/docs",
  i18n,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
  pageTree: {
    transformers: [
      {
        file(node, filePath) {
          if (!filePath) return node;
          const page = this.storage.read(filePath);
          if (
            page?.format === "page" &&
            "sidebarTitle" in page.data &&
            page.data.sidebarTitle
          ) {
            return { ...node, name: page.data.sidebarTitle };
          }
          return node;
        },
      },
    ],
  },
  icon(icon) {
    if (!icon) {
      return;
    }
    // Check custom icons first (brand icons)
    if (icon in customIcons) {
      return createElement(customIcons[icon], { size: 16 });
    }
    // Fall back to lucide icons
    if (icon in icons) {
      return createElement(icons[icon as keyof typeof icons]);
    }
  },
});

// Blog source loader
export const blogSource = loader({
  baseUrl: "/blog",
  i18n,
  source: blog.toFumadocsSource(),
});

export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: `/og/docs/${segments.join("/")}`,
  };
}

export function getBlogImage(page: InferPageType<typeof blogSource>) {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: `/og/blog/${segments.join("/")}`,
  };
}

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title}

${processed}`;
}

// Get all blog posts sorted by date (newest first)
export function getBlogPosts(locale?: string) {
  const pages = locale ? blogSource.getPages(locale) : blogSource.getPages();
  return pages.sort((a, b) => {
    const dateA = new Date(a.data.date as string).getTime();
    const dateB = new Date(b.data.date as string).getTime();
    return dateB - dateA;
  });
}
