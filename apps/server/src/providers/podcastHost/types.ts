/**
 * Schnittstelle für Podcast-Hosting (FTP, später z.B. Podigee, Spotify for Creators, S3 ...).
 * Der Upload der Audiodatei passiert im Worker (apps/worker/src/hosts), der Server verwaltet
 * Test, Löschen und optional den Feed-Upload.
 */

export interface HostField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox';
  /** Geheime Felder werden verschlüsselt gespeichert und nie an den Browser zurückgegeben */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
}

export type HostConfig = Record<string, any>;

export interface PodcastHostProvider {
  key: string;
  label: string;
  fields: HostField[];
  test(config: HostConfig, secrets: HostConfig): Promise<string>;
  deleteFile(config: HostConfig, secrets: HostConfig, fileName: string): Promise<void>;
  uploadText(config: HostConfig, secrets: HostConfig, fileName: string, content: string): Promise<void>;
  publicUrl(config: HostConfig, fileName: string): string;
}
