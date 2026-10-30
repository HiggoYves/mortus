"use client";

import { FormEvent, useMemo, useState } from "react";

type EventItem = { id: number; title: string; date: string; time: string; category: "Trabalho" | "Pessoal" | "Saúde" };

const initialEvents: EventItem[] = [
  { id: 1, title: "Revisão do projeto", date: "2026-10-29", time: "09:30", category: "Trabalho" },
  { id: 2, title: "Pausa para almoço", date: "2026-10-29", time: "12:30", category: "Pessoal" },
  { id: 3, title: "Consulta de rotina", date: "2026-10-30", time: "15:00", category: "Saúde" },
  { id: 4, title: "Planejar a próxima semana", date: "2026-11-02", time: "10:00", category: "Pessoal" },
];

const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const categoryClass: Record<EventItem["category"], string> = { Trabalho: "work", Pessoal: "personal", Saúde: "health" };

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Home() {
  const [month, setMonth] = useState(new Date(2026, 9, 1));
  const [selectedDate, setSelectedDate] = useState("2026-10-29");
  const [events, setEvents] = useState(initialEvents);
  const [showForm, setShowForm] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTime, setDraftTime] = useState("09:00");

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((mondayOffset + count) / 7) * 7 }, (_, index) => {
      const day = index - mondayOffset + 1;
      return new Date(month.getFullYear(), month.getMonth(), day);
    });
  }, [month]);
  const selectedEvents = events.filter((event) => event.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));
  const readableDate = new Date(`${selectedDate}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  function shiftMonth(amount: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftTitle.trim()) return;
    setEvents((current) => [...current, { id: Date.now(), title: draftTitle.trim(), date: selectedDate, time: draftTime, category: "Pessoal" }]);
    setDraftTitle("");
    setShowForm(false);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#inicio" aria-label="Mortus, início"><span className="brand-mark">m</span><span>mortus</span></a>
        <div className="side-label">MENU</div>
        <button className="nav-item active"><span className="nav-icon">▦</span> Calendário</button>
        <button className="nav-item" onClick={() => setShowForm(true)}><span className="nav-icon">＋</span> Novo evento</button>
        <div className="side-label side-label-spaced">SEUS CALENDÁRIOS</div>
        <div className="calendar-filter"><i className="dot purple" /> Pessoal <span className="check">✓</span></div>
        <div className="calendar-filter"><i className="dot blue" /> Trabalho <span className="check">✓</span></div>
        <div className="calendar-filter"><i className="dot green" /> Saúde <span className="check">✓</span></div>
        <div className="sidebar-bottom"><div className="avatar">M</div><div><strong>Meu espaço</strong><small>Calendário pessoal</small></div><span className="more">•••</span></div>
      </aside>

      <section className="workspace" id="inicio">
        <header className="topbar"><div className="breadcrumb">Meu espaço <span>/</span> <strong>Calendário</strong></div><div className="top-actions"><button className="icon-button" aria-label="Pesquisar">⌕</button><button className="icon-button notification" aria-label="Notificações">♧</button><div className="avatar small-avatar">M</div></div></header>
        <div className="content">
          <div className="page-heading"><div><div className="eyebrow">SEU TEMPO, NO SEU RITMO</div><h1>Calendário</h1><p>Um lugar tranquilo para organizar o que importa.</p></div><button className="primary-button" onClick={() => setShowForm((value) => !value)}><span>＋</span> Novo evento</button></div>
          <div className="calendar-card">
            <div className="calendar-toolbar"><div className="month-title"><h2>{monthNames[month.getMonth()]}</h2><span>{month.getFullYear()}</span></div><div className="calendar-controls"><button className="today-button" onClick={() => { const today = new Date(2026, 9, 29); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(dateKey(today)); }}>Hoje</button><button className="arrow-button" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">‹</button><button className="arrow-button" onClick={() => shiftMonth(1)} aria-label="Próximo mês">›</button><div className="view-select">Mês <span>⌄</span></div></div></div>
            <div className="month-grid">
              {weekdays.map((day) => <div className="weekday" key={day}>{day}</div>)}
              {days.map((day) => {
                const key = dateKey(day);
                const inMonth = day.getMonth() === month.getMonth();
                const dayEvents = events.filter((event) => event.date === key);
                return <button className={`day-cell ${inMonth ? "" : "outside"} ${selectedDate === key ? "selected" : ""}`} key={key} onClick={() => setSelectedDate(key)}>
                  <span className={`day-number ${key === "2026-10-29" ? "today-number" : ""}`}>{day.getDate()}</span>
                  <span className="day-events">{dayEvents.slice(0, 2).map((event) => <span className={`event-chip ${categoryClass[event.category]}`} key={event.id}><b />{event.title}</span>)}{dayEvents.length > 2 && <span className="more-events">+{dayEvents.length - 2} eventos</span>}</span>
                </button>;
              })}
            </div>
          </div>

          <section className="agenda-card"><div className="agenda-heading"><div><div className="eyebrow">SUA AGENDA</div><h2>{readableDate}</h2></div><button className="text-button" onClick={() => setShowForm(true)}>＋ Adicionar</button></div>
            {showForm && <form className="event-form" onSubmit={addEvent}><label>Nome do evento<input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Ex.: revisar suas metas" /></label><label>Horário<input type="time" value={draftTime} onChange={(event) => setDraftTime(event.target.value)} /></label><button className="primary-button" type="submit">Salvar evento</button><button className="cancel-button" type="button" onClick={() => setShowForm(false)}>Cancelar</button></form>}
            {selectedEvents.length ? <div className="event-list">{selectedEvents.map((event) => <article className="agenda-event" key={event.id}><div className={`event-marker ${categoryClass[event.category]}`} /><time>{event.time}</time><div className="agenda-event-copy"><strong>{event.title}</strong><span>{event.category}</span></div></article>)}</div> : !showForm && <div className="empty-state"><span>✳</span><div><strong>Dia livre por enquanto</strong><p>Adicione um evento quando quiser.</p></div></div>}
          </section>
          <div className="prototype-note"><span>✦</span> Seus eventos ficam somente nesta sessão por enquanto.</div>
        </div>
      </section>
    </main>
  );
}
