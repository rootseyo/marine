'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function updateAutomationConfig(siteId: number, config: any) {
  try {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
    });

    if (!site) throw new Error('Site not found');

    const currentScrapedData = (site.scraped_data as any) || {};
    const updatedScrapedData = {
      ...currentScrapedData,
      automation: config,
    };

    await prisma.site.update({
      where: { id: siteId },
      data: {
        scraped_data: updatedScrapedData,
      },
    });

    revalidatePath(`/dashboard/sites/${siteId}`);
    revalidatePath(`/dashboard/sites`);
    
    return { success: true };
  } catch (err) {
    console.error('Update automation error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
