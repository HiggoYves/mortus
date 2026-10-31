"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createCalendarEvent, deleteCalendarEvent, eventCategories, EVENT_STORAGE_KEY, findEventConflicts, updateCalendarEvent, validateEventTimeRange } from "./lib/events";
import type { CalendarEvent, EventCategory } from "./lib/events";
import { loadCalendarEvents, saveCalendarEvents } from "./lib/eventStorage";
import { createEventBackup, parseEventBackup } from "./lib/eventBackup";
import { demoEvents, separateDemoEvents } from "./lib/demoEvents";
import { parseLocalMigrationSource } from "./lib/localEventMigration";
import { containsEvents, createSqliteEvent, deleteSqliteEvent, EventApiClientError, fetchSqliteEvents, SQLITE_MODE_STORAGE_KEY, SQLITE_MODE_VALUE, updateSqliteEvent } from "./lib/eventApiClient";
import { importEventsToSqlite } from "./actions/eventMigration";

type MigrationPreview = { sourceEvents: CalendarEvent[]; eventsToMigrate: CalendarEvent[]; demoCount: number; sourceStorageText: string | null };

const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const categoryClass: Record<EventCategory, string> = { Trabalho: "work", Pessoal: "personal", Saúde: "health" };

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Home() {
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [events, setEvents] = useState(demoEvents);
  const [persistenceMode, setPersistenceMode] = useState<"local" | "sqlite">("local");
  const [storageReady, setStorageReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState<"empty" | "valid" | "invalid" | "unavailable">("empty");
  const [storageCanWrite, setStorageCanWrite] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDate, setDraftDate] = useState(selectedDate);
  const [draftEndDate, setDraftEndDate] = useState(selectedDate);
  const [draftStartTime, setDraftStartTime] = useState("09:00");
  const [draftEndTime, setDraftEndTime] = useState("10:00");
  const [draftCategory, setDraftCategory] = useState<EventCategory>("Pessoal");
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null);
  const [migrationBackupReady, setMigrationBackupReady] = useState(false);
  const [migrationBackupConfirmed, setMigrationBackupConfirmed] = useState(false);
  const operationInFlight = useRef(false);

  useEffect(() => {
    const result = loadCalendarEvents(() => window.localStorage, demoEvents);
    setEvents(result.events);
    setStorageStatus(result.status);
    setStorageCanWrite(result.canWrite);
    setStorageWarning(result.warning);
    setStorageReady(true);

    let savedMode: string | null = null;
    try {
      savedMode = window.localStorage.getItem(SQLITE_MODE_STORAGE_KEY);
    } catch {
      // The storage loader already reports whether browser storage is available.
    }
    if (savedMode === SQLITE_MODE_VALUE) {
      setPersistenceMode("sqlite");
      setStorageCanWrite(false);
      void fetchSqliteEvents().then((databaseEvents) => {
        setEvents(databaseEvents);
        setStorageStatus("valid");
        setStorageCanWrite(true);
        setStorageWarning(null);
      }).catch((error: unknown) => {
        // Keep the loaded local copy visible in read-only mode; never replace it with an empty list.
        setStorageCanWrite(false);
        setStorageWarning(error instanceof Error
          ? `SQLite indisponível. A cópia local está preservada e as alterações foram bloqueadas. ${error.message}`
          : "SQLite indisponível. A cópia local está preservada e as alterações foram bloqueadas.");
      });
    }
  }, []);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((mondayOffset + count) / 7) * 7 }, (_, index) => {
      const day = index - mondayOffset + 1;
      return new Date(month.getFullYear(), month.getMonth(), day);
    });
  }, [month]);
  const selectedEvents = events.filter((event) => event.date <= selectedDate && event.endDate >= selectedDate).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const selectedConflicts = findEventConflicts(selectedEvents);
  const readableDate = new Date(`${selectedDate}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const todayKey = dateKey(new Date());
  const localEventsForMigration = storageStatus === "valid" ? separateDemoEvents(events) : { events: [], demoCount: demoEvents.length };

  function shiftMonth(amount: number) {
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setMonth(nextMonth);
    setSelectedDate(dateKey(nextMonth));
  }

  function openCreateForm() {
    setEditingEventId(null);
    setDraftTitle("");
    setDraftDate(selectedDate);
    setDraftEndDate(selectedDate);
    setDraftStartTime("09:00");
    setDraftEndTime("10:00");
    setDraftCategory("Pessoal");
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(event: CalendarEvent) {
    setEditingEventId(event.id);
    setDraftTitle(event.title);
    setDraftDate(event.date);
    setDraftEndDate(event.endDate);
    setDraftStartTime(event.startTime);
    setDraftEndTime(event.endTime);
    setDraftCategory(event.category);
    setFormError(null);
    setShowForm(true);
  }

  function saveEvents(nextEvents: CalendarEvent[]) {
    if (!storageCanWrite) {
      setStorageWarning("A gravação está bloqueada para proteger os dados atuais. Resolva o aviso do armazenamento ou importe um backup confirmado.");
      return false;
    }
    if (saveCalendarEvents(() => window.localStorage, nextEvents)) {
      setEvents(nextEvents);
      setStorageWarning(null);
      return true;
    } else {
      window.alert("Não foi possível salvar. Verifique o espaço disponível no navegador e tente novamente.");
      setStorageWarning("A gravação falhou. Os dados exibidos anteriormente foram mantidos; libere espaço no navegador e tente novamente.");
      return false;
    }
  }

  async function resyncSqliteAfterFailure() {
    if (persistenceMode !== "sqlite") return;
    setStorageCanWrite(false);
    try {
      const latestEvents = await fetchSqliteEvents();
      setEvents(latestEvents);
      setStorageCanWrite(true);
    } catch {
      // Keep the last known list visible and disable writes until the server responds again.
    }
  }

  function exportBackup(sourceEvents: CalendarEvent[] = events): boolean {
    try {
      const contents = createEventBackup(sourceEvents);
      const blob = new Blob([contents], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mortus-backup-${dateKey(new Date())}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStorageWarning(null);
      return true;
    } catch (error) {
      console.error("Não foi possível exportar o backup.", error);
      setStorageWarning(error instanceof Error ? `Falha na exportação: ${error.message}` : "Não foi possível exportar o backup.");
      return false;
    }
  }

  async function importBackup(file: File | undefined) {
    if (!file || operationInFlight.current) return;
    try {
      const backup = parseEventBackup(await file.text());
      const actionLabel = persistenceMode === "sqlite"
        ? "Adicionar os eventos ao SQLite sem sobrescrever registros existentes"
        : "Substituir os eventos atuais do navegador";
      const confirmed = window.confirm(`O backup contém ${backup.events.length} evento(s). ${actionLabel}?`);
      if (!confirmed) return;
      operationInFlight.current = true;
      setIsBusy(true);
      if (persistenceMode === "sqlite") {
        const result = await importEventsToSqlite(backup.events);
        if (!result.ok) {
          setStorageWarning(result.reason === "conflict"
            ? `Backup não importado: ${result.summary?.conflicts ?? 0} conflito(s) de ID. Nenhum evento foi sobrescrito; revise os dados e tente novamente.`
            : "Não foi possível importar o backup no SQLite. Os dados locais e o backup foram preservados.");
          return;
        }
        const databaseEvents = await fetchSqliteEvents();
        if (!containsEvents(databaseEvents, backup.events)) {
          setStorageWarning("A conferência do banco não corresponde ao backup. A cópia local foi mantida.");
          return;
        }
        setEvents(databaseEvents);
        setStorageWarning(`Backup conferido: ${result.summary.imported} importado(s), ${result.summary.alreadyExisting} já existente(s).`);
        return;
      }
      if (!saveCalendarEvents(() => window.localStorage, backup.events)) {
        setStorageWarning("A importação não foi gravada. Os dados atuais foram mantidos; verifique o espaço e as permissões do navegador.");
        return;
      }
      setEvents(backup.events);
      setStorageStatus("valid");
      setStorageCanWrite(true);
      setStorageWarning(`Backup importado: ${backup.events.length} evento(s).`);
    } catch (error) {
      await resyncSqliteAfterFailure();
      console.error("Não foi possível importar o backup.", error);
      setStorageWarning(error instanceof Error ? `Falha na importação: ${error.message}` : "Não foi possível importar o backup.");
    } finally {
      operationInFlight.current = false;
      setIsBusy(false);
    }
  }

  function prepareMigration() {
    if (persistenceMode !== "local" || operationInFlight.current) return;
    try {
      const sourceStorageText = window.localStorage.getItem(EVENT_STORAGE_KEY);
      const preview = parseLocalMigrationSource(sourceStorageText);
      if (preview === null) {
        setMigrationPreview(null);
        setStorageWarning("Os eventos do navegador são inválidos. Nenhuma migração foi iniciada; preserve o conteúdo e recupere um backup válido.");
        return;
      }
      setMigrationPreview({ ...preview, sourceStorageText });
      setMigrationBackupReady(false);
      setMigrationBackupConfirmed(false);
      setStorageWarning(null);
    } catch {
      setMigrationPreview(null);
      setStorageWarning("Não foi possível ler o armazenamento do navegador. Nenhuma migração foi iniciada.");
    }
  }

  async function migrateToSqlite() {
    if (!migrationPreview || !migrationBackupReady || !migrationBackupConfirmed || operationInFlight.current) return;
    let currentStorageText: string | null;
    try {
      currentStorageText = window.localStorage.getItem(EVENT_STORAGE_KEY);
    } catch {
      setStorageWarning("Não foi possível reler o localStorage; a migração foi cancelada sem alterações.");
      return;
    }
    if (currentStorageText !== migrationPreview.sourceStorageText) {
      setMigrationPreview(null);
      setMigrationBackupReady(false);
      setMigrationBackupConfirmed(false);
      setStorageWarning("O localStorage mudou desde a prévia. Nenhuma migração foi iniciada; prepare novamente o resumo e o backup.");
      return;
    }
    if (!window.confirm(`Migrar ${migrationPreview.eventsToMigrate.length} evento(s) para SQLite? O localStorage será mantido como cópia de recuperação.`)) return;
    try {
      if (window.localStorage.getItem(EVENT_STORAGE_KEY) !== migrationPreview.sourceStorageText) {
        setMigrationPreview(null);
        setMigrationBackupReady(false);
        setMigrationBackupConfirmed(false);
        setStorageWarning("O localStorage mudou durante a confirmação. Nenhuma importação foi iniciada; prepare novamente a prévia e o backup.");
        return;
      }
    } catch {
      setStorageWarning("Não foi possível conferir o localStorage após a confirmação; a migração foi cancelada.");
      return;
    }
    operationInFlight.current = true;
    setIsBusy(true);
    setStorageCanWrite(false);
    try {
      const result = await importEventsToSqlite(migrationPreview.eventsToMigrate);
      if (!result.ok) {
        setStorageCanWrite(true);
        setStorageWarning(result.reason === "conflict"
          ? `Migração interrompida: ${result.summary?.conflicts ?? 0} conflito(s) de ID. Nenhum dado foi sobrescrito; resolva os conflitos antes de tentar novamente.`
          : result.reason === "invalid"
            ? "A validação rejeitou a lista. SQLite e armazenamento local foram mantidos sem alteração."
            : "Não foi possível concluir a migração. O armazenamento local foi mantido; confira o banco antes de repetir.");
        return;
      }

      const databaseEvents = await fetchSqliteEvents();
      if (!containsEvents(databaseEvents, migrationPreview.eventsToMigrate)) {
        setStorageCanWrite(true);
        setStorageWarning("A conferência após a importação falhou. O modo local foi mantido e nenhuma cópia foi apagada.");
        return;
      }

      if (window.localStorage.getItem(EVENT_STORAGE_KEY) !== migrationPreview.sourceStorageText) {
        setStorageCanWrite(true);
        setStorageWarning("O localStorage mudou durante a importação. Os dados importados estão no SQLite, mas o modo local foi mantido; atualize a prévia antes de tentar novamente.");
        return;
      }

      window.localStorage.setItem(SQLITE_MODE_STORAGE_KEY, SQLITE_MODE_VALUE);
      setPersistenceMode("sqlite");
      setEvents(databaseEvents);
      setStorageStatus("valid");
      setStorageCanWrite(true);
      setMigrationPreview(null);
      setStorageWarning(`Migração conferida: ${result.summary.imported} importado(s), ${result.summary.alreadyExisting} já existente(s). A cópia do navegador foi mantida.`);
    } catch (error) {
      setStorageCanWrite(true);
      setStorageWarning(error instanceof Error
        ? `Migração não concluída: ${error.message} O localStorage foi mantido; a operação pode ser repetida com segurança.`
        : "Migração não concluída. O localStorage foi mantido; a operação pode ser repetida com segurança.");
    } finally {
      operationInFlight.current = false;
      setIsBusy(false);
    }
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storageReady || operationInFlight.current) return;
    const title = draftTitle.trim();
    if (!title || !draftDate || !draftStartTime || !draftEndTime) return;
    const timeRangeError = validateEventTimeRange(draftDate, draftStartTime, draftEndDate, draftEndTime);
    if (timeRangeError) {
      setFormError(timeRangeError);
      return;
    }
    setFormError(null);

    const eventDraft = {
      title,
      date: draftDate,
      endDate: draftEndDate,
      startTime: draftStartTime,
      endTime: draftEndTime,
      category: draftCategory,
    };
    operationInFlight.current = true;
    setIsBusy(true);
    try {
      if (persistenceMode === "sqlite") {
        const saved = editingEventId === null
          ? await createSqliteEvent(eventDraft)
          : await updateSqliteEvent(editingEventId, eventDraft);
        setEvents((current) => editingEventId === null
          ? [...current, saved]
          : current.map((item) => item.id === editingEventId ? saved : item));
      } else {
        const nextEvents = editingEventId === null
          ? createCalendarEvent(events, eventDraft)
          : updateCalendarEvent(events, editingEventId, eventDraft);
        if (!saveEvents(nextEvents)) return;
      }
      setStorageWarning(null);
      setSelectedDate(draftDate);
      const eventDate = new Date(`${draftDate}T12:00:00`);
      setMonth(new Date(eventDate.getFullYear(), eventDate.getMonth(), 1));
      setDraftTitle("");
      setEditingEventId(null);
      setShowForm(false);
    } catch (error) {
      await resyncSqliteAfterFailure();
      setStorageWarning(error instanceof EventApiClientError
        ? error.message
        : "Não foi possível salvar no SQLite. O evento exibido foi mantido sem alteração.");
    } finally {
      operationInFlight.current = false;
      setIsBusy(false);
    }
  }

  async function deleteEvent(event: CalendarEvent) {
    if (!storageReady || operationInFlight.current) return;
    if (!window.confirm(`Excluir o evento "${event.title}"?`)) return;
    operationInFlight.current = true;
    setIsBusy(true);
    try {
      if (persistenceMode === "sqlite") {
        await deleteSqliteEvent(event.id);
        setEvents((current) => deleteCalendarEvent(current, event.id));
      } else {
        saveEvents(deleteCalendarEvent(events, event.id));
      }
      setStorageWarning(null);
    } catch (error) {
      await resyncSqliteAfterFailure();
      setStorageWarning(error instanceof EventApiClientError
        ? error.message
        : "Não foi possível excluir no SQLite. O evento foi mantido na lista.");
    } finally {
      operationInFlight.current = false;
      setIsBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#inicio" aria-label="Mortus, início"><span className="brand-mark">m</span><span>mortus</span></a>
        <div className="side-label">MENU</div>
        <button className="nav-item active"><span className="nav-icon">▦</span> Calendário</button>
        <button className="nav-item" disabled={!storageReady || !storageCanWrite || isBusy} onClick={openCreateForm}><span className="nav-icon">＋</span> Novo evento</button>
        <div className="side-label side-label-spaced">SEUS CALENDÁRIOS</div>
        <div className="calendar-filter"><i className="dot purple" /> Pessoal <span className="check">✓</span></div>
        <div className="calendar-filter"><i className="dot blue" /> Trabalho <span className="check">✓</span></div>
        <div className="calendar-filter"><i className="dot green" /> Saúde <span className="check">✓</span></div>
        <div className="sidebar-bottom"><div className="avatar">M</div><div><strong>Meu espaço</strong><small>Calendário pessoal</small></div><span className="more">•••</span></div>
      </aside>

      <section className="workspace" id="inicio">
        <header className="topbar"><div className="breadcrumb">Meu espaço <span>/</span> <strong>Calendário</strong></div><div className="top-actions"><button className="icon-button" aria-label="Pesquisar">⌕</button><button className="icon-button notification" aria-label="Notificações">♧</button><div className="avatar small-avatar">M</div></div></header>
        <div className="content">
          <div className="page-heading"><div><div className="eyebrow">SEU TEMPO, NO SEU RITMO</div><h1>Calendário</h1><p>Um lugar tranquilo para organizar o que importa.</p></div><button className="primary-button" disabled={!storageReady || !storageCanWrite || isBusy} onClick={openCreateForm}><span>＋</span> Novo evento</button></div>
          <div className="calendar-card">
            <div className="calendar-toolbar"><div className="month-title"><h2>{monthNames[month.getMonth()]}</h2><span>{month.getFullYear()}</span></div><div className="calendar-controls"><button className="today-button" onClick={() => { const today = new Date(); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(dateKey(today)); }}>Hoje</button><button className="arrow-button" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">‹</button><button className="arrow-button" onClick={() => shiftMonth(1)} aria-label="Próximo mês">›</button><div className="view-select">Mês <span>⌄</span></div></div></div>
            <div className="month-grid">
              {weekdays.map((day) => <div className="weekday" key={day}>{day}</div>)}
              {days.map((day) => {
                const key = dateKey(day);
                const inMonth = day.getMonth() === month.getMonth();
                const dayEvents = events.filter((event) => event.date <= key && event.endDate >= key);
                return <button className={`day-cell ${inMonth ? "" : "outside"} ${selectedDate === key ? "selected" : ""}`} key={key} onClick={() => { setSelectedDate(key); if (!inMonth) setMonth(new Date(day.getFullYear(), day.getMonth(), 1)); }}>
                  <span className={`day-number ${key === todayKey ? "today-number" : ""}`}>{day.getDate()}</span>
                  <span className="day-events">{dayEvents.slice(0, 2).map((event) => <span className={`event-chip ${categoryClass[event.category]}`} key={event.id}><b />{event.title}</span>)}{dayEvents.length > 2 && <span className="more-events">+{dayEvents.length - 2} eventos</span>}</span>
                </button>;
              })}
            </div>
          </div>

          {persistenceMode === "local" && (storageStatus === "empty" || storageStatus === "valid") && <section className="migration-card" aria-labelledby="migration-title">
            <div>
              <div className="eyebrow">PERSISTÊNCIA</div>
              <h2 id="migration-title">Migrar eventos para SQLite</h2>
              <p>Eventos locais detectados: <strong>{localEventsForMigration.events.length}</strong>. Demonstrações reconhecidas e excluídas da migração: <strong>{localEventsForMigration.demoCount}</strong>.</p>
              <p>O backup e o localStorage serão mantidos. A troca para SQLite só acontece depois de confirmar e conferir a importação.</p>
            </div>
            {!migrationPreview ? <button className="text-button" type="button" disabled={!storageReady || isBusy} onClick={prepareMigration}>Preparar migração</button> : <div className="migration-actions">
              <p>Prévia lida novamente do navegador: <strong>{migrationPreview.eventsToMigrate.length}</strong> evento(s) serão importados. O backup abrangerá os {migrationPreview.sourceEvents.length} registros originais, inclusive demonstrações.</p>
              <button className="text-button" type="button" disabled={isBusy} onClick={() => setMigrationBackupReady(exportBackup(migrationPreview.sourceEvents))}>Baixar backup JSON v1</button>
              {migrationBackupReady && <label className="migration-check"><input type="checkbox" checked={migrationBackupConfirmed} onChange={(event) => setMigrationBackupConfirmed(event.target.checked)} /> Salvei o backup e conferi a quantidade de eventos.</label>}
              <button className="primary-button" type="button" disabled={!migrationBackupReady || !migrationBackupConfirmed || isBusy} onClick={() => { void migrateToSqlite(); }}>Confirmar e migrar {migrationPreview.eventsToMigrate.length} evento(s)</button>
              <button className="cancel-button" type="button" disabled={isBusy} onClick={() => setMigrationPreview(null)}>Cancelar</button>
            </div>}
          </section>}
          {persistenceMode === "sqlite" && <div className="persistence-status" role="status">Persistência SQLite ativa. O localStorage é o retrato anterior à migração e não acompanha as alterações futuras; use “Exportar backup” para recuperar o estado mais recente.</div>}

          <section className="agenda-card"><div className="agenda-heading"><div><div className="eyebrow">SUA AGENDA</div><h2>{readableDate}</h2></div><button className="text-button" disabled={!storageReady || !storageCanWrite || isBusy} onClick={openCreateForm}>＋ Adicionar</button></div>
            {showForm && <form className="event-form" onSubmit={saveEvent}>
              <label>Nome do evento<input autoFocus required maxLength={120} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Ex.: revisar suas metas" /></label>
              <label>Data<input required type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} /></label>
              <label>Início<input required type="time" value={draftStartTime} onChange={(event) => { setDraftStartTime(event.target.value); setFormError(null); }} /></label>
              <label>Data de término<input required type="date" value={draftEndDate} onChange={(event) => { setDraftEndDate(event.target.value); setFormError(null); }} /></label>
              <label>Término<input required type="time" value={draftEndTime} onChange={(event) => { setDraftEndTime(event.target.value); setFormError(null); }} /></label>
              <label>Categoria<select value={draftCategory} onChange={(event) => setDraftCategory(event.target.value as EventCategory)}>{eventCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              {formError && <p className="event-form-error" role="alert">{formError}</p>}
              <button className="primary-button" type="submit" disabled={isBusy}>{editingEventId === null ? "Salvar evento" : "Salvar alterações"}</button>
              <button className="cancel-button" type="button" onClick={() => { setShowForm(false); setEditingEventId(null); }}>Cancelar</button>
            </form>}
            {selectedConflicts.length > 0 && <div className="conflict-warning" role="status"><strong>Há conflitos de horário nesta data:</strong><ul>{selectedConflicts.map(({ first, second }) => <li key={`${first.id}-${second.id}`}>{first.title} ({first.startTime}–{first.endTime}) e {second.title} ({second.startTime}–{second.endTime})</li>)}</ul><p>Os eventos foram mantidos. Você pode editá-los se desejar.</p></div>}
            {selectedEvents.length ? <div className="event-list">{selectedEvents.map((event) => <article className="agenda-event" key={event.id}><div className={`event-marker ${categoryClass[event.category]}`} /><time>{event.startTime}–{event.endTime}{event.endDate !== event.date ? ` (+${event.endDate})` : ""}</time><div className="agenda-event-copy"><strong>{event.title}</strong><span>{event.category}{event.date !== selectedDate ? " · continua do dia anterior" : ""}</span></div><div className="event-actions"><button className="event-action" type="button" disabled={!storageReady || !storageCanWrite || isBusy} onClick={() => openEditForm(event)} aria-label={`Editar ${event.title}`}>Editar</button><button className="event-action delete-action" type="button" disabled={!storageReady || !storageCanWrite || isBusy} onClick={() => deleteEvent(event)} aria-label={`Excluir ${event.title}`}>Excluir</button></div></article>)}</div> : !showForm && <div className="empty-state"><span>✳</span><div><strong>Dia livre por enquanto</strong><p>Adicione um evento quando quiser.</p></div></div>}
          </section>
          <div className="backup-controls">
            <button className="text-button" type="button" disabled={!storageReady || isBusy || (persistenceMode === "sqlite" && !storageCanWrite) || (storageStatus !== "empty" && storageStatus !== "valid")} onClick={() => { exportBackup(); }}>Exportar backup</button>
            <label className="text-button backup-import">Importar backup<input type="file" accept="application/json,.json" disabled={!storageReady || isBusy} onChange={(event) => { void importBackup(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          </div>
          {storageWarning && <div className="storage-warning" role="status">{storageWarning}</div>}
          <div className="prototype-note"><span>✦</span> {persistenceMode === "sqlite" ? "Seus eventos são salvos no SQLite; a cópia local do navegador foi preservada." : "Seus eventos são salvos neste navegador."}</div>
        </div>
      </section>
    </main>
  );
}
