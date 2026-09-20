'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Toaster } from './toast';
import { supabase, supabaseReady } from '@/lib/supabase';
import { ROLE_LABELS, ROLE_LABELS_EN, canAccess, permissionForPath } from '@/lib/permissions';
import { useAccess } from '@/lib/useAccess';
import { useRouteMemory } from '@/lib/useRouteMemory';
import { LanguageToggle, useLanguage } from '@/i18n/LanguageProvider';

// ---------- خريطة التنقّل والعناوين ----------
const NAV = [
  { groupKey: null, items: [{ href: '/', labelKey: 'nav.dashboard', icon: IconDash, subKey: 'nav.dashboardSub' }] },
  { groupKey: 'nav.whatsapp', items: [
    { href: '/inbox', labelKey: 'nav.inbox', icon: IconChat, subKey: 'nav.inboxSub' },
    { href: '/pricing', labelKey: 'nav.pricing', icon: IconPrice, subKey: 'nav.pricingSub' },
    { href: '/bookings', labelKey: 'nav.bookings', icon: IconCalendar, subKey: 'nav.bookingsSub' },
  ] },
  { groupKey: 'nav.operations', items: [
    { href: '/clients', labelKey: 'nav.clients', icon: IconUsers, subKey: 'nav.clientsSub' },
    { href: '/projects', labelKey: 'nav.projects', icon: IconBox, subKey: 'nav.projectsSub' },
    { href: '/cost', labelKey: 'nav.cost', icon: IconCost, subKey: 'nav.costSub' },
    { href: '/warehouse', labelKey: 'nav.warehouse', icon: IconWarehouse, subKey: 'nav.warehouseSub' },
    { href: '/employees', labelKey: 'nav.employees', icon: IconBadge, subKey: 'nav.employeesSub' },
  ] },
  { groupKey: 'nav.marketing', items: [
    { href: '/heatmap', labelKey: 'nav.heatmap', icon: IconPin, subKey: 'nav.heatmapSub' },
  ] },
  { groupKey: 'nav.finance', items: [
    { href: '/quotes', labelKey: 'nav.quotes', icon: IconQuote, subKey: 'nav.quotesSub' },
    { href: '/invoices', labelKey: 'nav.invoices', icon: IconDoc, subKey: 'nav.invoicesSub' },
    { href: '/company-expenses', labelKey: 'nav.expenses', icon: IconCost, subKey: 'nav.expensesSub' },
    { href: '/bank-reconciliation', labelKey: 'nav.bank', icon: IconDoc, subKey: 'nav.bankSub' },
    { href: '/reports', labelKey: 'nav.reports', icon: IconDash, subKey: 'nav.reportsSub' },
  ] },
  { groupKey: 'nav.system', items: [
    { href: '/settings', labelKey: 'nav.settings', icon: IconGear, subKey: 'nav.settingsSub' },
  ] },
];

const ALL = NAV.flatMap((g) => g.items);
const MOBILE_NAV = ['/', '/inbox', '/clients', '/projects', '/quotes'];
// عناوين المسارات غير الظاهرة في القائمة (تفاصيل وصفحات فرعية) — كي لا يظهر عنوان خاطئ في الشريط العلوي
const EXTRA_TITLES = [
  { prefix: '/clients/', labelKey: 'nav.clientFile', subKey: 'nav.clientFileSub' },
  { prefix: '/projects/', labelKey: 'nav.projectDetails', subKey: 'nav.projectDetailsSub' },
  { prefix: '/invoices/', labelKey: 'nav.invoice', subKey: 'nav.invoiceSub' },
  { prefix: '/suppliers', labelKey: 'nav.suppliers', subKey: 'nav.suppliersSub' },
  { prefix: '/government', labelKey: 'nav.government', subKey: 'nav.governmentSub' },
];

export default function AppShell({ children }) {
  const { t, language } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const { session, access } = useAccess();
  const [open, setOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const navRef = useRef(null);
  const [glide, setGlide] = useState(null);

  useEffect(() => setOpen(false), [pathname]); // إغلاق القائمة عند التنقّل

  // مؤشر منزلق خلف الرابط النشط في الشريط الجانبي
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector('a.active');
    if (!link) { setGlide(null); return; }
    setGlide({ top: link.offsetTop, height: link.offsetHeight });
  }, [pathname, session, access]);
  useRouteMemory(Boolean(session)); // يستعيد آخر مسار عند إطلاق بارد للتطبيق (PWA) على الشاشة الرئيسية

  // رابط الاستعادة ينشئ جلسة مؤقتة؛ يجب إبقاء المستخدم في نموذج تغيير
  // كلمة المرور بدلاً من إدخاله إلى التطبيق مباشرة.
  if (pathname === '/reset-password') {
    return (<><ResetPassword /><IOSInstallBanner /></>);
  }

  if (session === undefined || (session && access === undefined)) {
    return <Splash />;
  }
  if (session === null) {
    return (<><Login /><IOSInstallBanner /></>);
  }

  const visibleNav = NAV
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccess(access, permissionForPath(item.href))) }))
    .filter((group) => group.items.length > 0);
  const visibleAll = visibleNav.flatMap((g) => g.items);
  const active = ALL.find((i) => i.href === pathname)
    || EXTRA_TITLES.find((t) => pathname.startsWith(t.prefix))
    || ALL.find((i) => i.href !== '/' && pathname.startsWith(i.href))
    || visibleAll[0] || ALL[0];
  const email = session.user?.email || '';
  const initial = (email[0] || 'ر').toUpperCase();
  const currentPermission = permissionForPath(pathname);
  const allowed = canAccess(access, currentPermission);

  function submitGlobalSearch(event) {
    event.preventDefault();
    const term = globalQuery.trim();
    router.push(term ? `/clients?q=${encodeURIComponent(term)}` : '/clients');
  }

  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tarteeb-logo.png" alt="ترتيب" className="brand-logo" />
        </div>
        <nav className={`nav${glide ? ' has-glider' : ''}`} ref={navRef}>
          {glide && <span className="nav-glider" style={{ top: glide.top, height: glide.height }} aria-hidden="true" />}
          {visibleNav.map((g, gi) => (
            <div key={gi}>
              {g.groupKey && <div className="nav-label">{t(g.groupKey)}</div>}
              {g.items.map((it) => {
                const Icon = it.icon;
                const isActive = it.href === pathname || (it.href !== '/' && pathname.startsWith(it.href + '/'));
                return (
                  <Link key={it.href} href={it.href} className={isActive ? 'active' : ''}>
                    <Icon /> {t(it.labelKey)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="avatar">{initial}</div>
          <div>{(language === 'en' ? ROLE_LABELS_EN : ROLE_LABELS)[access?.role] || t('app.user')}<br /><small>{email}</small></div>
          <button className="logout" onClick={() => supabase.auth.signOut()}>{t('app.logout')}</button>
        </div>
      </aside>
      <div className={`scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen((v) => !v)} aria-label={t('app.menu')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="pt">{t(active.labelKey)}<small>{t(active.subKey)}</small></div>
          {canAccess(access, permissionForPath('/clients')) && (
            <form className="search topbar-search" role="search" onSubmit={submitGlobalSearch}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                aria-label={t('app.globalSearch')}
                placeholder={t('app.searchPlaceholder')}
                value={globalQuery}
                onChange={(event) => setGlobalQuery(event.target.value)}
              />
            </form>
          )}
          <LanguageToggle compact />
        </header>
        <div className="content">{allowed ? children : <AccessDenied permission={currentPermission} />}</div>
      </div>
      <nav className="bottom-nav" aria-label={t('app.mainNavigation')}>
        {visibleAll.filter((it) => MOBILE_NAV.includes(it.href)).map((it) => {
          const Icon = it.icon;
          const isActive = it.href === pathname || (it.href !== '/' && pathname.startsWith(it.href + '/'));
          return (
            <Link key={it.href} href={it.href} className={isActive ? 'active' : ''}>
              <Icon />
              <span>{t(it.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
      <IOSInstallBanner />
      <Toaster />
    </div>
  );
}

function AccessDenied() {
  const { t } = useLanguage();
  return (
    <div className="card access-denied">
      <div className="mark"><span /><span /><span /><span /></div>
      <h2>{t('access.title')}</h2>
      <p>{t('access.description')}</p>
    </div>
  );
}

// ---------- شاشة البدء (splash) ----------
// ---------- بانر إضافة للشاشة الرئيسية (iPhone فقط، بلا beforeinstallprompt) ----------
function IOSInstallBanner() {
  const { t } = useLanguage();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const isIphone = /iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = localStorage.getItem('tarteeb-a2hs-dismissed') === '1';
    if (isIphone && !isStandalone && !dismissed) setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem('tarteeb-a2hs-dismissed', '1');
    setShow(false);
  }

  return (
    <div className="a2hs-banner">
      <div className="mark"><span /><span /><span /><span /></div>
      <div className="a2hs-txt">
        <b>{t('install.title')}</b>
        <span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 15V3m0 0-4 4m4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
          {t('install.instructions')}
        </span>
      </div>
      <button className="a2hs-close" onClick={dismiss} aria-label={t('common.close')}>✕</button>
    </div>
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="mark"><span /><span /><span /><span /></div>
      <h1>ترتيب</h1>
      <div className="spinner" />
    </div>
  );
}


// ---------- شاشة الدخول ----------
function Login() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [forgotPassword, setForgotPassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!supabaseReady) {
      return;
    }
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setErr(t('auth.invalidCredentials'));
    setBusy(false);
  }

  async function requestPasswordReset(e) {
    e.preventDefault();
    if (!supabaseReady) return;

    setBusy(true); setErr('');
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      setErr(t('auth.resetFailed'));
    } else {
      setSent(true);
    }
    setBusy(false);
  }

  function showLogin() {
    setForgotPassword(false);
    setSent(false);
    setErr('');
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={forgotPassword ? requestPasswordReset : submit}>
        <div className="lhead">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tarteeb-logo.png" alt="ترتيب" className="login-logo" />
          <small>{forgotPassword ? t('auth.resetHelp') : t('auth.loginHelp')}</small>
        </div>
        <div className="login-language"><LanguageToggle /></div>
        {!supabaseReady && <div className="errbar">{t('auth.supabaseMissing')}</div>}
        {err && <div className="errbar">{err}</div>}
        {sent && (
          <div className="login-success" role="status">
            {t('auth.resetSent')}
          </div>
        )}
        <div className="field">
          <label>{t('auth.email')}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" autoComplete="username" />
        </div>
        {!forgotPassword && (
          <div className="field">
            <div className="login-field-head">
              <label>{t('auth.password')}</label>
              <button className="login-link" type="button" onClick={() => { setForgotPassword(true); setErr(''); }}>
                {t('auth.forgotPassword')}
              </button>
            </div>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required dir="ltr" autoComplete="current-password" />
          </div>
        )}
        <button className="btn btn-full" type="submit" disabled={busy || !supabaseReady}>
          {busy ? (forgotPassword ? t('auth.sending') : t('auth.signingIn')) : (forgotPassword ? t('auth.sendReset') : t('auth.signIn'))}
        </button>
        {forgotPassword && (
          <button className="login-link login-back" type="button" onClick={showLogin}>
            {t('auth.backToLogin')}
          </button>
        )}
      </form>
    </div>
  );
}

function ResetPassword() {
  const { t } = useLanguage();
  const router = useRouter();
  const [status, setStatus] = useState('checking');
  const [pw, setPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!supabaseReady) {
      setStatus('invalid');
      return undefined;
    }

    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (mounted && (event === 'PASSWORD_RECOVERY' || nextSession)) setStatus('ready');
    });

    supabase.auth.getSession().then(({ data: { session: recoverySession } }) => {
      if (mounted) setStatus(recoverySession ? 'ready' : 'invalid');
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function updatePassword(e) {
    e.preventDefault();
    setErr('');
    if (pw.length < 8) {
      setErr(t('auth.passwordMin'));
      return;
    }
    if (pw !== confirmPw) {
      setErr(t('auth.passwordMismatch'));
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setErr(t('auth.updateFailed'));
    } else {
      window.history.replaceState({}, '', '/reset-password');
      setStatus('done');
    }
    setBusy(false);
  }

  if (status === 'checking') return <Splash />;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="lhead">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tarteeb-logo.png" alt="ترتيب" className="login-logo" />
          <small>{status === 'done' ? t('auth.resetComplete') : t('auth.choosePassword')}</small>
        </div>

        {status === 'invalid' && (
          <>
            <div className="errbar">{t('auth.invalidReset')}</div>
            <button className="btn btn-full" type="button" onClick={() => router.push('/')}>{t('auth.backToLogin')}</button>
          </>
        )}

        {status === 'done' && (
          <>
            <div className="login-success" role="status">{t('auth.passwordUpdated')}</div>
            <button className="btn btn-full" type="button" onClick={() => router.push('/')}>{t('auth.continue')}</button>
          </>
        )}

        {status === 'ready' && (
          <form onSubmit={updatePassword}>
            {err && <div className="errbar">{err}</div>}
            <div className="field">
              <label>{t('auth.newPassword')}</label>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} dir="ltr" autoComplete="new-password" />
            </div>
            <div className="field">
              <label>{t('auth.confirmPassword')}</label>
              <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required minLength={8} dir="ltr" autoComplete="new-password" />
            </div>
            <p className="login-help">{t('auth.passwordTip')}</p>
            <button className="btn btn-full" type="submit" disabled={busy}>
              {busy ? t('auth.updating') : t('auth.updatePassword')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------- الأيقونات ----------
function IconDash() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>; }
function IconUsers() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" /></svg>; }
function IconChat() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H9l-4 3.5V16H5.5A1.5 1.5 0 0 1 4 14.5z" /><path d="M8 8.5h8M8 11.5h5" /></svg>; }
function IconPrice() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3v18M8.5 7.5a3 3 0 0 1 3-2.5h1a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h1a3 3 0 0 0 3-2.5" /></svg>; }
function IconCalendar() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>; }
function IconBox() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 8.5h16.5a1.5 1.5 0 0 1 1.48 1.76l-1.2 7A1.5 1.5 0 0 1 18.3 18.5H5.7a1.5 1.5 0 0 1-1.48-1.24l-1.2-7A1.5 1.5 0 0 1 3 8.5Z" /><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h7" /></svg>; }
function IconCost() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h3M8 15h3" /><circle cx="15.5" cy="13.5" r="2" /></svg>; }
function IconDoc() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>; }
function IconQuote() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>; }
function IconWarehouse() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 21V9l9-5 9 5v12" /><path d="M7 21v-7h10v7M7 14h10" /></svg>; }
function IconBadge() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="9" r="2.4" /><path d="M8 17a4 4 0 0 1 8 0" /></svg>; }
function IconPin() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>; }
function IconGear() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2l-.4-2.5H9.8l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.5h4.4l.4-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" /></svg>; }
