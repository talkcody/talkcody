import { Github} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { CONFIG } from "@/lib/config";

const translations = {
  en: {
    description:
      "Free and Open Source AI Coding Agent. Build faster with AI that respects your privacy and freedom.",
    documentation: "Documentation",
    blog: "Blog",
    github: "GitHub",
    legal: "Legal",
    community: "Community",
    quickStart: "Quick Start",
    downloads: "Downloads",
    changelog: "Changelog",
    examples: "Examples",
    viewOnGitHub: "View on GitHub",
    starOnGitHub: "Star on GitHub",
    contribute: "Contribute",
    support: "Support",
    features: "Features",
    privacy: "Privacy",
    security: "Security",
    terms: "Terms",
    githubLabel: "GitHub",
    xLabel: "X",
    openSource: "Open Source",
    allRightsReserved: "All rights reserved.",
    builtWith: "Built with",
    and: "and",
  },
  zh: {
    description: "免费开源的 AI 编码助手。使用尊重您隐私和自由的 AI 更快地构建。",
    documentation: "文档",
    blog: "博客",
    github: "GitHub",
    legal: "法律",
    community: "社区",
    quickStart: "快速开始",
    downloads: "下载",
    changelog: "更新日志",
    examples: "示例",
    viewOnGitHub: "在 GitHub 上查看",
    starOnGitHub: "在 GitHub 上 Star",
    contribute: "贡献",
    support: "支持",
    features: "功能",
    privacy: "隐私",
    security: "安全",
    terms: "条款",
    githubLabel: "GitHub",
    xLabel: "X",
    openSource: "开源",
    allRightsReserved: "保留所有权利。",
    builtWith: "使用",
    and: "和",
  },
};

export function Footer({ lang }: { lang: string }) {
  const locale = (lang in translations ? lang : "en") as keyof typeof translations;
  const t = translations[locale];

  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="container py-12 lg:py-16">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-12">
          {/* Brand section */}
          <div className="space-y-4 lg:col-span-4">
            <div className="flex items-center gap-2">
              <Image
                src="/logo.svg"
                alt="TalkCody Logo"
                width={24}
                height={24}
                className="h-6 w-auto dark:invert"
              />
              <h3 className="text-lg font-bold">TalkCody</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t.description}
            </p>
            <div className="flex items-center gap-4 pt-2">
              <a
                href={CONFIG.github.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-4 w-4" />
                <span>{t.starOnGitHub}</span>
              </a>
            </div>
          </div>

          {/* Links sections */}
          <div className="grid grid-cols-2 gap-6 lg:col-span-8 lg:grid-cols-3">
            {/* Documentation */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                {/* <BookOpen className="h-4 w-4" /> */}
                {t.documentation}
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <Link
                    href={`/${locale}/docs`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t.quickStart}
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/${locale}/docs/introduction/client-downloads`}
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                  >
                    {/* <Download className="h-3 w-3" /> */}
                    {t.downloads}
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/${locale}/docs/changelog`}
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                  >
                    {/* <Code className="h-3 w-3" /> */}
                    {t.changelog}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                {/* <FileText className="h-4 w-4" /> */}
                {t.legal}
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <Link
                    href={`/${locale}/privacy`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t.privacy}
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/${locale}/terms`}
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                  >
                    {/* <Shield className="h-3 w-3" /> */}
                    {t.terms}
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                {t.community}
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <a
                    href={CONFIG.github.repo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                  >
                    {t.githubLabel}
                  </a>
                </li>
                <li>
                  <a
                    href={CONFIG.x}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t.xLabel}
                  </a>
                </li>
                <li>
                  <Link
                    href={`/${locale}/docs`}
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                  >
                    {t.support}
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-8 border-t flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} TalkCody. {t.allRightsReserved}
          </p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t.builtWith}</span>
            <a
              href="https://github.com/talkcody/talkcody"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              {t.openSource}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
