'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginClient() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push('/dashboard');
      } else {
        const data = await res.json();
        setError(data.message || 'Login failed');
      }
    } catch (err) {
      setError('An error occurred');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[url('/grid.svg')]">
      <div className="w-full max-w-md retro-card">
        <div className="mb-8 text-center border-b-2 border-white pb-6">
          <h1 className="text-4xl font-black uppercase tracking-[0.2em] text-white drop-shadow-md">
            System<br/>Access
          </h1>
          <p className="mt-2 text-sm text-gray-400">Restricted Area // Level 5 Authorization</p>
        </div>
        
        {error && (
          <div className="mb-6 p-3 border-2 border-red-500 bg-red-900/20 text-red-500 font-bold text-center uppercase text-sm">
            ⚠ {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="retro-label">Identity</label>
            <input
              type="text"
              className="retro-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="ENTER USERNAME"
            />
          </div>
          
          <div>
            <label className="retro-label">Credentials</label>
            <input
              type="password"
              className="retro-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          <div className="pt-4">
            <button type="submit" className="w-full retro-btn">
              Authenticate
            </button>
          </div>
        </form>
        
        <div className="mt-8 text-center">
           <p className="text-xs text-gray-600 uppercase">Secure Connection Established</p>
        </div>
      </div>
    </div>
  );
}