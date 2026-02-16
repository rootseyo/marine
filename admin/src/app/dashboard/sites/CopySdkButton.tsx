'use client';

import { useState } from 'react';

export default function CopySdkButton({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false);
  const scriptTag = `<script src="https://api.brightnetworks.kr/sdk.js?key=${apiKey}" async></script>`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scriptTag);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${
        copied 
          ? 'bg-green-600 border-green-400 text-white' 
          : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-white hover:text-white'
      }`}
    >
      {copied ? 'COPIED!' : 'COPY SDK'}
    </button>
  );
}
