import { MatchContent } from "./types";
import { TagPatternType } from "../data/tags";
import path from "path";

/**
 * Preprocesses file paths for optimal matching
 * - Normalizes path separators
 * - Trims whitespace
 *
 * @param content The file path content string
 * @returns The preprocessed content string
 */
function preprocessFilePathContent(content: string): string {
  return path.normalize(content.trim()).replace(/\\/g, "/");
}

/**
 * Preprocesses text content (commit messages, PR titles, etc.)
 * - Trims whitespace
 *
 * @param content The text content string
 * @returns The preprocessed content string
 */
function preprocessTextContent(content: string): string {
  return content.trim();
}

/**
 * Preprocesses code content
 * - Trims whitespace
 * - Normalizes line endings
 *
 * @param content The code content string
 * @returns The preprocessed content string
 */
function preprocessCodeContent(content: string): string {
  return content.trim().replace(/\r\n/g, "\n");
}

/**
 * Preprocesses label content
 * - Trims whitespace
 * - Converts to lowercase
 *
 * @param content The label content string
 * @returns The preprocessed content string
 */
function preprocessLabelContent(content: string): string {
  return content.trim().toLowerCase();
}

/**
 * Preprocesses content based on its type.
 * Returns a new MatchContent object with the processed content string.
 *
 * @param content The content object to preprocess
 * @returns The preprocessed content object
 */
export function preprocessContent(content: MatchContent): MatchContent {
  let processedString: string;
  switch (content.contentType) {
    case TagPatternType.FILE_PATH:
      processedString = preprocessFilePathContent(content.content);
      break;
    case TagPatternType.COMMIT_MESSAGE:
    case TagPatternType.PR_TITLE:
    case TagPatternType.PR_DESCRIPTION:
    case TagPatternType.ISSUE_TITLE:
    case TagPatternType.ISSUE_BODY:
    case TagPatternType.COMMENT:
      processedString = preprocessTextContent(content.content);
      break;
    case TagPatternType.CODE_CONTENT:
      processedString = preprocessCodeContent(content.content);
      break;
    case TagPatternType.LABEL:
      processedString = preprocessLabelContent(content.content);
      break;
    // Add cases for other TagPatternType if they need specific preprocessing
    // e.g., PR_CLOSES_ISSUE, REACTION might not need string preprocessing
    default:
      processedString = content.content; // No preprocessing needed
      break;
  }
  return {
    ...content,
    content: processedString,
  };
}
