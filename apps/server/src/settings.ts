import { z } from 'zod';
import { prisma } from './db.js';

/** Einstellungen pro Tool inkl. Standardwerte. Neues Tool -> Schema hier ergänzen. */
export const settingsSchemas = {
  planning: z.object({
    /** Welche Service Types / Kalender berücksichtigt werden (leer = alle) */
    sourceIds: z.array(z.string()).default([]),
  }),
  livestream: z.object({
    titleTemplate: z.string().default('{{event.title}} | {{event.date | date:"dd.MM.yyyy"}}'),
    descriptionTemplate: z
      .string()
      .default('{{event.seriesTitle}}\nPredigt: {{people.Pastor | default:"-"}}\n\n{{freitext}}'),
    /** Titel (oder Teil davon) des Plan-Items, das den Streamstart markiert. Leer = Gottesdienstbeginn */
    startItemTitle: z.string().default('Livestream'),
    startOffsetMinutes: z.coerce.number().default(0),
    privacy: z.enum(['public', 'unlisted', 'private']).default('public'),
    streamKeyId: z.string().default(''),
    /** Vorauswahl der Playlist beim Erstellen (kann pro Stream geändert werden) */
    playlistId: z.string().default(''),
    /** Bild-URL als Vorschlag für das Thumbnail, z.B. das Serienbild aus Planning Center */
    thumbnailTemplate: z.string().default('{{series.artwork}}'),
    autoStart: z.boolean().default(true),
    autoStop: z.boolean().default(true),
  }),
  podcast: z.object({
    titleTemplate: z.string().default('{{event.title}}'),
    speakerTemplate: z.string().default('{{people.Pastor | default:"Gemeinde"}}'),
    descriptionTemplate: z.string().default('Predigt vom {{event.date | date:"dd.MM.yyyy"}}\n{{items.Predigt.description | strip_html}}'),
    imageTemplate: z.string().default('{{series.artwork}}'),
    /** Bibelstelle, z.B. aus der Beschreibung des Predigt-Elements */
    scriptureTemplate: z.string().default(''),
    /** Audio-Einstellungen für den Worker */
    bitrate: z.enum(['64k', '96k', '128k', '192k']).default('96k'),
    mono: z.boolean().default(true),
    normalize: z.boolean().default(true),
    /** Angaben für den RSS-Feed */
    feed: z
      .object({
        title: z.string().default(''),
        description: z.string().default(''),
        author: z.string().default(''),
        email: z.string().default(''),
        language: z.string().default('de'),
        category: z.string().default('Religion & Spirituality'),
        imageUrl: z.string().default(''),
        websiteUrl: z.string().default(''),
        explicit: z.boolean().default(false),
      })
      .default({
        title: '',
        description: '',
        author: '',
        email: '',
        language: 'de',
        category: 'Religion & Spirituality',
        imageUrl: '',
        websiteUrl: '',
        explicit: false,
      }),
    /** Feed zusätzlich als feed.xml auf das Podcast-Hosting hochladen */
    uploadFeed: z.boolean().default(false),
  }),
  visitors: z.object({
    livestreamEnabled: z.boolean().default(false),
    livestreamMode: z.enum(['concurrent', 'views']).default('concurrent'),
  }),
};

export type SettingsKey = keyof typeof settingsSchemas;
export type Settings<K extends SettingsKey> = z.infer<(typeof settingsSchemas)[K]>;

export function isSettingsKey(key: string): key is SettingsKey {
  return key in settingsSchemas;
}

export async function getSettings<K extends SettingsKey>(tenantId: string, tool: K): Promise<Settings<K>> {
  const row = await prisma.toolSetting.findUnique({ where: { tenantId_tool: { tenantId, tool } } });
  const parsed = settingsSchemas[tool].safeParse(row?.data ?? {});
  return (parsed.success ? parsed.data : settingsSchemas[tool].parse({})) as Settings<K>;
}

export async function saveSettings<K extends SettingsKey>(tenantId: string, tool: K, input: unknown): Promise<Settings<K>> {
  const data = settingsSchemas[tool].parse(input) as Settings<K>;
  await prisma.toolSetting.upsert({
    where: { tenantId_tool: { tenantId, tool } },
    create: { tenantId, tool, data: data as object },
    update: { data: data as object },
  });
  return data;
}
