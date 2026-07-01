'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase, supabaseReady } from '@/lib/supabase';

// ---------- خريطة التنقّل والعناوين ----------
const NAV = [
  { group: null, items: [{ href: '/', label: 'لوحة المعلومات', icon: IconDash, sub: 'نظرة عامة على الأداء' }] },
  { group: 'العمليات', items: [
    { href: '/clients', label: 'العملاء', icon: IconUsers, sub: 'قاعدة العملاء وملفاتهم' },
    { href: '/projects', label: 'المشاريع', icon: IconBox, sub: 'مشاريع التنظيم الجارية' },
    { href: '/cost', label: 'تكلفة المشاريع', icon: IconCost, sub: 'ابحث عن مشروع وأضف تكاليفه' },
    { href: '/warehouse', label: 'المستودع', icon: IconWarehouse, sub: 'الأصناف والمخزون' },
    { href: '/employees', label: 'الموظفون', icon: IconBadge, sub: 'الفريق ومستنداتهم' },
  ] },
  { group: 'التسويق', items: [
    { href: '/heatmap', label: 'الخريطة الحرارية', icon: IconPin, sub: 'كثافة الطلبات حسب أحياء الرياض' },
  ] },
  { group: 'المالية', items: [
    { href: '/invoices', label: 'الفواتير', icon: IconDoc, sub: 'الفواتير والمدفوعات' },
    { href: '/partners', label: 'حسابات الشركاء', icon: IconUsers, sub: 'توزيع الأرباح والسحوبات والأرصدة' },
  ] },
  { group: 'التواصل', items: [
    { href: '/inbox', label: 'الوارد الموحّد', icon: IconInbox, sub: 'كل قنوات التواصل في مكان واحد' },
  ] },
  { group: 'النظام', items: [
    { href: '/settings', label: 'الإعدادات', icon: IconGear, sub: 'بيانات الشركة والموردون والرخص والصلاحيات' },
  ] },
];

const ALL = NAV.flatMap((g) => g.items);

export default function AppShell({ children }) {
  const pathname = usePathname();
  const [session, setSession] = useState(undefined); // undefined=يحمّل، null=خارج
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!supabaseReady) {
      setSession(null);
      return undefined;
    }
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
    if (!supabaseReady) {
      return;
    }
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
        {!supabaseReady && <div className="errbar">إعدادات Supabase غير مكتملة في بيئة التشغيل</div>}
        {err && <div className="errbar">{err}</div>}
        <div className="field">
          <label>البريد الإلكتروني</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" autoComplete="username" />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required dir="ltr" autoComplete="current-password" />
        </div>
        <button className="btn btn-full" type="submit" disabled={busy || !supabaseReady}>
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
function IconCost() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h3M8 15h3" /><circle cx="15.5" cy="13.5" r="2" /></svg>; }
function IconDoc() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>; }
function IconWarehouse() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 21V9l9-5 9 5v12" /><path d="M7 21v-7h10v7M7 14h10" /></svg>; }
function IconBadge() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="9" r="2.4" /><path d="M8 17a4 4 0 0 1 8 0" /></svg>; }
function IconPin() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>; }
function IconInbox() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5h16v11H8l-4 3z" /><path d="M8 9h8M8 12h5" /></svg>; }
function IconGear() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2l-.4-2.5H9.8l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.5h4.4l.4-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" /></svg>; }
