import type { CalendarEvent } from "./events.ts";

export const demoEvents: CalendarEvent[] = [
  { id: 1, title: "Revisão do projeto", date: "2026-10-29", endDate: "2026-10-29", startTime: "09:30", endTime: "10:30", category: "Trabalho" },
  { id: 2, title: "Pausa para almoço", date: "2026-10-29", endDate: "2026-10-29", startTime: "12:30", endTime: "13:30", category: "Pessoal" },
  { id: 3, title: "Consulta de rotina", date: "2026-10-30", endDate: "2026-10-30", startTime: "15:00", endTime: "16:00", category: "Saúde" },
  { id: 4, title: "Planejar a próxima semana", date: "2026-11-02", endDate: "2026-11-02", startTime: "10:00", endTime: "11:00", category: "Pessoal" },
];

const eventFields: (keyof CalendarEvent)[] = ["id", "title", "date", "endDate", "startTime", "endTime", "category"];

function isExactDemo(event: CalendarEvent, demo: CalendarEvent): boolean {
  return eventFields.every((field) => event[field] === demo[field]) &&
    Object.keys(event).length === eventFields.length;
}

export function separateDemoEvents(events: CalendarEvent[], demos: CalendarEvent[] = demoEvents) {
  const demoById = new Map(demos.map((event) => [event.id, event]));
  const realEvents: CalendarEvent[] = [];
  let demoCount = 0;

  for (const event of events) {
    const demo = demoById.get(event.id);
    if (demo && isExactDemo(event, demo)) demoCount += 1;
    else realEvents.push(event);
  }

  return { events: realEvents, demoCount };
}
