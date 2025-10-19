/**
 * Decodes a base64 encoded string with proper UTF-8 handling
 * @param encodedString - The base64 encoded string to decode
 * @returns The decoded string with proper UTF-8 character support
 */
export function decodeBase64(encodedString: string): string {
  try {
    // First decode base64 to binary string
    const binaryString = atob(encodedString);

    // Convert binary string to Uint8Array
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Use TextDecoder to properly decode UTF-8 content
    const decodedContent = new TextDecoder().decode(bytes);
    return decodedContent;
  } catch (error) {
    throw new Error(
      `Failed to decode base64 string: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
