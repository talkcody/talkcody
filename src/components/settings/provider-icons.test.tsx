import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROVIDER_ICONS, ProviderIcon } from './provider-icons';

describe('ProviderIcon', () => {
  it('renders an icon for openai provider', () => {
    const { container } = render(<ProviderIcon providerId="openai" size={18} />);

    expect(PROVIDER_ICONS.openai).toBeDefined();
    expect(container.querySelector('svg, img')).not.toBeNull();
  });

  it('returns null for unknown provider', () => {
    const { container } = render(<ProviderIcon providerId="unknown-provider" />);
    expect(container.firstChild).toBeNull();
  });
});
