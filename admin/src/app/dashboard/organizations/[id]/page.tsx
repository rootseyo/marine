import { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Organization Details',
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function OrganizationDetailPage({ params }: Props) {
  const { id } = await params;
  const orgId = parseInt(id);

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      owner: true,
      members: {
        include: {
          user: true
        }
      },
      sites: true
    }
  });

  if (!organization) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end border-b-2 border-white pb-4 mb-8">
        <div>
          <div className="text-gray-500 text-xs font-bold uppercase mb-1 tracking-widest">
            <Link href="/dashboard/organizations" className="hover:text-white transition-colors">
              &larr; Back to Organizations
            </Link>
          </div>
          <h2 className="text-4xl font-black tracking-widest text-white">
            {organization.name}
          </h2>
          <p className="text-gray-400 mt-1 font-mono text-sm">UNIT ID: {organization.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="retro-card">
          <h3 className="text-xl font-black uppercase text-white mb-4 border-b border-gray-700 pb-2">
            Sites <span className="text-gray-500 text-base font-normal">({organization.sites.length})</span>
          </h3>
          <div className="space-y-3">
            {organization.sites.map((site) => (
              <div key={site.id} className="bg-gray-900 border border-gray-700 p-4 flex justify-between items-center">
                <div>
                  <div className="font-bold text-white">{site.url}</div>
                  <div className="text-xs text-gray-500 font-mono">SEO Score: {site.seo_score}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="retro-card">
          <h3 className="text-xl font-black uppercase text-white mb-4 border-b border-gray-700 pb-2">
            Members <span className="text-gray-500 text-base font-normal">({organization.members.length})</span>
          </h3>
          <div className="space-y-3">
            {organization.members.map((member) => (
              <div key={member.id} className="bg-gray-900 border border-gray-700 p-4">
                <div className="font-bold text-white">{member.user.name}</div>
                <div className="text-xs text-gray-500">{member.user.email} ({member.role})</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}