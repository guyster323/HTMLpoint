export const UNSAFE_MARKER: string;
export const SAFE_MARKER: string;
export const SAFE_BLOCK: string;

export interface MultiUserNshPatchResult {
  status: 'patched' | 'already-safe';
  text: string;
  newline: '\n' | '\r\n';
}

export function defaultTemplatePath(root?: string): string;
export function patchMultiUserNsh(source: string): MultiUserNshPatchResult;
export function applyNsisMultiUserPatch(
  templatePath?: string
): MultiUserNshPatchResult & { templatePath: string };
