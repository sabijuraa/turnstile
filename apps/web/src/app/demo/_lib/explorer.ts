/** The slot that server built explorer templates carry. See network.ts. */
export const EXPLORER_SLOT = "{value}";

/** Fills an explorer template from DemoNetwork. Imports nothing, so it is cheap in the browser. */
export function explorerLink(template: string, value: string): string {
  return template.replace(EXPLORER_SLOT, encodeURIComponent(value));
}
