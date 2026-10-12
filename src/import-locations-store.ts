import { db, type LibraryDB } from './db';
import { DEFAULT_IMPORT_LOCATIONS, validateImportLocations } from './import-locations';
import { type ImportLocations } from './model';

export const IMPORT_LOCATIONS_KEY = 'importLocations';
export async function loadImportLocations(store: LibraryDB = db): Promise<ImportLocations> {
  const saved = await store.settings.get(IMPORT_LOCATIONS_KEY);
  if (saved) { try { return validateImportLocations(saved.value); } catch { /* Ignore invalid stored settings. */ } }
  return { ...DEFAULT_IMPORT_LOCATIONS };
}
export async function saveImportLocations(value: unknown, store: LibraryDB = db): Promise<ImportLocations> {
  const locations = validateImportLocations(value);
  await store.settings.put({ key: IMPORT_LOCATIONS_KEY, value: locations });
  return locations;
}
