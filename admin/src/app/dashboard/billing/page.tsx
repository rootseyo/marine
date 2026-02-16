import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Billing',
};

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <div className="border-b-2 border-white pb-4 mb-8">
        <h2 className="text-4xl font-black uppercase tracking-widest text-white">Billing</h2>
        <p className="text-gray-400 mt-1">Financial Transaction Records</p>
      </div>

      <div className="flex gap-6 mb-8">
        <div className="retro-card flex-1">
          <p className="text-gray-500 uppercase text-xs mb-1">Total Revenue</p>
          <p className="text-3xl font-black text-white">$ 1,204,500</p>
        </div>
        <div className="retro-card flex-1">
          <p className="text-gray-500 uppercase text-xs mb-1">Outstanding</p>
          <p className="text-3xl font-black text-red-500">$ 4,200</p>
        </div>
        <div className="retro-card flex-1">
          <p className="text-gray-500 uppercase text-xs mb-1">Next Payout</p>
          <p className="text-3xl font-black text-white">Oct 12</p>
        </div>
      </div>

      <div className="retro-card p-6">
        <h3 className="text-xl font-bold uppercase mb-4 text-white border-b border-gray-700 pb-2">Recent Invoices</h3>
        <ul className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <li key={i} className="flex justify-between items-center border-b border-gray-800 pb-2 last:border-0">
              <div>
                <p className="font-bold text-white">Invoice #00{i}92</p>
                <p className="text-xs text-gray-500">Issued: 2026-01-0{i}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-white">$ {i * 150}.00</p>
                <span className="text-[10px] uppercase bg-green-900 text-green-400 px-1 border border-green-700">Paid</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
