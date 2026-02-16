'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const menuItems = [
    { name: 'Users', path: '/dashboard/users' },
    { name: 'Organizations', path: '/dashboard/organizations' },
    { name: 'Sites', path: '/dashboard/sites' },
    { name: 'Billing', path: '/dashboard/billing' },
    { name: 'Data', path: '/dashboard/data' },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-black text-white font-mono">
      {/* Left Sidebar */}
      <aside className="w-64 border-r-2 border-white flex flex-col relative z-10 shadow-[8px_0_0_0_#444]">
        <div className="p-6 border-b-2 border-white bg-black">
          <h1 className="text-2xl font-black uppercase tracking-widest">
            Bright<br />Networks
          </h1>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          {menuItems.map((item) => {
            const isActive = pathname.startsWith(item.path);
            return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`block px-4 py-3 border-2 transition-all duration-150 font-bold tracking-wider ${
                    isActive
                      ? 'border-white bg-white text-black translate-x-[2px] translate-y-[2px]'
                      : 'border-transparent text-gray-400 hover:text-white hover:border-gray-700'
                  }`}
                >
                  {item.name}
                </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t-2 border-white text-xs text-center text-gray-500">
          SYSTEM V.0.1
        </div>
      </aside>

      {/* Right Content Area */}
      <main className="flex-1 overflow-auto bg-[#111] p-8 relative">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
