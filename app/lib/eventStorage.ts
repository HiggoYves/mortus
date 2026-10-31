import { EVENT_STORAGE_KEY, migrateCalendarEventList } from "./events.ts";
import type { CalendarEvent } from "./events.ts";

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type StorageLoadResult = {
  status: "empty" | "valid" | "invalid" | "unavailable";
  events: CalendarEvent[];
  warning: string | null;
  canWrite: boolean;
};

type StorageProvider = () => KeyValueStorage;

export function loadCalendarEvents(getStorage: StorageProvider, fallback: CalendarEvent[]): StorageLoadResult {
  try {
    const storage = getStorage();
    const savedEvents = storage.getItem(EVENT_STORAGE_KEY);
    if (savedEvents === null) return { status: "empty", events: fallback, warning: null, canWrite: true };

    let parsed: unknown;
    try {
      parsed = JSON.parse(savedEvents);
    } catch {
      return { status: "invalid", events: [], warning: "Os dados salvos não são um JSON válido. O conteúdo original foi preservado; exporte ou recupere os dados antes de continuar.", canWrite: false };
    }

    const migratedEvents = migrateCalendarEventList(parsed);
    if (migratedEvents === null) {
      return { status: "invalid", events: [], warning: "Os dados salvos têm uma estrutura incompatível ou eventos inválidos. O conteúdo original foi preservado e as gravações estão bloqueadas.", canWrite: false };
    }

    if (JSON.stringify(parsed) !== JSON.stringify(migratedEvents)) {
      try {
        storage.setItem(EVENT_STORAGE_KEY, JSON.stringify(migratedEvents));
      } catch (migrationError) {
        console.error("Não foi possível salvar a migração dos eventos; os dados originais foram mantidos.", migrationError);
        return { status: "valid", events: migratedEvents, warning: "Os eventos antigos foram lidos, mas a migração não pôde ser gravada. Os dados originais foram preservados; novas gravações estão bloqueadas.", canWrite: false };
      }
    }

    return { status: "valid", events: migratedEvents, warning: null, canWrite: true };
  } catch (error) {
    console.error("Não foi possível carregar os eventos salvos.", error);
    return { status: "unavailable", events: [], warning: "Não foi possível acessar o armazenamento deste navegador. Nenhuma gravação será permitida até que os dados possam ser lidos.", canWrite: false };
  }
}

export function saveCalendarEvents(getStorage: StorageProvider, events: CalendarEvent[]): boolean {
  try {
    getStorage().setItem(EVENT_STORAGE_KEY, JSON.stringify(events));
    return true;
  } catch (error) {
    console.error("Não foi possível salvar os eventos neste navegador.", error);
    return false;
  }
}
