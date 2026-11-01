/**
 * Schnittstelle für Podcast-Hosting (FTP, später z.B. Podigee, Spotify for Creators, S3 ...).
 * Alle Uploads (MP3, feed.xml) macht der Worker (apps/worker/src/hosts). Der Server nutzt nur
 * Aktionen ohne Datenverbindung: Verbindungstest und Löschen.
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
  publicUrl(config: HostConfig, fileName: string): string;
}
