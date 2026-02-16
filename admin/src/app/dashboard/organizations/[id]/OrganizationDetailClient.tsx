'use client';

import { Organization, Team, User, OrganizationMember } from '@/lib/api';
import { api } from '@/lib/api';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  organization: Organization;
  allTeams: Team[];
  initialMembers: OrganizationMember[];
}

export default function OrganizationDetailClient({ organization, allTeams, initialMembers }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  
  // Organization Members State
  const [members, setMembers] = useState<OrganizationMember[]>(initialMembers);
  const [orgMemberSearchKeyword, setOrgMemberSearchKeyword] = useState('');
  const [orgMemberSearchResults, setOrgMemberSearchResults] = useState<User[]>([]);
  const [selectedOrgMemberId, setSelectedOrgMemberId] = useState<string>('');

  // Team Assignment State
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  
  // Team User Assignment State (Existing)
  const [userSearchKeyword, setUserSearchKeyword] = useState('');
  const [searchedUsers, setSearchedUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [targetTeamIdForUser, setTargetTeamIdForUser] = useState<string>('');

  // 현재 조직에 속한 팀
  const assignedTeams = allTeams.filter((t) => t.organizationId === organization.id);
  
  // 현재 조직에 속하지 않은 팀 (다른 조직에 있거나 무소속)
  const availableTeams = allTeams.filter((t) => t.organizationId !== organization.id);

  // --- Organization Member Logic ---

  const handleSearchOrgMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgMemberSearchKeyword.trim()) return;
    
    setLoading(true);
    try {
      const users = await api.users.search(orgMemberSearchKeyword);
      setOrgMemberSearchResults(users);
      setSelectedOrgMemberId('');
    } catch (err) {
      console.error('Search User Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMemberToOrg = async () => {
    if (!selectedOrgMemberId) return;

    setLoading(true);
    try {
      await api.organizations.addMember(Number(organization.id), parseInt(selectedOrgMemberId), 'MEMBER');
      alert('Member added to workspace successfully!');
      
      // Refresh data
      router.refresh();
      // Optimistically update or wait for refresh. Let's just refresh and maybe re-fetch members if we had an API for it in client, 
      // but router.refresh() updates the server component prop. 
      // To update local state immediately (if router.refresh is slow), we'd need the full member object. 
      // For now, let's rely on router.refresh() and maybe a separate fetch if needed.
      // But we passed `initialMembers` which won't update automatically on client state unless we utilize `useEffect` on props change 
      // or just fully rely on props if we remove local state. 
      // Actually, better to just reload the page or use a router refresh. 
      // Since I initialized state `members` with `initialMembers`, I should probably sync it or just use `initialMembers` directly if I trust the refresh.
      // Let's use `initialMembers` directly in render to respect the server update.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to add member: ${message}`);
    } finally {
      setLoading(false);
      setOrgMemberSearchKeyword('');
      setOrgMemberSearchResults([]);
      setSelectedOrgMemberId('');
    }
  };

  const handleRemoveMemberFromOrg = async (userId: number) => {
    if (!confirm('Remove this user from the workspace?')) return;

    setLoading(true);
    try {
      await api.organizations.removeMember(Number(organization.id), userId);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to remove member: ${message}`);
    } finally {
      setLoading(false);
    }
  };


  // --- Team Logic ---

  const handleAssignTeam = async () => {
    if (!selectedTeamId) return;
    
    setLoading(true);
    try {
      await api.teams.moveOrganization(parseInt(selectedTeamId), Number(organization.id));
      setSelectedTeamId('');
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to assign team: ${message}`);
      console.error('Assign Team Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUnassignTeam = async (teamId: number) => {
    if (!confirm('Remove this team from the workspace?')) return;

    setLoading(true);
    try {
      await api.teams.moveOrganization(teamId, null); 
      router.refresh();
    } catch (err) {
      alert('Failed to unassign team');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchUser = async (e?: React.FormEvent) => {
    if(e) e.preventDefault();
    if (!userSearchKeyword.trim()) return;
    
    setLoading(true);
    try {
      const users = await api.users.search(userSearchKeyword);
      setSearchedUsers(users);
      setSelectedUserId(''); // Reset selection
    } catch (err) {
      console.error('Search User Error:', err);
      alert('Failed to search users');
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!selectedUserId || !targetTeamIdForUser) return;
    
    setLoading(true);
    try {
      await api.teams.addUser(parseInt(targetTeamIdForUser), parseInt(selectedUserId), 'MEMBER');
      alert('User added successfully!');
      
      // Reset states
      setSelectedUserId('');
      setTargetTeamIdForUser('');
      setUserSearchKeyword('');
      setSearchedUsers([]);
      
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to add user: ${message}`);
      console.error('Add User Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrganization = async () => {
    if (!confirm('Are you sure you want to delete this workspace?')) return;

    setLoading(true);
    try {
      await api.organizations.deleteForce(Number(organization.id));
      alert('Workspace deleted successfully');
      router.push('/dashboard/organizations');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to delete workspace: ${message}`);
      console.error('Delete Organization Error:', err);
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      
      {/* LEFT COLUMN */}
      <div className="space-y-8">
        
        {/* 1. Assigned Teams */}
        <div className="retro-card">
          <h3 className="text-xl font-black uppercase text-white mb-4 border-b border-gray-700 pb-2">
            Assigned Teams <span className="text-gray-500 text-base font-normal">({assignedTeams.length})</span>
          </h3>
          
          <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">
            {assignedTeams.map((team) => (
              <div key={team.id} className="bg-gray-900 border border-gray-700 p-4 flex justify-between items-center group hover:border-white transition-colors">
                <div>
                  <div className="font-bold text-white">{team.name}</div>
                  <div className="text-xs text-gray-500 font-mono">ID: {team.id}</div>
                </div>
                <button
                  onClick={() => handleUnassignTeam(team.id)}
                  disabled={loading}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold text-red-500 border border-red-900 px-3 py-1 hover:bg-red-900/20 uppercase"
                >
                  Remove
                </button>
              </div>
            ))}
            
            {assignedTeams.length === 0 && (
              <div className="text-center py-8 text-gray-500 italic">
                No teams assigned to this workspace.
              </div>
            )}
          </div>
        </div>

        {/* 2. Assigned Members (Direct Members) */}
        <div className="retro-card">
          <h3 className="text-xl font-black uppercase text-white mb-4 border-b border-gray-700 pb-2">
            Workspace Members <span className="text-gray-500 text-base font-normal">({initialMembers.length})</span>
          </h3>

          <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">
            {initialMembers.map((member) => (
              <div key={member.userId} className="bg-gray-900 border border-gray-700 p-4 flex justify-between items-center group hover:border-white transition-colors">
                <div>
                  <div className="font-bold text-white">{member.username}</div>
                  <div className="text-xs text-gray-500 font-mono">
                    ID: {member.userId} | Email: {member.email} | Role: {member.role}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveMemberFromOrg(member.userId)}
                  disabled={loading}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold text-red-500 border border-red-900 px-3 py-1 hover:bg-red-900/20 uppercase"
                >
                  Remove
                </button>
              </div>
            ))}
             {initialMembers.length === 0 && (
              <div className="text-center py-8 text-gray-500 italic">
                No members assigned directly to this workspace.
              </div>
            )}
          </div>
        </div>

      </div>

      {/* RIGHT COLUMN */}
      <div className="space-y-6">
        
        {/* 3. Add Team to Unit */}
        <div className="retro-card bg-gray-900/50 border-gray-600">
          <h3 className="text-lg font-bold uppercase text-white mb-4">Add Team to Workspace</h3>
          <div className="flex gap-2">
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="flex-1 bg-black border border-gray-500 text-white p-2 text-sm focus:border-white focus:outline-none"
              disabled={loading}
            >
              <option value="">-- Select Team to Add --</option>
              {availableTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} {team.organizationId ? `(currently in Workspace #${team.organizationId})` : '(Unassigned)'}
                </option>
              ))}
            </select>
            <button
              onClick={handleAssignTeam}
              disabled={!selectedTeamId || loading}
              className="bg-white text-black font-bold uppercase px-4 py-2 text-sm hover:bg-gray-200 disabled:opacity-50"
            >
              {loading ? '...' : 'Add'}
            </button>
          </div>
        </div>

        {/* 4. Add Member to Organization */}
        <div className="retro-card bg-gray-900/50 border-gray-600">
           <h3 className="text-lg font-bold uppercase text-white mb-4">Add Member to Workspace</h3>
            <form onSubmit={handleSearchOrgMember} className="flex gap-2 mb-4">
                <input
                    type="text"
                    placeholder="Search user..."
                    value={orgMemberSearchKeyword}
                    onChange={(e) => setOrgMemberSearchKeyword(e.target.value)}
                    className="flex-1 bg-black border border-gray-500 text-white p-2 text-sm focus:border-white focus:outline-none"
                    disabled={loading}
                />
                <button
                    type="submit"
                    disabled={!orgMemberSearchKeyword || loading}
                    className="bg-white text-black font-bold uppercase px-4 py-2 text-sm hover:bg-gray-200 disabled:opacity-50"
                >
                    Search
                </button>
            </form>

            {orgMemberSearchResults.length > 0 && (
              <div className="space-y-4 border-t border-gray-700 pt-4">
                  <select
                      value={selectedOrgMemberId}
                      onChange={(e) => setSelectedOrgMemberId(e.target.value)}
                      className="w-full bg-black border border-gray-500 text-white p-2 text-sm focus:border-white focus:outline-none"
                      disabled={loading}
                  >
                      <option value="">-- Select User --</option>
                      {orgMemberSearchResults.map((user) => (
                          <option key={user.id} value={user.id}>
                              {user.username} ({user.email})
                          </option>
                      ))}
                  </select>
                   <button
                        onClick={handleAddMemberToOrg}
                        disabled={!selectedOrgMemberId || loading}
                        className="w-full bg-green-600 text-white font-bold uppercase px-4 py-2 text-sm hover:bg-green-500 disabled:opacity-50"
                    >
                        {loading ? 'Adding...' : 'Add to Workspace'}
                    </button>
              </div>
            )}
             {orgMemberSearchResults.length === 0 && orgMemberSearchKeyword && !loading && (
                 <p className="text-xs text-gray-500 italic">No users found.</p>
            )}
        </div>

        {/* 5. Add User to Unit Team (Deep Assignment) */}
        <div className="retro-card bg-gray-900/50 border-gray-600">
            <h3 className="text-lg font-bold uppercase text-white mb-4">Add User to Workspace Team</h3>
            
            <form onSubmit={handleSearchUser} className="flex gap-2 mb-4">
                <input
                    type="text"
                    placeholder="Search user..."
                    value={userSearchKeyword}
                    onChange={(e) => setUserSearchKeyword(e.target.value)}
                    className="flex-1 bg-black border border-gray-500 text-white p-2 text-sm focus:border-white focus:outline-none"
                    disabled={loading}
                />
                <button
                    type="submit"
                    disabled={!userSearchKeyword || loading}
                    className="bg-white text-black font-bold uppercase px-4 py-2 text-sm hover:bg-gray-200 disabled:opacity-50"
                >
                    Search
                </button>
            </form>

            {searchedUsers.length > 0 && (
                <div className="space-y-4 border-t border-gray-700 pt-4">
                    <div>
                        <label className="block text-xs text-gray-500 uppercase mb-1">1. Select User</label>
                        <select
                            value={selectedUserId}
                            onChange={(e) => setSelectedUserId(e.target.value)}
                            className="w-full bg-black border border-gray-500 text-white p-2 text-sm focus:border-white focus:outline-none"
                            disabled={loading}
                        >
                            <option value="">-- Select User --</option>
                            {searchedUsers.map((user) => (
                                <option key={user.id} value={user.id}>
                                    {user.username} ({user.email})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                         <label className="block text-xs text-gray-500 uppercase mb-1">2. Select Target Team</label>
                         <select
                            value={targetTeamIdForUser}
                            onChange={(e) => setTargetTeamIdForUser(e.target.value)}
                            className="w-full bg-black border border-gray-500 text-white p-2 text-sm focus:border-white focus:outline-none"
                            disabled={loading}
                         >
                             <option value="">-- Select Team within this Workspace --</option>
                             {assignedTeams.map((team) => (
                                 <option key={team.id} value={team.id}>
                                     {team.name}
                                 </option>
                             ))}
                         </select>
                         {assignedTeams.length === 0 && (
                             <p className="text-xs text-red-500 mt-1">No teams in this workspace. Add a team first.</p>
                         )}
                    </div>

                    <button
                        onClick={handleAddUser}
                        disabled={!selectedUserId || !targetTeamIdForUser || loading}
                        className="w-full bg-blue-600 text-white font-bold uppercase px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-50"
                    >
                        {loading ? 'Adding...' : 'Add User to Team'}
                    </button>
                </div>
            )}
        </div>

        {/* Info / Stats Placeholder */}
        <div className="p-4 border border-gray-800 text-gray-500 text-sm font-mono">
          <p className="mb-2">WORKSPACE STATISTICS</p>
          <div className="grid grid-cols-2 gap-4">
             <div>
               <span className="block text-xs text-gray-600">Total Members</span>
               <span className="text-white text-xl font-bold">{initialMembers.length}</span>
             </div>
             <div>
               <span className="block text-xs text-gray-600">Active Projects</span>
               <span className="text-white text-xl font-bold">-</span>
             </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="retro-card bg-red-900/10 border-red-900/50">
          <h3 className="text-lg font-bold uppercase text-red-500 mb-4">Danger Zone</h3>
          <div className="flex justify-between items-center">
             <div>
               <div className="font-bold text-white uppercase">Delete Workspace</div>
               <div className="text-xs text-gray-500">
                 Permanently remove this workspace and all its data associations.
               </div>
             </div>
             <button
               onClick={handleDeleteOrganization}
               disabled={loading}
               className="bg-red-600 text-white font-bold uppercase px-4 py-2 text-sm hover:bg-red-700 disabled:opacity-50"
             >
               {loading ? 'Deleting...' : 'Delete Workspace'}
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}