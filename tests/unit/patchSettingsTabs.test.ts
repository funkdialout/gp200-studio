import { describe, expect, it } from 'vitest';
import { PATCH_SETTINGS_TABS, isPatchSettingsTab } from '@/components/patchSettingsTabs';

describe('Patch Settings tabs', () => {
  it('allows every displayed tab to be selected, including Details', () => {
    expect(PATCH_SETTINGS_TABS.map((tab) => tab.id)).toEqual(['details', 'exp', 'ctrl', 'bulk']);
    for (const tab of PATCH_SETTINGS_TABS) expect(isPatchSettingsTab(tab.id)).toBe(true);
    expect(isPatchSettingsTab('unknown')).toBe(false);
  });
});
