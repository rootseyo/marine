import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Not Found',
};

export default function FakeNotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
      <h1 className="text-6xl font-bold mb-4">404</h1>
      <h2 className="text-2xl mb-8 uppercase tracking-widest">Page Not Found</h2>
      <p className="mb-8 opacity-80 max-w-md">
        The requested data sector has not been initialized. 
        Please check your coordinates.
      </p>
      <div className="animate-pulse">
        _
      </div>
    </div>
  );
}
