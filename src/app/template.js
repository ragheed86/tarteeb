'use client';
// يُعاد تركيبه عند كل تنقّل، فيعيد تشغيل حركة دخول الصفحة (بديل View Transitions على Next 14)
// يُزال الكلاس بعد انتهاء الحركة: أنيميشن transform يجعل الغلاف containing block
// فتتموضع النوافذ المنبثقة position:fixed داخله وتنقطع عن الشاشة
export default function Template({ children }) {
  return (
    <div
      className="page-enter"
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('page-enter'); }}
    >
      {children}
    </div>
  );
}
