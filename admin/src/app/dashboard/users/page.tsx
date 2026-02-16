import { Metadata } from 'next';
import UserSearch from './UserSearch';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Users',
};

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export default async function UsersPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const keyword = q || '';
  
  // Fetch Users using Prisma from the Marine database
  const users = await prisma.user.findMany({
    where: keyword ? {
      OR: [
        { email: { contains: keyword, mode: 'insensitive' } },
        { name: { contains: keyword, mode: 'insensitive' } },
      ]
    } : undefined,
    orderBy: { created_at: 'desc' }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end border-b-2 border-white pb-4 mb-8">
        <div>
          <h2 className="text-4xl font-black uppercase tracking-widest text-white">Users</h2>
          <p className="text-gray-400 mt-1">System User Management Directory</p>
        </div>
      </div>

      <UserSearch />

      <div className="retro-card p-0 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-900 border-b-2 border-white text-gray-400 uppercase text-sm tracking-wider">
              <th className="p-4 border-r border-gray-700">User</th>
              <th className="p-4 border-r border-gray-700">Email</th>
              <th className="p-4 border-r border-gray-700">Google ID</th>
              <th className="p-4 border-r border-gray-700">Joined</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {users.map((user) => (
              <tr key={user.id} className="border-b border-gray-800 hover:bg-gray-900/50 transition-colors">
                <td className="p-4 border-r border-gray-800 font-bold">
                  <Link href={`/dashboard/users/${user.id}`} className="hover:text-yellow-400 transition-colors">
                    {user.name || 'N/A'}
                  </Link>
                </td>
                <td className="p-4 border-r border-gray-800 font-mono text-sm">
                  {user.email}
                </td>
                <td className="p-4 border-r border-gray-800 font-mono text-xs text-gray-500">
                  {user.google_id}
                </td>
                <td className="p-4 border-r border-gray-800 font-mono text-sm text-gray-400">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td className="p-4">
                  <Link 
                    href={`/dashboard/users/${user.id}`}
                    className="text-xs uppercase font-bold text-white hover:underline mr-4"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-500 italic">
                  No users found matching query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}