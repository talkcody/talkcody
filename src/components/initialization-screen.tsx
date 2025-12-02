import { useMemo } from 'react';
import { detectBrowserLanguage, getLocale } from '@/locales';

interface InitializationScreenProps {
  error?: string | null;
}

export function InitializationScreen({ error }: InitializationScreenProps) {
  const t = useMemo(() => getLocale(detectBrowserLanguage()), []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-center max-w-md px-6">
          <div className="mb-4">
            <svg
              className="mx-auto h-12 w-12 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <title>Error Icon</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
            {t.Initialization.failed}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {t.Initialization.reload}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900">
      <div className="text-center">
        <div className="mb-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {t.Initialization.title}
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">{t.Initialization.description}</p>
      </div>
    </div>
  );
}
