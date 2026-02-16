'use client';

import { Organization, Team } from '@/lib/api';
import Link from 'next/link';

interface OrganizationListProps {
  organizations: Organization[];
  teams: Team[];
}

export default function OrganizationList({ organizations, teams }: OrganizationListProps) {
  if (organizations.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No workspaces found.
      </div>
    );
  }

  return (
    <div className="retro-card p-0 overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-gray-900 border-b-2 border-white text-gray-400 uppercase text-sm tracking-wider">
            <th className="p-4 border-r border-gray-700 w-20">ID</th>
            <th className="p-4 border-r border-gray-700">Workspace Name</th>
            <th className="p-4 border-r border-gray-700">Teams</th>
            <th className="p-4">Actions</th>
          </tr>
        </thead>
        <tbody className="text-gray-300">
          {organizations.map((org: any) => {
            const orgId = org.id || org.organizationId;
            const orgName = org.name || org.organizationName;
            
            // 해당 조직에 속한 팀 필터링
            const orgTeams = teams.filter((t: any) => (t.organizationId || t.organization_id) === orgId);

            return (
              <tr key={orgId} className="border-b border-gray-800 hover:bg-gray-900/50 transition-colors">
                <td className="p-4 border-r border-gray-800 font-mono text-sm">
                  {orgId}
                </td>
                <td className="p-4 border-r border-gray-800">
                  <div className="font-bold text-white text-lg">{orgName}</div>
                </td>
                <td className="p-4 border-r border-gray-800">
                  <div className="flex flex-wrap gap-2">
                    <span className="bg-gray-800 text-gray-400 px-2 py-0.5 rounded text-xs font-mono mr-2">
                      Count: {orgTeams.length}
                    </span>
                    {orgTeams.slice(0, 3).map((team: any) => (
                      <span key={team.id || team.teamId} className="text-xs text-gray-500 border border-gray-800 px-1">
                        {team.name || team.teamName}
                      </span>
                    ))}
                    {orgTeams.length > 3 && (
                      <span className="text-[10px] text-gray-600 italic">+{orgTeams.length - 3} more</span>
                    )}
                  </div>
                </td>
                <td className="p-4">
                  <Link 
                    href={`/dashboard/organizations/${orgId}`}
                    className="text-xs font-bold text-yellow-400 hover:underline tracking-widest uppercase"
                  >
                    View Details &rarr;
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}