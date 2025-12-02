import { Check, Globe } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale } from '@/hooks/use-locale';
import type { SupportedLocale } from '@/locales';

export function LanguageSettings() {
  const { locale, t, setLocale, supportedLocales } = useLocale();

  const handleLanguageChange = async (value: SupportedLocale) => {
    await setLocale(value);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          <CardTitle className="text-lg">{t.Settings.language.title}</CardTitle>
        </div>
        <CardDescription>{t.Settings.language.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {supportedLocales.map((lang) => (
            <button
              type="button"
              key={lang.code}
              className="flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent"
              onClick={() => handleLanguageChange(lang.code)}
            >
              <span className="font-medium">{lang.name}</span>
              {locale === lang.code && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
