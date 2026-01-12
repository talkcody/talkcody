import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { CONFIG } from "@/lib/config";
import { SiX } from '@icons-pack/react-simple-icons';

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: React.ReactNode;
}) {
  const { lang } = await params;
  const options = baseOptions(lang, { hideNavLinks: true });
  const links = [
    {
      type: "icon" as const,
      icon: <SiX/>,
      text: "X",
      label: "X",
      url: CONFIG.x,
      external: true,
    },
  ];

  return (
    <DocsLayout
      tree={source.pageTree[lang]}
      {...options}
      links={links}
      githubUrl={CONFIG.github.repo}
      themeSwitch={{ enabled: true }}
    >
      {children}
    </DocsLayout>
  );
}
