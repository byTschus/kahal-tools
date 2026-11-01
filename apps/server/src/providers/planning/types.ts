/**
 * Schnittstelle für Planungstools (Planning Center, später z.B. ChurchTools, Elvanto ...).
 * Ein neues Planungstool implementiert PlanningProvider + PlanningClient und wird in ./index.ts registriert.
 */

export interface PlanningTokens {
  accessToken: string;
  refreshToken?: string;
  /** Ablaufzeitpunkt (ms seit Epoch) */
  expiresAt?: number;
}

export interface PlanningIdentity {
  org: { externalId: string; name: string; timeZone?: string; avatarUrl?: string };
  person: { externalId: string; name: string; email?: string; avatarUrl?: string };
}

export interface PlanningPerson {
  externalId: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

/** z.B. ein "Service Type" in Planning Center */
export interface PlanningEventSource {
  id: string;
  name: string;
}

export interface PlanningEventSummary {
  /** Opake, provider-spezifische ID (bei PCO "serviceTypeId:planId") */
  id: string;
  title: string;
  subtitle?: string;
  sourceName?: string;
  startsAt: string | null;
  url?: string;
}

export interface PlanningItem {
  title: string;
  description?: string;
  /** Berechnete Startzeit (ISO), falls bestimmbar */
  startsAt: string | null;
  lengthSec: number;
}

export interface PlanningEventDetail extends PlanningEventSummary {
  items: PlanningItem[];
  /** Alle Felder als verschachteltes Objekt für die Template-Engine */
  variables: Record<string, unknown>;
}

export interface PlanningClient {
  getIdentity(): Promise<PlanningIdentity>;
  listEventSources(): Promise<PlanningEventSource[]>;
  listEvents(opts: { from?: Date; to?: Date; sourceIds?: string[]; order?: 'asc' | 'desc'; limit?: number }): Promise<PlanningEventSummary[]>;
  getEvent(id: string): Promise<PlanningEventDetail>;
  searchPeople(query: string): Promise<PlanningPerson[]>;
}

export interface PlanningProvider {
  key: string;
  label: string;
  isConfigured(): boolean;
  getAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<PlanningTokens>;
  refresh(tokens: PlanningTokens): Promise<PlanningTokens>;
  createClient(tokens: PlanningTokens): PlanningClient;
}
