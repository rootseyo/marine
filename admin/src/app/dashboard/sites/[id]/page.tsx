import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import SiteDetailClient from './SiteDetailClient';

export default async function SiteDetailPage({ params }: { params: { id: string } }) {
  const { id } = await params;
  const siteId = parseInt(id);

  if (isNaN(siteId)) {
    return notFound();
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      organization: true,
    },
  });

  if (!site) {
    return notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end border-b-2 border-white pb-4 mb-8">
        <div>
          <h2 className="text-4xl font-black uppercase tracking-widest text-white">Manage Site</h2>
          <p className="text-gray-400 mt-1">{site.url}</p>
        </div>
      </div>

      <SiteDetailClient site={JSON.parse(JSON.stringify(site))} />
    </div>
  );
}
