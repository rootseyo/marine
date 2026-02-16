'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface AddOrganizationModalProps {
  onClose: () => void;
}

export default function AddOrganizationModal({ onClose }: AddOrganizationModalProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError('');

    try {
      await api.organizations.create(name);
      router.refresh(); // 목록 새로고침
      onClose(); // 모달 닫기
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-black border-2 border-white p-8 max-w-md w-full shadow-[8px_8px_0_0_#444]">
        <div className="flex justify-between items-center mb-6 border-b-2 border-white pb-2">
          <h2 className="text-xl font-black uppercase tracking-wider text-white">
            New Workspace
          </h2>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white font-mono text-xl"
          >
            [X]
          </button>
        </div>

        {error && (
          <div className="mb-4 p-2 bg-red-900/50 border border-red-500 text-red-400 text-xs uppercase font-bold text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="retro-label">Workspace Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="retro-input"
              placeholder="ENTER WORKSPACE NAME"
              autoFocus
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-gray-500 text-gray-400 px-4 py-2 text-sm font-bold hover:text-white hover:border-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="retro-btn text-sm py-2 px-6"
            >
              {loading ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
