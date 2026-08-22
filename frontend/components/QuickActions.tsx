import {
  ArrowUpRight,
  BarChart3,
  FilePlus2,
  Repeat,
  ScanText,
  Users2,
} from "lucide-react";

const secondary = [
  {
    href: "expense-new.html",
    title: "Yeni Gider",
    hint: "Fiş tara & OCR",
    Icon: ScanText,
    iconClass: "text-amber-600 bg-amber-50 group-hover:bg-amber-100",
  },
  {
    href: "invoice-template.html",
    title: "Otomatik Fatura",
    hint: "Her ay tekrarla",
    Icon: Repeat,
    iconClass: "text-blue-600 bg-blue-50 group-hover:bg-blue-100",
  },
  {
    href: "accounts.html",
    title: "Cari Hesaplar",
    hint: "Alacak & borç",
    Icon: Users2,
    iconClass: "text-indigo-600 bg-indigo-50 group-hover:bg-indigo-100",
  },
  {
    href: "reports.html",
    title: "Raporlar",
    hint: "KDV & nakit özeti",
    Icon: BarChart3,
    iconClass: "text-emerald-600 bg-emerald-50 group-hover:bg-emerald-100",
  },
] as const;

export default function QuickActions() {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <h2 className="mb-4 text-base font-semibold text-slate-900">Hızlı İşlemler</h2>

      <a
        href="invoice-new.html"
        className="flex h-16 w-full items-center rounded-xl bg-blue-600 p-3.5 text-white shadow-sm shadow-blue-500/20 transition-all hover:bg-blue-700 active:scale-[0.99]"
      >
        <span className="mr-3.5 rounded-lg bg-white/15 p-2.5">
          <FilePlus2 size={20} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-semibold">Yeni Fatura Kes</span>
          <span className="block text-xs text-blue-100/90">2 dakikada e-fatura oluştur</span>
        </span>
        <ArrowUpRight className="h-4 w-4 text-blue-200" />
      </a>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {secondary.map(({ href, title, hint, Icon, iconClass }) => (
          <a
            key={href}
            href={href}
            className="group flex items-center rounded-xl border border-slate-200/90 bg-white p-3 text-left transition-all hover:border-slate-300 hover:bg-slate-50/80 active:scale-[0.98]"
          >
            <span className={`mr-2.5 rounded-lg p-2.5 transition-colors ${iconClass}`}>
              <Icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-800">{title}</span>
              <span className="block line-clamp-1 text-[11px] text-slate-500">{hint}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
