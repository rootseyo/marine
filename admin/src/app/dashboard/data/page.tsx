import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data',
};

export default function DataPage() {
  return (
    <div className="space-y-6">
      <div className="border-b-2 border-white pb-4 mb-8">
        <h2 className="text-4xl font-black uppercase tracking-widest text-white">Data I/O</h2>
        <p className="text-gray-400 mt-1">System Import & Export Controls</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="retro-card border-dashed border-gray-600 hover:border-white transition-colors flex flex-col items-center justify-center p-12 text-center group cursor-pointer">
          <div className="w-16 h-16 border-2 border-gray-600 group-hover:border-white mb-4 flex items-center justify-center rounded-full">
            <span className="text-2xl text-gray-500 group-hover:text-white">↓</span>
          </div>
          <h3 className="text-xl font-bold uppercase text-white mb-2">Import Data</h3>
          <p className="text-sm text-gray-500 mb-6">Upload CSV / JSON files to update system records.</p>
          <button className="retro-btn text-xs px-4 py-2">Select File</button>
        </div>

        <div className="retro-card border-dashed border-gray-600 hover:border-white transition-colors flex flex-col items-center justify-center p-12 text-center group cursor-pointer">
          <div className="w-16 h-16 border-2 border-gray-600 group-hover:border-white mb-4 flex items-center justify-center rounded-full">
            <span className="text-2xl text-gray-500 group-hover:text-white">↑</span>
          </div>
          <h3 className="text-xl font-bold uppercase text-white mb-2">Export Data</h3>
          <p className="text-sm text-gray-500 mb-6">Download full system backup or specific reports.</p>
          <button className="retro-btn text-xs px-4 py-2">Generate Report</button>
        </div>
      </div>
    </div>
  );
}
