import { redirect } from 'next/navigation';

// أبقينا جداول الشركاء وبياناتها محفوظة، لكن الصفحة القديمة استُبدلت بمصاريف الشركة.
export default function PartnersRedirect() {
  redirect('/company-expenses');
}
