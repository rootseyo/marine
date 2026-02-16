import { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { serverFetch } from '@/lib/server-api';
import { User, Team, Organization } from '@/lib/api';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'User Details',
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
};

interface UserDetail extends User {
  type: 'ADMIN' | 'APP';
  updateAt?: string;
}

export default async function UserDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { type } = await searchParams;
  const userId = parseInt(id);

  let user: UserDetail | null = null;
  let userTeams: Team[] = [];
  let organizations: Organization[] = [];

  // Fetch organizations globally as we need them for mapping
  try {
    organizations = await serverFetch<Organization[]>('/api/admin/organizations').catch(() => []);
  } catch (e) { console.error(e); }

  if (type === 'ADMIN') {
    const adminUser = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (adminUser) {
        user = { 
            id: adminUser.id,
            username: adminUser.username,
            email: adminUser.email || undefined,
            createAt: adminUser.createdAt.toISOString(),
            oauthProvider: 'SYSTEM',
            type: 'ADMIN'
        };
    }
  } else {
    // APP user (Luffy)
    try {
        const [appUser, teams] = await Promise.all([
          serverFetch<User>(`/api/admin/users/${userId}`),
          serverFetch<Team[]>(`/api/admin/users/${userId}/teams`).catch(() => [])
        ]);
        
        if(appUser) {
            user = { ...appUser, type: 'APP' };
            userTeams = teams;
        }
    } catch(e) {
        console.error("Fetch user error", e);
    }
  }

  if (!user) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end border-b-2 border-white pb-4 mb-8">
        <div>
          <div className="text-gray-500 text-xs font-bold uppercase mb-1 tracking-widest">
            <Link href="/dashboard/users" className="hover:text-white transition-colors">
              &larr; Back to Users
            </Link>
          </div>
          <h2 className="text-4xl font-black tracking-widest text-white">
            {user.username}
          </h2>
          <p className="text-gray-400 mt-1 font-mono text-sm flex items-center gap-2">
            USER ID: {user.id} 
            {user.type === 'ADMIN' ? (
                <span className="text-yellow-400 border border-yellow-900 bg-yellow-900/20 px-1 text-[10px] rounded uppercase">Admin</span>
            ) : (
                <span className="text-blue-400 border border-blue-900 bg-blue-900/20 px-1 text-[10px] rounded uppercase">App User</span>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Profile Card */}
        <div className="retro-card">
            <h3 className="text-xl font-black uppercase text-white mb-6 border-b border-gray-700 pb-2">Profile Information</h3>
            
            <div className="space-y-4 font-mono text-sm">
                <div className="grid grid-cols-3 border-b border-gray-800 pb-2">
                    <span className="text-gray-500 uppercase">Username</span>
                    <span className="col-span-2 text-white">{user.username}</span>
                </div>
                <div className="grid grid-cols-3 border-b border-gray-800 pb-2">
                    <span className="text-gray-500 uppercase">Email</span>
                    <span className="col-span-2 text-white">{user.email || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-3 border-b border-gray-800 pb-2">
                    <span className="text-gray-500 uppercase">Joined</span>
                    <span className="col-span-2 text-white">
                        {user.createAt ? new Date(user.createAt).toLocaleString() : '-'}
                    </span>
                </div>
                 <div className="grid grid-cols-3 border-b border-gray-800 pb-2">
                    <span className="text-gray-500 uppercase">Provider</span>
                    <span className="col-span-2 text-white">{user.oauthProvider || 'EMAIL'}</span>
                </div>
                 <div className="grid grid-cols-3 border-b border-gray-800 pb-2">
                    <span className="text-gray-500 uppercase">Last Login</span>
                    <span className="col-span-2 text-white">
                         {/* Display updateAt as proxy for last activity/login if available */}
                        {user.updateAt ? new Date(user.updateAt).toLocaleString() : '-'}
                    </span>
                </div>
            </div>
        </div>

        {/* Account Status */}
        <div className="retro-card bg-gray-900/50 border-gray-600">
             <h3 className="text-xl font-black uppercase text-white mb-6 border-b border-gray-600 pb-2">Account Status</h3>
             <div className="space-y-4">
                 <div className="flex items-center justify-between">
                     <span className="text-gray-400 uppercase text-sm">Active</span>
                     <span className="text-green-400 font-bold uppercase">Yes</span>
                 </div>
                  <div className="flex items-center justify-between">
                     <span className="text-gray-400 uppercase text-sm">Verified</span>
                     <span className="text-white font-bold uppercase">
                         {user.email ? 'Yes' : 'No'}
                     </span>
                 </div>
                 
                 <div className="mt-8 pt-4 border-t border-gray-700">
                     <button className="w-full border border-red-900 text-red-500 uppercase font-bold py-2 hover:bg-red-900/20 transition-colors">
                         Delete Account
                     </button>
                 </div>
             </div>
        </div>

        {/* Affiliated Teams & Units (Only for APP users) */}
        {user.type === 'APP' && (
          <div className="retro-card md:col-span-2">
            <h3 className="text-xl font-black uppercase text-white mb-6 border-b border-gray-700 pb-2">
              Affiliated Teams & Units
            </h3>
            
            {userTeams.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {userTeams.map(team => {
                   const org = organizations.find(o => o.id === team.organizationId);
                   return (
                      <Link href={`/dashboard/teams/${team.id}`} key={team.id} className="block group">
                        <div className="bg-gray-900 border border-gray-700 p-4 hover:border-white transition-colors relative">
                           <div className="mb-2">
                              <span className="text-xs text-gray-500 uppercase block mb-1">Team</span>
                              <h4 className="text-white font-bold text-lg group-hover:text-yellow-400 transition-colors">
                                {team.name}
                              </h4>
                           </div>
                           <div className="border-t border-gray-800 pt-2 mt-2">
                              <span className="text-xs text-gray-500 uppercase block mb-1">Organization (Unit)</span>
                              <div className="text-gray-300 font-mono text-sm">
                                 {org ? org.name : <span className="text-gray-600 italic">Unassigned</span>}
                              </div>
                           </div>
                           <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-[10px] text-yellow-400 font-bold border border-yellow-900 px-1">VIEW</span>
                           </div>
                        </div>
                      </Link>
                   );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 italic border border-gray-800 bg-gray-900/30">
                User is not assigned to any teams.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
