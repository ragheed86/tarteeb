'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ---------- خريطة التنقّل والعناوين ----------
const NAV = [
  { group: null, items: [{ href: '/', label: 'لوحة المعلومات', icon: IconDash, sub: 'نظرة عامة على الأداء' }] },
  { group: 'العمليات', items: [
    { href: '/clients', label: 'العملاء', icon: IconUsers, sub: 'قاعدة العملاء وملفاتهم' },
    { href: '/projects', label: 'المشاريع', icon: IconBox, sub: 'مشاريع التنظيم الجارية' },
  ] },
  { group: 'المالية', items: [
    { href: '/invoices', label: 'الفواتير', icon: IconDoc, sub: 'الفواتير والمدفوعات' },
  ] },
];

const ALL = NAV.flatMap((g) => g.items);

export default function AppShell({ children }) {
  const pathname = usePathname();
  const [session, setSession] = useState(undefined); // undefined=يحمّل، null=خارج
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => setOpen(false), [pathname]); // إغلاق القائمة عند التنقّل

  if (session === undefined) {
    return <div className="login-wrap"><div className="spinner" /></div>;
  }
  if (session === null) {
    return <Login />;
  }

  const active = ALL.find((i) => i.href === pathname) || ALL[0];
  const email = session.user?.email || '';
  const initial = (email[0] || 'ر').toUpperCase();

  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <div className="mark"><span /><span /><span /><span /></div>
          <div><h1>ترتيب</h1><small>نظام إدارة الأعمال</small></div>
        </div>
        <nav className="nav">
          {NAV.map((g, gi) => (
            <div key={gi}>
              {g.group && <div className="nav-label">{g.group}</div>}
              {g.items.map((it) => {
                const Icon = it.icon;
                const isActive = it.href === pathname;
                return (
                  <Link key={it.href} href={it.href} className={isActive ? 'active' : ''}>
                    <Icon /> {it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="avatar">{initial}</div>
          <div>المدير<br /><small>{email}</small></div>
          <button className="logout" onClick={() => supabase.auth.signOut()}>خروج</button>
        </div>
      </aside>
      <div className={`scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen((v) => !v)} aria-label="القائمة">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="pt">{active.label}<small>{active.sub}</small></div>
          <div className="search">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
            <input placeholder="ابحث عن عميل أو مشروع..." />
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

// ---------- شاشة الدخول ----------
function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setErr('بيانات الدخول غير صحيحة، حاول مجدداً');
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="lhead">
          <div className="mark"><span /><span /><span /><span /></div>
          <h1>ترتيب</h1>
          <small>سجّل الدخول للوصول إلى نظام إدارة الأعمال</small>
        </div>
        {err && <div className="errbar">{err}</div>}
        <div className="field">
          <label>البريد الإلكتروني</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" autoComplete="username" />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required dir="ltr" autoComplete="current-password" />
        </div>
        <button className="btn btn-full" type="submit" disabled={busy}>
          {busy ? 'جارٍ الدخول…' : 'دخول'}
        </button>
      </form>
    </div>
  );
}

// ---------- الأيقونات ----------
function IconDash() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>; }
function IconUsers() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" /></svg>; }
function IconBox() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 8.5h16.5a1.5 1.5 0 0 1 1.48 1.76l-1.2 7A1.5 1.5 0 0 1 18.3 18.5H5.7a1.5 1.5 0 0 1-1.48-1.24l-1.2-7A1.5 1.5 0 0 1 3 8.5Z" /><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h7" /></svg>; }
function IconDoc() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>; }
