'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function UserSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(searchParams.get('q') || '');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/dashboard/users?q=${encodeURIComponent(term)}`);
  };

  return (
    <form onSubmit={handleSearch} className="flex gap-2 mb-6">
      <input
        type="text"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search users..."
        className="bg-black border border-gray-600 text-white px-4 py-2 w-full max-w-md focus:outline-none focus:border-white"
      />
      <button
        type="submit"
        className="retro-btn text-sm px-6 py-2"
      >
        Search
      </button>
    </form>
  );
}
