'use client';

import { useState } from 'react';
import { updateAutomationConfig } from './actions';
import { useRouter } from 'next/navigation';

export default function SiteDetailClient({ site }: { site: any }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  
  const initialAutomation = site.scraped_data?.automation || {
    social_proof: { enabled: true, template: "{location} {customer}님이 {product}를 방금 구매했습니다!" },
    exit_intent: { enabled: true, text: "잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요..." }
  };

  const [config, setConfig] = useState(initialAutomation);

  const handleSave = async () => {
    setLoading(true);
    const res = await updateAutomationConfig(site.id, config);
    setLoading(false);
    if (res.success) {
      alert('Settings saved successfully!');
      router.refresh();
    } else {
      alert('Failed to save: ' + res.error);
    }
  };

  const updateSocialProof = (key: string, value: any) => {
    setConfig({
      ...config,
      social_proof: { ...config.social_proof, [key]: value }
    });
  };

  const updateExitIntent = (key: string, value: any) => {
    setConfig({
      ...config,
      exit_intent: { ...config.exit_intent, [key]: value }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-8">
        {/* 1. Social Proof Settings */}
        <div className="retro-card">
          <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
            <h3 className="text-xl font-black uppercase text-white">Social Proof</h3>
            <label className="inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                checked={config.social_proof.enabled} 
                onChange={(e) => updateSocialProof('enabled', e.target.checked)}
                className="sr-only peer" 
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1 font-bold">Message Template</label>
              <textarea
                value={config.social_proof.template}
                onChange={(e) => updateSocialProof('template', e.target.value)}
                rows={3}
                className="w-full bg-black border border-gray-700 text-white p-3 text-sm focus:border-blue-500 focus:outline-none font-mono"
                placeholder="{location} {customer}님이 {product}를 방금 구매했습니다!"
              />
              <p className="text-[10px] text-gray-600 mt-1">Available placeholders: {"{location}"}, {"{customer}"}, {"{product}"}, {"{time}"}</p>
            </div>
          </div>
        </div>

        {/* 2. Exit Intent Settings */}
        <div className="retro-card">
          <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
            <h3 className="text-xl font-black uppercase text-white">Exit Intent</h3>
            <label className="inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                checked={config.exit_intent.enabled} 
                onChange={(e) => updateExitIntent('enabled', e.target.checked)}
                className="sr-only peer" 
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1 font-bold">Modal Text</label>
              <textarea
                value={config.exit_intent.text}
                onChange={(e) => updateExitIntent('text', e.target.value)}
                rows={3}
                className="w-full bg-black border border-gray-700 text-white p-3 text-sm focus:border-blue-500 focus:outline-none font-mono"
                placeholder="잠시만요! 🏃‍♂️ 지금 나가시기엔 너무 아쉬운 혜택이 있어요..."
              />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* SDK Preview / Info */}
        <div className="retro-card bg-gray-900/50 border-gray-600">
          <h3 className="text-lg font-bold uppercase text-white mb-4">Implementation</h3>
          <p className="text-sm text-gray-400 mb-4">Add this script to your website's <code>&lt;head&gt;</code> or via GTM Custom HTML Tag.</p>
          <div className="bg-black p-4 border border-gray-800 rounded font-mono text-xs text-blue-300 break-all select-all">
            {`<script src="https://api.brightnetworks.kr/sdk.js?key=${site.api_key}" async></script>`}
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full bg-blue-600 text-white font-black uppercase py-4 rounded-none border-2 border-blue-400 shadow-[4px_4px_0px_0px_rgba(37,99,235,0.3)] hover:translate-y-[2px] hover:shadow-none transition-all disabled:opacity-50"
        >
          {loading ? 'SAVING...' : 'SAVE CONFIGURATION'}
        </button>

        <div className="p-4 border border-gray-800 text-gray-500 text-sm font-mono">
          <p className="mb-2">SITE INFO</p>
          <div className="grid grid-cols-1 gap-2">
             <div><span className="text-gray-600">ID:</span> {site.id}</div>
             <div><span className="text-gray-600">API KEY:</span> {site.api_key}</div>
             <div><span className="text-gray-600">ORGANIZATION:</span> {site.organization?.name || 'N/A'}</div>
             <div><span className="text-gray-600">CREATED:</span> {new Date(site.created_at).toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
