'use client';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card access-denied">
      <div className="mark"><span /><span /><span /><span /></div>
      <h2>الصفحة غير موجودة</h2>
      <p>الرابط الذي فتحته غير صحيح أو أُزيل.</p>
      <Link className="btn" href="/" style={{ marginTop: 14, display: 'inline-flex' }}>الرجوع للوحة المعلومات</Link>
    </div>
  );
}
