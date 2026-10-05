"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/organizations", label: "Empresas" },
  { href: "/invoices", label: "Facturas" },
];

export function Sidebar({ email, signOut }: { email: string; signOut: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white md:min-h-screen md:w-60 md:border-b-0 md:border-r">
      <div className="px-5 py-4">
        <p className="text-base font-semibold tracking-tight">Nixgo Billing</p>
        <p className="text-xs text-slate-500">Facturación electrónica · Ecuador</p>
      </div>
      <nav className="flex gap-1 px-3 pb-3 md:flex-1 md:flex-col md:pb-0">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3 md:block">
        <p className="truncate text-xs text-slate-500">{email}</p>
        <form action={signOut}>
          <button type="submit" className="text-xs font-medium text-slate-700 hover:text-indigo-700 md:mt-1">
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
