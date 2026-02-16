import { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Organizations',
};

export default async function OrganizationsPage() {
  const organizations = await prisma.organization.findMany({
    include: {
      owner: true,
      members: {
        include: {
          user: true
        }
      },
      sites: true
    },
    orderBy: { created_at: 'desc' }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end border-b-2 border-white pb-4 mb-8">
        <div>
          <h2 className="text-4xl font-black uppercase tracking-widest text-white">Organizations</h2>
          <p className="text-gray-400 mt-1">Global Business Units</p>
        </div>
      </div>

      <div className="retro-card p-0 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-900 border-b-2 border-white text-gray-400 uppercase text-sm tracking-wider">
              <th className="p-4 border-r border-gray-700">Organization Name</th>
              <th className="p-4 border-r border-gray-700">Owner</th>
              <th className="p-4 border-r border-gray-700">Members</th>
              <th className="p-4 border-r border-gray-700">Sites</th>
              <th className="p-4 border-r border-gray-700">Created</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {organizations.map((org) => (
              <tr key={org.id} className="border-b border-gray-800 hover:bg-gray-900/50 transition-colors">
                <td className="p-4 border-r border-gray-800 font-bold">
                  <Link href={`/dashboard/organizations/${org.id}`} className="hover:text-yellow-400 transition-colors">
                    {org.name}
                  </Link>
                </td>
                <td className="p-4 border-r border-gray-800">
                  <div className="text-sm font-bold">{org.owner.name}</div>
                  <div className="text-xs text-gray-500">{org.owner.email}</div>
                </td>
                <td className="p-4 border-r border-gray-800 text-center font-mono">
                  {org.members.length}
                </td>
                <td className="p-4 border-r border-gray-800 text-center font-mono text-blue-400 font-bold">
                  {org.sites.length}
                </td>
                <td className="p-4 border-r border-gray-800 font-mono text-sm text-gray-400">
                  {new Date(org.created_at).toLocaleDateString()}
                </td>
                <td className="p-4 text-center">
                  <Link 
                    href={`/dashboard/organizations/${org.id}`}
                    className="text-xs uppercase font-bold text-white hover:underline"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
            {organizations.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500 italic">
                  No organizations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
