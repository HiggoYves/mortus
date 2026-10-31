"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createCalendarEvent, deleteCalendarEvent, eventCategories, findEventConflicts, updateCalendarEvent, validateEventTimeRange } from "./lib/events";
import type { CalendarEvent, EventCategory } from "./lib/events";
import { loadCalendarEvents, saveCalendarEvents } from "./lib/eventStorage";
import { createEventBackup, parseEventBackup } from "./lib/eventBackup";

const initialEvents: CalendarEvent[] = [
  { id: 1, title: "Revisão do projeto", date: "2026-10-29", endDate: "2026-10-29", startTime: "09:30", endTime: "10:30", category: "Trabalho" },
  { id: 2, title: "Pausa para almoço", date: "2026-10-29", endDate: "2026-10-29", startTime: "12:30", endTime: "13:30", category: "Pessoal" },
  { id: 3, title: "Consulta de rotina", date: "2026-10-30", endDate: "2026-10-30", startTime: "15:00", endTime: "16:00", category: "Saúde" },
  { id: 4, title: "Planejar a próxima semana", date: "2026-11-02", endDate: "2026-11-02", startTime: "10:00", endTime: "11:00", category: "Pessoal" },
];

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
  const [events, setEvents] = useState(initialEvents);
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

  useEffect(() => {
    const result = loadCalendarEvents(() => window.localStorage, initialEvents);
    setEvents(result.events);
    setStorageStatus(result.status);
    setStorageCanWrite(result.canWrite);
    setStorageWarning(result.warning);
    setStorageReady(true);
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

  function exportBackup() {
    try {
      const contents = createEventBackup(events);
      const blob = new Blob([contents], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mortus-backup-${dateKey(new Date())}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStorageWarning(null);
    } catch (error) {
      console.error("Não foi possível exportar o backup.", error);
      setStorageWarning(error instanceof Error ? `Falha na exportação: ${error.message}` : "Não foi possível exportar o backup.");
    }
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const backup = parseEventBackup(await file.text());
      const confirmed = window.confirm(`O backup contém ${backup.events.length} evento(s). Substituir todos os eventos atuais? Esta ação não pode ser desfeita.`);
      if (!confirmed) return;
      if (!saveCalendarEvents(() => window.localStorage, backup.events)) {
        setStorageWarning("A importação não foi gravada. Os dados atuais foram mantidos; verifique o espaço e as permissões do navegador.");
        return;
      }
      setEvents(backup.events);
      setStorageStatus("valid");
      setStorageCanWrite(true);
      setStorageWarning(`Backup importado: ${backup.events.length} evento(s).`);
    } catch (error) {
      console.error("Não foi possível importar o backup.", error);
      setStorageWarning(error instanceof Error ? `Falha na importação: ${error.message}` : "Não foi possível importar o backup.");
    }
  }

  function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storageReady) return;
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
    const nextEvents = editingEventId === null
      ? createCalendarEvent(events, eventDraft)
      : updateCalendarEvent(events, editingEventId, eventDraft);

    if (!saveEvents(nextEvents)) return;
    setSelectedDate(draftDate);
    const eventDate = new Date(`${draftDate}T12:00:00`);
    setMonth(new Date(eventDate.getFullYear(), eventDate.getMonth(), 1));
    setDraftTitle("");
    setEditingEventId(null);
    setShowForm(false);
  }

  function deleteEvent(event: CalendarEvent) {
    if (!storageReady) return;
    if (!window.confirm(`Excluir o evento "${event.title}"?`)) return;
    saveEvents(deleteCalendarEvent(events, event.id));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#inicio" aria-label="Mortus, início"><span className="brand-mark">m</span><span>mortus</span></a>
        <div className="side-label">MENU</div>
        <button className="nav-item active"><span className="nav-icon">▦</span> Calendário</button>
        <button className="nav-item" disabled={!storageReady || !storageCanWrite} onClick={openCreateForm}><span className="nav-icon">＋</span> Novo evento</button>
        <div className="side-label side-label-spaced">SEUS CALENDÁRIOS</div>
        <div className="calendar-filter"><i className="dot purple" /> Pessoal <span className="check">✓</span></div>
        <div className="calendar-filter"><i className="dot blue" /> Trabalho <span className="check">✓</span></div>
        <div className="calendar-filter"><i className="dot green" /> Saúde <span className="check">✓</span></div>
        <div className="sidebar-bottom"><div className="avatar">M</div><div><strong>Meu espaço</strong><small>Calendário pessoal</small></div><span className="more">•••</span></div>
      </aside>

      <section className="workspace" id="inicio">
        <header className="topbar"><div className="breadcrumb">Meu espaço <span>/</span> <strong>Calendário</strong></div><div className="top-actions"><button className="icon-button" aria-label="Pesquisar">⌕</button><button className="icon-button notification" aria-label="Notificações">♧</button><div className="avatar small-avatar">M</div></div></header>
        <div className="content">
          <div className="page-heading"><div><div className="eyebrow">SEU TEMPO, NO SEU RITMO</div><h1>Calendário</h1><p>Um lugar tranquilo para organizar o que importa.</p></div><button className="primary-button" disabled={!storageReady || !storageCanWrite} onClick={openCreateForm}><span>＋</span> Novo evento</button></div>
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

          <section className="agenda-card"><div className="agenda-heading"><div><div className="eyebrow">SUA AGENDA</div><h2>{readableDate}</h2></div><button className="text-button" disabled={!storageReady || !storageCanWrite} onClick={openCreateForm}>＋ Adicionar</button></div>
            {showForm && <form className="event-form" onSubmit={saveEvent}>
              <label>Nome do evento<input autoFocus required maxLength={120} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Ex.: revisar suas metas" /></label>
              <label>Data<input required type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} /></label>
              <label>Início<input required type="time" value={draftStartTime} onChange={(event) => { setDraftStartTime(event.target.value); setFormError(null); }} /></label>
              <label>Data de término<input required type="date" value={draftEndDate} onChange={(event) => { setDraftEndDate(event.target.value); setFormError(null); }} /></label>
              <label>Término<input required type="time" value={draftEndTime} onChange={(event) => { setDraftEndTime(event.target.value); setFormError(null); }} /></label>
              <label>Categoria<select value={draftCategory} onChange={(event) => setDraftCategory(event.target.value as EventCategory)}>{eventCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              {formError && <p className="event-form-error" role="alert">{formError}</p>}
              <button className="primary-button" type="submit">{editingEventId === null ? "Salvar evento" : "Salvar alterações"}</button>
              <button className="cancel-button" type="button" onClick={() => { setShowForm(false); setEditingEventId(null); }}>Cancelar</button>
            </form>}
            {selectedConflicts.length > 0 && <div className="conflict-warning" role="status"><strong>Há conflitos de horário nesta data:</strong><ul>{selectedConflicts.map(({ first, second }) => <li key={`${first.id}-${second.id}`}>{first.title} ({first.startTime}–{first.endTime}) e {second.title} ({second.startTime}–{second.endTime})</li>)}</ul><p>Os eventos foram mantidos. Você pode editá-los se desejar.</p></div>}
            {selectedEvents.length ? <div className="event-list">{selectedEvents.map((event) => <article className="agenda-event" key={event.id}><div className={`event-marker ${categoryClass[event.category]}`} /><time>{event.startTime}–{event.endTime}{event.endDate !== event.date ? ` (+${event.endDate})` : ""}</time><div className="agenda-event-copy"><strong>{event.title}</strong><span>{event.category}{event.date !== selectedDate ? " · continua do dia anterior" : ""}</span></div><div className="event-actions"><button className="event-action" type="button" disabled={!storageReady || !storageCanWrite} onClick={() => openEditForm(event)} aria-label={`Editar ${event.title}`}>Editar</button><button className="event-action delete-action" type="button" disabled={!storageReady || !storageCanWrite} onClick={() => deleteEvent(event)} aria-label={`Excluir ${event.title}`}>Excluir</button></div></article>)}</div> : !showForm && <div className="empty-state"><span>✳</span><div><strong>Dia livre por enquanto</strong><p>Adicione um evento quando quiser.</p></div></div>}
          </section>
          <div className="backup-controls">
            <button className="text-button" type="button" disabled={!storageReady || (storageStatus !== "empty" && storageStatus !== "valid")} onClick={exportBackup}>Exportar backup</button>
            <label className="text-button backup-import">Importar backup<input type="file" accept="application/json,.json" disabled={!storageReady} onChange={(event) => { void importBackup(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          </div>
          {storageWarning && <div className="storage-warning" role="status">{storageWarning}</div>}
          <div className="prototype-note"><span>✦</span> Seus eventos são salvos neste navegador.</div>
        </div>
      </section>
    </main>
  );
}
