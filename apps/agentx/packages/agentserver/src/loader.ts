import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Character,
  logger,
  parseAndValidateCharacter,
  validateCharacter,
} from '@elizaos/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Attempts to load a file from the given file path.
 *
 * @param {string} filePath - The path to the file to load.
 * @returns {string | null} The contents of the file as a string, or null if an error occurred.
 * @throws {Error} If an error occurs while loading the file.
 */
export function tryLoadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    // Only catch file not found errors, let other errors propagate
    if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw e;
  }
}

/**
 * Load characters from a specified URL and return them as an array of Character objects.
 * @param {string} url - The URL from which to load character data.
 * @returns {Promise<Character[]>} - A promise that resolves with an array of Character objects.
 */
export async function loadCharactersFromUrl(url: string): Promise<Character[]> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
  }

  const responseJson = await response.json();

  let characters: Character[] = [];
  if (Array.isArray(responseJson)) {
    characters = await Promise.all(responseJson.map((character) => jsonToCharacter(character)));
  } else {
    const character = await jsonToCharacter(responseJson);
    characters.push(character);
  }
  return characters;
}

/**
 * Converts a JSON object representing a character into a validated Character object with additional settings and secrets.
 *
 * @param {unknown} character - The input data representing a character.
 * @returns {Promise<Character>} - A Promise that resolves to a validated Character object.
 * @throws {Error} If character validation fails.
 */
export async function jsonToCharacter(character: unknown): Promise<Character> {
  // First validate the base character data
  const validationResult = validateCharacter(character);

  if (!validationResult.success) {
    const errorDetails = validationResult.error?.issues
      ? validationResult.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')
      : validationResult.error?.message || 'Unknown validation error';

    throw new Error(`Character validation failed: ${errorDetails}`);
  }

  // Type guard to ensure we have valid data
  if (!validationResult.data) {
    throw new Error('Validation succeeded but no data was returned');
  }

  const validatedCharacter = validationResult.data;

  // Add environment-based settings and secrets (preserve existing functionality)
  const characterId = validatedCharacter.id || validatedCharacter.name;
  const characterPrefix = `CHARACTER.${characterId.toUpperCase().replace(/ /g, '_')}.`;

  const characterSettings = Object.entries(process.env)
    .filter(([key]) => key.startsWith(characterPrefix))
    .reduce((settings, [key, value]) => {
      const settingKey = key.slice(characterPrefix.length);
      return { ...settings, [settingKey]: value };
    }, {});

  if (Object.keys(characterSettings).length > 0) {
    // Collect all secrets from various sources
    const combinedSecrets = {
      ...characterSettings,
      ...(validatedCharacter.secrets || {}),
      ...(typeof validatedCharacter.settings?.secrets === 'object' &&
      validatedCharacter.settings?.secrets !== null
        ? validatedCharacter.settings.secrets
        : {}),
    };

    const updatedCharacter: Character = {
      ...validatedCharacter,
    };

    if (validatedCharacter.settings || Object.keys(combinedSecrets).length > 0) {
      updatedCharacter.settings = validatedCharacter.settings || {};
    }

    if (Object.keys(combinedSecrets).length > 0) {
      updatedCharacter.secrets = combinedSecrets;
    }

    // Re-validate the updated character to ensure it's still valid
    const revalidationResult = validateCharacter(updatedCharacter);
    if (!revalidationResult.success) {
      throw new Error('Character became invalid after adding environment settings');
    }

    if (!revalidationResult.data) {
      throw new Error('Revalidation succeeded but no data returned');
    }

    return revalidationResult.data;
  }

  return validatedCharacter;
}

/**
 * Loads a character from the specified file path with safe JSON parsing and validation.
 *
 * @param {string} filePath - The path to the character file.
 * @returns {Promise<Character>} A Promise that resolves to the validated Character object.
 * @throws {Error} If the character file is not found, has invalid JSON, or fails validation.
 */
export async function loadCharacter(filePath: string): Promise<Character> {
  const content = tryLoadFile(filePath);
  if (!content) {
    throw new Error(`Character file not found: ${filePath}`);
  }

  // Use safe JSON parsing and validation
  const parseResult = parseAndValidateCharacter(content);

  if (!parseResult.success) {
    throw new Error(`Failed to load character from ${filePath}: ${parseResult.error?.message}`);
  }

  // Apply environment settings (this will also re-validate)
  return jsonToCharacter(parseResult.data!);
}

/**
 * Asynchronously loads a character from the specified path.
 * If the path is a URL, it loads the character from the URL.
 * If the path is a local file path, it tries multiple possible locations and
 * loads the character from the first valid location found.
 *
 * @param {string} characterPath - The path to load the character from.
 * @returns {Promise<Character>} A Promise that resolves to the loaded character.
 */
export async function loadCharacterTryPath(characterPath: string): Promise<Character> {
  if (characterPath.startsWith('http')) {
    const characters = await loadCharactersFromUrl(characterPath);
    if (!characters || characters.length === 0) {
      throw new Error('No characters found in the URL response');
    }
    return characters[0];
  }

  // Create path variants with and without .json extension
  const hasJsonExtension = characterPath.toLowerCase().endsWith('.json');
  const basePath = hasJsonExtension ? characterPath : characterPath;
  const jsonPath = hasJsonExtension ? characterPath : `${characterPath}.json`;

  const basePathsToTry = [
    basePath,
    path.resolve(process.cwd(), basePath),
    path.resolve(process.cwd(), '..', '..', basePath),
    path.resolve(process.cwd(), '..', '..', '..', basePath),
    path.resolve(process.cwd(), 'agent', basePath),
    path.resolve(__dirname, basePath),
    path.resolve(__dirname, 'characters', path.basename(basePath)),
    path.resolve(__dirname, '../characters', path.basename(basePath)),
    path.resolve(__dirname, '../../characters', path.basename(basePath)),
    path.resolve(__dirname, '../../../characters', path.basename(basePath)),
  ];

  const jsonPathsToTry = hasJsonExtension
    ? []
    : [
        jsonPath,
        path.resolve(process.cwd(), jsonPath),
        path.resolve(process.cwd(), '..', '..', jsonPath),
        path.resolve(process.cwd(), '..', '..', '..', jsonPath),
        path.resolve(process.cwd(), 'agent', jsonPath),
        path.resolve(__dirname, jsonPath),
        path.resolve(__dirname, 'characters', path.basename(jsonPath)),
        path.resolve(__dirname, '../characters', path.basename(jsonPath)),
        path.resolve(__dirname, '../../characters', path.basename(jsonPath)),
        path.resolve(__dirname, '../../../characters', path.basename(jsonPath)),
      ];

  // Combine the paths to try both variants
  const pathsToTry = Array.from(new Set([...basePathsToTry, ...jsonPathsToTry]));

  for (const tryPath of pathsToTry) {
    const content = tryLoadFile(tryPath);
    if (content !== null) {
      try {
        return await loadCharacter(tryPath);
      } catch (e) {
        // If it's a validation/parsing error, throw immediately (fail fast)
        // Only continue if it's a file not found error
        if (
          !(e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT')
        ) {
          throw e;
        }
      }
    }
  }

  // If we get here, all paths failed
  throw new Error(`Character not found at ${characterPath}. Tried ${pathsToTry.length} locations.`);
}

/**
 * Converts a comma-separated string to an array of strings.
 *
 * @param {string} commaSeparated - The input comma-separated string.
 * @returns {string[]} An array of strings after splitting the input string by commas and trimming each value.
 */
function commaSeparatedStringToArray(commaSeparated: string): string[] {
  return commaSeparated?.split(',').map((value) => value.trim());
}

/**
 * Asynchronously reads character files from the storage directory and pushes their paths to the characterPaths array.
 * @param {string[]} characterPaths - An array of paths where the character files will be stored.
 * @returns {Promise<string[]>} - A promise that resolves with an updated array of characterPaths.
 */
async function readCharactersFromStorage(characterPaths: string[]): Promise<string[]> {
  const uploadDir = path.join(process.cwd(), '.eliza', 'data', 'characters');

  try {
    await fs.promises.mkdir(uploadDir, { recursive: true });
    const fileNames = await fs.promises.readdir(uploadDir);
    for (const fileName of fileNames) {
      characterPaths.push(path.join(uploadDir, fileName));
    }
  } catch (err) {
    // Only catch expected errors like directory not existing
    if (err instanceof Error && 'code' in err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT' || nodeErr.code === 'EACCES') {
        logger.error(`Cannot access character storage directory: ${nodeErr.message}`);
        // Return original characterPaths, don't fail the whole process
        return characterPaths;
      }
    }
    // Unexpected errors should propagate
    throw err;
  }

  return characterPaths;
}

export const hasValidRemoteUrls = () =>
  process.env.REMOTE_CHARACTER_URLS &&
  process.env.REMOTE_CHARACTER_URLS !== '' &&
  process.env.REMOTE_CHARACTER_URLS.startsWith('http');

/**
 * Load characters from local paths or remote URLs based on configuration.
 * @param charactersArg - A comma-separated list of local file paths or remote URLs to load characters from.
 * @returns A promise that resolves to an array of loaded characters.
 */
export async function loadCharacters(charactersArg: string): Promise<Character[]> {
  let characterPaths = commaSeparatedStringToArray(charactersArg);
  const loadedCharacters: Character[] = [];

  if (process.env.USE_CHARACTER_STORAGE === 'true') {
    characterPaths = await readCharactersFromStorage(characterPaths);
  }

  if (characterPaths?.length > 0) {
    for (const characterPath of characterPaths) {
      const character = await loadCharacterTryPath(characterPath);
      loadedCharacters.push(character);
    }
  }

  if (hasValidRemoteUrls()) {
    logger.info('Loading characters from remote URLs');
    const characterUrls = commaSeparatedStringToArray(process.env.REMOTE_CHARACTER_URLS! || '');
    for (const characterUrl of characterUrls) {
      const characters = await loadCharactersFromUrl(characterUrl);
      loadedCharacters.push(...characters);
    }
  }

  if (loadedCharacters.length === 0) {
    logger.info('No characters found, using default character');
    // Note: The server package doesn't have a default character like the CLI does
    // This should be provided by the consumer of the server package
    logger.warn('Server package does not include a default character. Please provide one.');
  }

  return loadedCharacters;
}
