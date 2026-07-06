// يُعاد تركيبه عند كل تنقّل، فيعيد تشغيل حركة دخول الصفحة (بديل View Transitions على Next 14)
export default function Template({ children }) {
  return <div className="page-enter">{children}</div>;
}
