export const PATCH_SETTINGS_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'exp', label: 'Expression' },
  { id: 'ctrl', label: 'Footswitches' },
  { id: 'bulk', label: 'Bulk Apply' },
] as const;

export type PatchSettingsTab = (typeof PATCH_SETTINGS_TABS)[number]['id'];

export function isPatchSettingsTab(id: string): id is PatchSettingsTab {
  return PATCH_SETTINGS_TABS.some((tab) => tab.id === id);
}
