'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getAppointments, getConfirmedBookings, getProjects, getClients,
  getEmployees, getAllProjectTeams, updateAppointment, updateProject,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { GREGORIAN_DATE_LOCALE } from '@/lib/format';
import { Loading, ErrorBar } from '@/components';
import { toast } from '@/app/toast';

const WEEKDAYS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const APPT_COLOR = '#0E7E82'; // --pine (اجتماع فريق)
const BOOKING_COLOR = '#E2705F'; // --peach-600 (موعد عميل)
// لوحة ألوان بأسلوب تقويم آبل — تُسنَد لكل "نوع مشروع" بالتناوب الثابت حسب الاسم
const TYPE_PALETTE = ['#E0566B', '#F0913E', '#D9A520', '#3FA564', '#17A2A6', '#3E8FE2', '#8A6FE0', '#D45FB0'];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7ص → 9م
const HOUR_H = 52;
const VIEWS = [{ key: 'day', label: 'يوم' }, { key: 'week', label: 'أسبوع' }, { key: 'month', label: 'شهر' }, { key: 'year', label: 'سنة' }];

function colorForServiceType(name) {
  const key = (name || 'عام').trim();
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
}

// ---------- أدوات التاريخ ----------
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d, n) { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function addYears(d, n) { const r = new Date(d); r.setFullYear(r.getFullYear() + n); return r; }
function startOfWeek(d) { return addDays(d, -d.getDay()); }
function isSameDay(a, b) { return ymd(a) === ymd(b); }
function fmtTime(d) { return new Intl.DateTimeFormat(GREGORIAN_DATE_LOCALE, { hour: '2-digit', minute: '2-digit' }).format(d); }
function monthLabel(d) { return new Intl.DateTimeFormat(GREGORIAN_DATE_LOCALE, { month: 'long', year: 'numeric' }).format(d); }
function dayLabel(d) { return new Intl.DateTimeFormat(GREGORIAN_DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d); }
function weekLabel(d) {
  const s = startOfWeek(d); const e = addDays(s, 6);
  const f = (x, opts) => new Intl.DateTimeFormat(GREGORIAN_DATE_LOCALE, opts).format(x);
  if (s.getMonth() === e.getMonth()) return `${f(s, { day: 'numeric' })}–${f(e, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return `${f(s, { day: 'numeric', month: 'short' })} – ${f(e, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
// يوسّع موعداً متعدد الأيام إلى كل مفاتيح التاريخ التي يغطّيها
function rangeKeys(start, end) {
  const startKey = ymd(start); const endKey = ymd(end || start);
  if (startKey === endKey) return [startKey];
  const keys = []; const cur = new Date(start); cur.setHours(0, 0, 0, 0);
  const endD = new Date(end); endD.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cur <= endD && guard < 60) { keys.push(ymd(cur)); cur.setDate(cur.getDate() + 1); guard += 1; }
  return keys;
}
// شبكة 6×7 ثابتة تشمل أيام الشهر السابق واللاحق الظاهرة — كتقويم آبل
function buildMonthGrid(monthDate) {
  const year = monthDate.getFullYear(); const month = monthDate.getMonth();
  const startOffset = new Date(year, month, 1).getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(gridStart, i);
    return { date: d, inMonth: d.getMonth() === month };
  });
}
// توزيع الأحداث المتزامنة على "ممرات" جنباً إلى جنب (لعرض الأسبوع/اليوم)
function layoutLanes(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const lanes = []; // آخر وقت انتهاء مشغول بكل ممر
  const placed = sorted.map((ev) => {
    let lane = lanes.findIndex((end) => end <= ev.start);
    if (lane === -1) { lane = lanes.length; lanes.push(ev.end); } else { lanes[lane] = ev.end; }
    return { ...ev, lane };
  });
  const totalLanes = Math.max(1, lanes.length);
  return placed.map((ev) => ({ ...ev, totalLanes }));
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token || ''}`, 'Content-Type': 'application/json' };
}
async function syncAppointment(id) {
  try {
    const res = await fetch('/api/appointments/sync', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ appointment_id: id }) });
    if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p.error); }
  } catch { /* مزامنة Google اختيارية — لا توقف نقل الموعد */ }
}

// ---------- صور الفريق ----------
function Avatar({ person, size = 22, ring }) {
  const initial = person?.name?.trim()?.[0] || '؟';
  return (
    <span className="cm-av" style={{ width: size, height: size, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }} title={person?.name || ''}>
      {person?.photo_url ? <img src={person.photo_url} alt="" /> : <span className="cm-av-ltr">{initial}</span>}
    </span>
  );
}
function AvatarStack({ leader, members }) {
  const rest = members.filter((m) => !leader || m.id !== leader.id).slice(0, 4);
  if (!leader && rest.length === 0) return null;
  return (
    <span className="cm-avstack">
      {leader && <Avatar person={leader} ring="var(--gold)" />}
      {rest.map((m) => <Avatar key={m.id} person={m} />)}
    </span>
  );
}

export default function CalendarPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [dayKey, setDayKey] = useState(ymd(new Date()));
  const [hidden, setHidden] = useState(() => new Set());
  const [dragId, setDragId] = useState(null);

  async function load() {
    try {
      const [appointments, bookings, projects, clients, employees, teams] = await Promise.all([
        getAppointments(), getConfirmedBookings(), getProjects(), getClients(), getEmployees(), getAllProjectTeams(),
      ]);
      setData({ appointments, bookings, projects, clients, employees, teams });
    } catch (e) { setErr(e.message || 'تعذّر تحميل التقويم'); }
  }
  useEffect(() => { load(); }, []);

  const { events, eventsByDay } = useMemo(() => {
    if (!data) return { events: [], eventsByDay: new Map() };
    const employeesById = Object.fromEntries(data.employees.map((e) => [e.id, e]));
    const clientsById = Object.fromEntries(data.clients.map((c) => [c.id, c]));
    const teamByProject = new Map();
    data.teams.forEach((t) => {
      const emp = employeesById[t.employee_id];
      if (!emp) return;
      if (!teamByProject.has(t.project_id)) teamByProject.set(t.project_id, []);
      teamByProject.get(t.project_id).push(emp);
    });
    const list = [];

    data.appointments.forEach((a) => {
      const start = new Date(a.starts_at); const end = new Date(a.ends_at);
      const attendees = (a.appointment_attendees || []).map((x) => employeesById[x.employee_id]).filter(Boolean);
      list.push({
        id: `a-${a.id}`, kind: 'appointment', title: a.title, color: APPT_COLOR,
        start, end, allDay: Boolean(a.all_day),
        sub: a.location || attendees.map((p) => p.name).join('، ') || '',
        href: '/appointments', draggable: true, team: { leader: null, members: attendees },
      });
    });

    data.bookings.forEach((b) => {
      const effective = b.suggested_datetime || b.requested_datetime;
      const start = effective ? new Date(effective) : (b.requested_date ? new Date(`${b.requested_date}T09:00:00`) : null);
      if (!start) return;
      const end = new Date(start.getTime() + 60 * 60000);
      list.push({
        id: `b-${b.id}`, kind: 'booking', title: `موعد: ${b.client?.name || '—'}`, color: BOOKING_COLOR,
        start, end, allDay: !effective,
        client: b.client?.name || '', district: b.client?.district || '', sub: b.client?.phone || '',
        href: b.client?.id ? `/clients/${b.client.id}` : undefined, draggable: false, team: null,
      });
    });

    data.projects.forEach((p) => {
      if (!p.start_date) return;
      const typeName = p.service_type?.trim() || 'عام';
      const color = colorForServiceType(typeName);
      const start = new Date(`${p.start_date}T09:00:00`);
      const end = new Date(start.getTime() + 60 * 60000);
      const leader = employeesById[p.supervisor_id] || null;
      const members = teamByProject.get(p.id) || [];
      const client = clientsById[p.client_id];
      list.push({
        id: `p-${p.id}`, kind: 'project', title: p.title, color,
        start, end, allDay: true,
        client: client?.name || '', district: client?.district || '',
        href: `/projects/${p.id}`, draggable: true, team: { leader, members },
      });
    });

    const byDay = new Map();
    list.forEach((ev) => {
      rangeKeys(ev.start, ev.allDay ? ev.end : ev.start).forEach((key) => {
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(ev);
      });
    });
    byDay.forEach((arr) => arr.sort((x, y) => x.start - y.start));
    return { events: list, eventsByDay: byDay };
  }, [data]);

  const visibleEvents = useMemo(() => events.filter((e) => !hidden.has(e.kind)), [events, hidden]);
  const visibleByDay = useMemo(() => {
    const m = new Map();
    visibleEvents.forEach((ev) => {
      rangeKeys(ev.start, ev.allDay ? ev.end : ev.start).forEach((key) => {
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(ev);
      });
    });
    m.forEach((arr) => arr.sort((x, y) => x.start - y.start));
    return m;
  }, [visibleEvents]);

  if (err) return <ErrorBar message={err} />;
  if (!data) return <Loading />;

  const todayKey = ymd(new Date());

  function toggleKind(kind) {
    setHidden((prev) => { const n = new Set(prev); if (n.has(kind)) n.delete(kind); else n.add(kind); return n; });
  }
  function goToday() { const d = new Date(); setAnchor(d); setDayKey(ymd(d)); }
  function nav(delta) {
    setAnchor((a) => {
      if (view === 'day') return addDays(a, delta);
      if (view === 'week') return addDays(a, delta * 7);
      if (view === 'year') return addYears(a, delta);
      return addMonths(a, delta);
    });
  }
  function openDay(d) { setAnchor(d); setDayKey(ymd(d)); setView('day'); }

  async function moveEvent(ev, targetDateKey) {
    const originKey = ymd(ev.start);
    if (originKey === targetDateKey) return;
    const [ty, tm, td] = targetDateKey.split('-').map(Number);
    try {
      if (ev.kind === 'appointment') {
        const durationMs = ev.end - ev.start;
        const newStart = new Date(ev.start); newStart.setFullYear(ty, tm - 1, td);
        const newEnd = new Date(newStart.getTime() + durationMs);
        const raw = data.appointments.find((a) => `a-${a.id}` === ev.id);
        await updateAppointment(raw.id, { starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() });
        syncAppointment(raw.id);
        toast('تم نقل الموعد');
      } else if (ev.kind === 'project') {
        const raw = data.projects.find((p) => `p-${p.id}` === ev.id);
        await updateProject(raw.id, { start_date: targetDateKey });
        toast('تم تحديث تاريخ بدء المشروع');
      } else {
        return;
      }
      load();
    } catch (e) { toast(e.message || 'تعذّر نقل الموعد', 'err'); }
  }

  function onDropDay(targetDateKey) {
    return (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || dragId;
      const ev = visibleEvents.find((x) => x.id === id);
      setDragId(null);
      if (ev) moveEvent(ev, targetDateKey);
    };
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="cm-shell">
        <main className="cm-main">
          <div className="cm-topbar">
            <div className="cm-period">
              {view === 'day' && dayLabel(anchor)}
              {view === 'week' && weekLabel(anchor)}
              {view === 'month' && monthLabel(anchor)}
              {view === 'year' && anchor.getFullYear()}
            </div>
            <div className="cm-viewswitch">
              {VIEWS.map((v) => <button key={v.key} type="button" className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>{v.label}</button>)}
            </div>
            <div className="cm-navgroup">
              <button type="button" className="cm-arrow" onClick={() => nav(-1)} aria-label="السابق"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg></button>
              <button type="button" className="cm-today-btn" onClick={goToday}>اليوم</button>
              <button type="button" className="cm-arrow" onClick={() => nav(1)} aria-label="التالي"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg></button>
            </div>
          </div>

          {view === 'month' && (
            <MonthView anchor={anchor} eventsByDay={visibleByDay} todayKey={todayKey} dayKey={dayKey}
              onPick={(k) => setDayKey((p) => (p === k ? null : k))} onDropDay={onDropDay} onDragStart={setDragId} />
          )}
          {(view === 'week' || view === 'day') && (
            <TimeGridView days={view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))}
              eventsByDay={visibleByDay} todayKey={todayKey} onDropDay={onDropDay} onDragStart={setDragId} />
          )}
          {view === 'year' && <YearView anchor={anchor} eventsByDay={visibleByDay} todayKey={todayKey} onPickDay={openDay} onPickMonth={(d) => { setAnchor(d); setView('month'); }} />}

          {view === 'month' && (
            <div className="cm-agenda">
              <div className="cm-agenda-head">{dayKey ? dayLabel(new Date(`${dayKey}T00:00:00`)) : 'اختر يوماً لعرض مواعيده'}</div>
              {dayKey && (visibleByDay.get(dayKey) || []).length === 0 && <p className="cm-muted">لا مواعيد هذا اليوم</p>}
              {dayKey && (visibleByDay.get(dayKey) || []).map((ev) => <AgendaRow key={ev.id} ev={ev} />)}
            </div>
          )}
        </main>

        <aside className="cm-side">
          <MiniMonth anchor={anchor} onPick={(d) => { setAnchor(d); if (view !== 'month') setView('month'); setDayKey(ymd(d)); }} />
          <div className="cm-side-block">
            <div className="cm-side-title">التقويمات</div>
            {[['appointment', APPT_COLOR, 'اجتماعات الفريق'], ['booking', BOOKING_COLOR, 'مواعيد العملاء'], ['project', '#999', 'بدء المشاريع']].map(([kind, color, label]) => (
              <label className="cm-check" key={kind}>
                <input type="checkbox" checked={!hidden.has(kind)} onChange={() => toggleKind(kind)} />
                <span className="cm-dot" style={{ background: color }} />{label}
              </label>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

function MiniMonth({ anchor, onPick }) {
  const cells = buildMonthGrid(anchor);
  const todayKey = ymd(new Date());
  return (
    <div className="cm-mini">
      <div className="cm-mini-title">{monthLabel(anchor)}</div>
      <div className="cm-mini-grid">
        {WEEKDAYS.map((w) => <span key={w} className="cm-mini-wd">{w[0]}</span>)}
        {cells.map(({ date: d, inMonth }) => {
          const key = ymd(d);
          return (
            <button type="button" key={key} className={`cm-mini-day${inMonth ? '' : ' out'}${key === todayKey ? ' today' : ''}`} onClick={() => onPick(d)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({ anchor, eventsByDay, todayKey, dayKey, onPick, onDropDay, onDragStart }) {
  const cells = buildMonthGrid(anchor);
  return (
    <div className="cm-card">
      <div className="cm-grid cm-weekdays">{WEEKDAYS.map((w) => <div key={w} className="cm-weekday">{w}</div>)}</div>
      <div className="cm-grid">
        {cells.map(({ date: d, inMonth }) => {
          const key = ymd(d);
          const evs = eventsByDay.get(key) || [];
          const isToday = key === todayKey;
          return (
            <div key={key} className={`cm-cell${inMonth ? '' : ' cm-outside'}${key === dayKey ? ' cm-cell-sel' : ''}${isToday ? ' cm-cell-today' : ''}`}
              onDragOver={(e) => e.preventDefault()} onDrop={onDropDay(key)}>
              <button type="button" className="cm-cellbtn" onClick={() => onPick(key)}>
                <span className={`cm-daynum${isToday ? ' is-today' : ''}`}>{d.getDate()}</span>
              </button>
              <div className="cm-chiplist">
                {evs.slice(0, 2).map((ev) => {
                  const primary = ev.client || ev.title;
                  const secondary = ev.client ? ev.title : ev.sub;
                  const chipProps = {
                    className: 'cm-chip', style: { background: `color-mix(in srgb, ${ev.color} 16%, white)`, color: ev.color },
                    title: [ev.title, ev.client, ev.district].filter(Boolean).join(' · '),
                    draggable: ev.draggable,
                    onDragStart: (e) => { e.dataTransfer.setData('text/plain', ev.id); onDragStart(ev.id); },
                  };
                  const content = (
                    <>
                      <span className="cm-chip-title">{primary}</span>
                      {secondary && <span className="cm-chip-sub">{secondary}</span>}
                    </>
                  );
                  return ev.href
                    ? <Link key={ev.id} href={ev.href} {...chipProps}>{content}</Link>
                    : <span key={ev.id} {...chipProps}>{content}</span>;
                })}
                {evs.length > 2 && <span className="cm-muted cm-more">+{evs.length - 2}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGridView({ days, eventsByDay, todayKey, onDropDay, onDragStart }) {
  const now = new Date();
  const nowOffset = (now.getHours() + now.getMinutes() / 60 - HOURS[0]) * HOUR_H;
  return (
    <div className="cm-card cm-timecard">
      <div className="cm-timegrid" style={{ gridTemplateColumns: `52px repeat(${days.length},1fr)` }}>
        <div className="cm-corner" />
        {days.map((d) => {
          const key = ymd(d);
          const allDayEvs = (eventsByDay.get(key) || []).filter((e) => e.allDay);
          return (
            <div key={key} className="cm-daycol-head">
              <div className={`cm-daycol-date${key === todayKey ? ' is-today' : ''}`}>{WEEKDAYS[d.getDay()]} {d.getDate()}</div>
              <div className="cm-alldayrow" onDragOver={(e) => e.preventDefault()} onDrop={onDropDay(key)}>
                {allDayEvs.map((ev) => (
                  <Link key={ev.id} href={ev.href || '#'} className="cm-allday-chip" style={{ background: `color-mix(in srgb, ${ev.color} 16%, white)`, color: ev.color }}
                    draggable={ev.draggable} onDragStart={(e) => { e.dataTransfer.setData('text/plain', ev.id); onDragStart(ev.id); }}>
                    {ev.team && <AvatarStack leader={ev.team.leader} members={ev.team.members} />}
                    <span className="cm-allday-text">
                      <span className="cm-allday-title">{ev.title}</span>
                      {(ev.client || ev.district) && (
                        <span className="cm-allday-sub">{[ev.client, ev.district].filter(Boolean).join(' · ')}</span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}

        <div className="cm-hourlabels">
          {HOURS.map((h) => <div key={h} className="cm-hourlabel" style={{ height: HOUR_H }}>{h}:00</div>)}
        </div>
        {days.map((d) => {
          const key = ymd(d);
          const timed = layoutLanes((eventsByDay.get(key) || []).filter((e) => !e.allDay));
          return (
            <div key={key} className="cm-daycol" style={{ height: HOUR_H * HOURS.length }}
              onDragOver={(e) => e.preventDefault()} onDrop={onDropDay(key)}>
              {HOURS.map((h) => <div key={h} className="cm-hourline" style={{ top: (h - HOURS[0]) * HOUR_H }} />)}
              {key === todayKey && nowOffset >= 0 && nowOffset <= HOUR_H * HOURS.length && <div className="cm-nowline" style={{ top: nowOffset }} />}
              {timed.map((ev) => {
                const startH = ev.start.getHours() + ev.start.getMinutes() / 60;
                const endH = ev.end.getHours() + ev.end.getMinutes() / 60;
                const top = Math.max(0, (startH - HOURS[0]) * HOUR_H);
                const height = Math.max(22, (endH - startH) * HOUR_H);
                const width = 100 / ev.totalLanes;
                return (
                  <Link key={ev.id} href={ev.href || '#'} className="cm-block"
                    style={{ top, height, insetInlineStart: `${ev.lane * width}%`, width: `calc(${width}% - 4px)`, background: `color-mix(in srgb, ${ev.color} 14%, white)`, borderInlineStart: `3px solid ${ev.color}` }}
                    draggable={ev.draggable} onDragStart={(e) => { e.dataTransfer.setData('text/plain', ev.id); onDragStart(ev.id); }}>
                    <span className="cm-block-title">{ev.title}</span>
                    <span className="cm-block-time">{fmtTime(ev.start)}{ev.district ? ` · ${ev.district}` : ''}</span>
                    {ev.team && <AvatarStack leader={ev.team.leader} members={ev.team.members} />}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YearView({ anchor, eventsByDay, todayKey, onPickDay, onPickMonth }) {
  const months = Array.from({ length: 12 }, (_, i) => new Date(anchor.getFullYear(), i, 1));
  return (
    <div className="cm-yeargrid">
      {months.map((m) => {
        const cells = buildMonthGrid(m);
        return (
          <div className="cm-card cm-yearmonth" key={m.getMonth()}>
            <button type="button" className="cm-yearmonth-title" onClick={() => onPickMonth(m)}>{monthLabel(m)}</button>
            <div className="cm-yeardow">{WEEKDAYS.map((w) => <span key={w}>{w[0]}</span>)}</div>
            <div className="cm-yeardays">
              {cells.map(({ date: d, inMonth }) => {
                const key = ymd(d);
                const has = (eventsByDay.get(key) || []).length > 0;
                if (!inMonth) return <span key={key} />;
                return (
                  <button type="button" key={key} className={`cm-yearday${key === todayKey ? ' today' : ''}`} onClick={() => onPickDay(d)}>
                    {d.getDate()}{has && <span className="cm-yeardot" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaRow({ ev }) {
  const row = (
    <div className="cm-dayrow">
      <span className="cm-dot cm-dot-lg" style={{ background: ev.color }} />
      <div className="cm-dayrow-main">
        <div className="cm-dayrow-title">{ev.title}{!ev.allDay && <span className="cm-muted"> · {fmtTime(ev.start)}</span>}</div>
        {ev.client && <div className="cm-muted">العميل: {ev.client}</div>}
        {ev.district && <div className="cm-muted">الحي: {ev.district}</div>}
        {ev.sub && <div className="cm-muted">{ev.sub}</div>}
      </div>
      {ev.team && <AvatarStack leader={ev.team.leader} members={ev.team.members} />}
    </div>
  );
  return ev.href ? <Link href={ev.href} className="cm-dayrow-link">{row}</Link> : <div className="cm-dayrow-link">{row}</div>;
}

const CSS = `
.cm-shell{display:flex;gap:16px;align-items:flex-start}
.cm-side{width:240px;flex-shrink:0;display:flex;flex-direction:column;gap:16px;position:sticky;top:16px}
.cm-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
.cm-topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:12px 16px}
.cm-period{font-family:var(--display);font-size:19px;font-weight:700;white-space:nowrap}
.cm-viewswitch{display:flex;background:var(--surface-2);border-radius:10px;padding:3px;gap:2px}
.cm-viewswitch button{border:none;background:none;padding:6px 14px;border-radius:8px;font-size:13px;color:var(--muted);cursor:pointer;font-weight:600}
.cm-viewswitch button.active{background:var(--surface);color:var(--primary);box-shadow:0 1px 4px rgba(0,0,0,.08)}
.cm-navgroup{display:flex;align-items:center;gap:8px}
.cm-arrow{background:var(--surface);border:1px solid var(--line);color:var(--primary);cursor:pointer;padding:6px;border-radius:50%;display:flex;flex-shrink:0}
.cm-arrow:hover{background:var(--surface-2)}
.cm-today-btn{background:none;border:1px solid var(--line);border-radius:8px;color:var(--primary);font-size:13px;font-weight:600;cursor:pointer;padding:6px 14px;white-space:nowrap}
.cm-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px}

/* شريط جانبي */
.cm-mini{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:12px}
.cm-mini-title{font-size:13px;font-weight:700;text-align:center;margin-bottom:8px}
.cm-mini-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}
.cm-mini-wd{text-align:center;font-size:9.5px;color:var(--muted);font-weight:600;padding-bottom:3px}
.cm-mini-day{min-width:0;aspect-ratio:1;border:none;background:none;border-radius:6px;font-size:11px;color:var(--ink);cursor:pointer}
.cm-mini-day:hover{background:var(--surface-2)}
.cm-mini-day.out{color:var(--faint);opacity:.5}
.cm-mini-day.today{background:var(--primary);color:#fff;font-weight:700}
.cm-side-block{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:12px}
.cm-side-title{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px}
.cm-check{display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0;cursor:pointer}
.cm-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;display:inline-block}

/* شبكة الشهر */
.cm-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px}
.cm-weekdays{margin-bottom:6px;gap:7px}
.cm-weekday{min-width:0;text-align:center;font-size:11px;color:var(--muted);font-weight:600;padding:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-cell{min-width:0;min-height:108px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:6px;display:flex;flex-direction:column;gap:4px}
.cm-cell-sel{border-color:var(--primary)}
.cm-cell-today{border-color:var(--primary);border-width:2px;padding:5px}
.cm-cellbtn{all:unset;display:flex;justify-content:flex-start;cursor:pointer;width:100%}
.cm-outside{background:var(--surface-2)}
.cm-outside .cm-daynum{color:var(--faint);opacity:.55}
.cm-outside .cm-chiplist{opacity:.4}
.cm-daynum{width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:13px;font-weight:600}
.cm-daynum.is-today{background:var(--primary);color:#fff}
.cm-dot-lg{width:9px;height:9px;margin-top:6px}
.cm-chiplist{display:flex;flex-direction:column;gap:3px;width:100%}
.cm-chip{display:flex;flex-direction:column;font-size:10.5px;padding:3px 6px;border-radius:6px;overflow:hidden;cursor:grab;text-decoration:none;gap:1px}
.cm-chip-title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-chip-sub{font-size:9.5px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
.cm-more{font-size:10px;padding-inline-start:4px}

/* اليوم/الأسبوع */
.cm-timecard{overflow-x:auto}
.cm-timegrid{display:grid;min-width:560px}
.cm-corner{position:sticky;inset-inline-start:0}
.cm-daycol-head{border-inline-start:1px solid var(--line);padding:0 4px 6px}
.cm-daycol-date{text-align:center;font-size:12.5px;font-weight:700;padding:4px 0}
.cm-daycol-date.is-today{color:var(--primary)}
.cm-alldayrow{display:flex;flex-direction:column;gap:3px;min-height:20px}
.cm-allday-chip{display:flex;align-items:center;gap:5px;font-size:10.5px;padding:3px 6px;border-radius:6px;text-decoration:none;overflow:hidden}
.cm-allday-text{display:flex;flex-direction:column;min-width:0;overflow:hidden}
.cm-allday-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.cm-allday-sub{font-size:9px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-hourlabels{position:relative}
.cm-hourlabel{font-size:10.5px;color:var(--muted);text-align:center;border-top:1px solid var(--line)}
.cm-daycol{position:relative;border-inline-start:1px solid var(--line)}
.cm-hourline{position:absolute;left:0;right:0;border-top:1px solid var(--line)}
.cm-nowline{position:absolute;left:0;right:0;height:2px;background:var(--neg);z-index:3}
.cm-block{position:absolute;border-radius:8px;padding:3px 6px;overflow:hidden;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;gap:2px;cursor:grab}
.cm-block-title{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-block-time{font-size:9.5px;color:var(--muted)}

/* السنة */
.cm-yeargrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.cm-yearmonth{padding:10px}
.cm-yearmonth-title{all:unset;display:block;text-align:center;font-size:12.5px;font-weight:700;cursor:pointer;margin-bottom:6px;width:100%}
.cm-yeardow{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));margin-bottom:2px}
.cm-yeardow span{text-align:center;font-size:8.5px;color:var(--muted)}
.cm-yeardays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px}
.cm-yearday{all:unset;min-width:0;text-align:center;font-size:9.5px;padding:3px 0;border-radius:4px;cursor:pointer;position:relative}
.cm-yearday:hover{background:var(--surface-2)}
.cm-yearday.today{background:var(--primary);color:#fff}
.cm-yeardot{position:absolute;bottom:1px;inset-inline-start:50%;transform:translateX(-50%);width:3px;height:3px;border-radius:50%;background:var(--accent-strong)}

/* الأجندة وصفوف التفاصيل */
.cm-agenda{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px;min-height:72px}
.cm-agenda-head{font-size:13.5px;font-weight:700;margin-bottom:8px}
.cm-muted{color:var(--muted);font-size:12px}
.cm-dayrow{display:flex;align-items:flex-start;gap:9px;padding:7px 4px;border-radius:10px}
.cm-dayrow-link{display:block;color:inherit;text-decoration:none}
.cm-dayrow-link:hover .cm-dayrow{background:var(--surface-2)}
.cm-dayrow-main{flex:1;min-width:0}
.cm-dayrow-title{font-size:13.5px;font-weight:600}

/* صور الموظفين */
.cm-avstack{display:flex;flex-shrink:0}
.cm-av{border-radius:50%;overflow:hidden;border:2px solid var(--surface);margin-inline-start:-8px;flex-shrink:0;background:var(--sage-bg);display:flex;align-items:center;justify-content:center}
.cm-av:first-child{margin-inline-start:0}
.cm-av img{width:100%;height:100%;object-fit:cover}
.cm-av-ltr{font-size:10px;font-weight:700;color:var(--green)}

@media(max-width:980px){
  .cm-shell{flex-direction:column}
  .cm-side{width:100%;position:static;flex-direction:row;flex-wrap:wrap}
  .cm-side-block,.cm-mini{flex:1;min-width:200px}
}
@media(max-width:640px){
  .cm-cell{min-height:64px}
  .cm-chiplist{display:none}
  .cm-topbar{padding:10px 12px}
  .cm-period{font-size:15px;width:100%;order:-1}
  .cm-yeargrid{grid-template-columns:repeat(2,1fr)}
}
`;
