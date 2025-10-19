import { useState, useCallback } from "react";

/**
 * POSIX-style fallback for browsers that still allow `execCommand("copy")`.
 * Creates a temporary textarea element, selects its content, and uses the legacy
 * execCommand API to copy text to the clipboard.
 *
 * @param text - The text to copy to the clipboard
 * @returns `true` if the copy operation succeeded, `false` otherwise
 */
function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Custom hook for copying text to the clipboard with fallback support.
 * Uses the modern Clipboard API when available, falling back to execCommand for older browsers.
 *
 * @returns A tuple containing:
 *   - `copied`: Boolean indicating if text was recently copied (auto-resets after 2 seconds)
 *   - `copyToClipboard`: Async function that copies the provided text to clipboard
 */
export function useCopyToClipboard(): [
  boolean,
  (text: string) => Promise<boolean>,
] {
  const [copied, setCopied] = useState<boolean>(false);

  const copyToClipboard = useCallback(async (text: string) => {
    let success = false;
    if (navigator?.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        success = true;
      } catch (err) {
        console.error("Failed to copy text: ", err);
        // Fallback to execCommand method when clipboard API fails
        success = fallbackCopy(text);
      }
    } else {
      // Clipboard API not supported, using fallback method
      success = fallbackCopy(text);
    }

    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    return success;
  }, []);

  return [copied, copyToClipboard];
}
