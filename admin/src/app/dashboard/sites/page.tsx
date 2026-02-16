import { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import CopySdkButton from './CopySdkButton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sites',
};

export default async function SitesPage() {
  const sites = await prisma.site.findMany({
    include: {
      organization: {
        include: {
          owner: true
        }
      }
    },
    orderBy: { created_at: 'desc' }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end border-b-2 border-white pb-4 mb-8">
        <div>
          <h2 className="text-4xl font-black uppercase tracking-widest text-white">Sites</h2>
          <p className="text-gray-400 mt-1">Managed Customer Websites</p>
        </div>
      </div>

      <div className="retro-card p-0 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-900 border-b-2 border-white text-gray-400 uppercase text-sm tracking-wider">
              <th className="p-4 border-r border-gray-700">Site URL</th>
              <th className="p-4 border-r border-gray-700">Organization</th>
              <th className="p-4 border-r border-gray-700">SEO Score</th>
              <th className="p-4 border-r border-gray-700 text-center">Status</th>
              <th className="p-4 border-r border-gray-700 text-center">Actions</th>
              <th className="p-4">API Key</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {sites.map((site) => (
              <tr key={site.id} className="border-b border-gray-800 hover:bg-gray-900/50 transition-colors">
                <td className="p-4 border-r border-gray-800">
                  <div className="font-bold text-white">{site.url}</div>
                </td>
                <td className="p-4 border-r border-gray-800">
                  {site.organization ? (
                    <Link href={`/dashboard/organizations/${site.organization.id}`} className="hover:text-blue-400">
                      <div className="text-sm font-bold">{site.organization.name}</div>
                      <div className="text-xs text-gray-500">{site.organization.owner.email}</div>
                    </Link>
                  ) : (
                    <span className="text-gray-600 italic text-sm">Orphaned</span>
                  )}
                </td>
                <td className="p-4 border-r border-gray-800 text-center">
                  <span className={`font-mono font-bold ${
                    (site.seo_score || 0) > 80 ? 'text-green-400' : 
                    (site.seo_score || 0) > 50 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {site.seo_score ?? 'N/A'}
                  </span>
                </td>
                <td className="p-4 border-r border-gray-800 text-center font-mono text-sm">
                  {site.deleted_at ? (
                    <span className="text-red-500 border border-red-900 bg-red-900/20 px-2 py-1 rounded text-xs">DELETED</span>
                  ) : (
                    <span className="text-green-500 border border-green-900 bg-green-900/20 px-2 py-1 rounded text-xs">ACTIVE</span>
                  )}
                </td>
                <td className="p-4 border-r border-gray-800 text-center">
                  <div className="flex flex-col gap-2 items-center">
                    <Link 
                      href={`/dashboard/sites/${site.id}`}
                      className="text-xs font-bold text-blue-400 border border-blue-900 px-3 py-1 hover:bg-blue-900/20 uppercase w-full text-center"
                    >
                      Manage
                    </Link>
                    <CopySdkButton apiKey={site.api_key} />
                  </div>
                </td>
                <td className="p-4 font-mono text-xs text-gray-500 truncate max-w-[150px]">
                  {site.api_key}
                </td>
              </tr>
            ))}
            {sites.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500 italic">
                  No sites found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
