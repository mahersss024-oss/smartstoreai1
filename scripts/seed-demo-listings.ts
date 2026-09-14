import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import type { ListingImage } from '@/agent/marketplace/types';

import {
  buildDemoListingSeed,
  createDemoListingImageDataUrl,
  defaultDemoListingSeedCount,
  defaultDemoListingsPerSeller,
  demoDatasetId,
  getDemoSellerId,
} from './demo-listing-data';

function loadEnvFile(fileName: string) {
  if (!existsSync(fileName)) {
    return;
  }

  const lines = readFileSync(fileName, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue
      .replace(/^['"]/, '')
      .replace(/['"]$/, '');

    process.env[key] ??= value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

type CliOptions = {
  count: number;
  listingsPerSeller: number;
  cleanupSellerCount: number;
  dryRun: boolean;
  clearOnly: boolean;
  keepExisting: boolean;
};

function readFlag(args: string[], name: string) {
  return args.includes(name);
}

function readNumberOption(
  args: string[],
  name: string,
  fallback: number,
  options: { min?: number; max?: number } = {},
) {
  const inlineValue = args
    .find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  const spacedValue =
    inlineValue === undefined
      ? args[args.findIndex((arg) => arg === name) + 1]
      : undefined;
  const rawValue = inlineValue ?? spacedValue;

  if (!rawValue || rawValue.startsWith('--')) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number.`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new Error(`${name} must be at least ${options.min}.`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new Error(`${name} must be at most ${options.max}.`);
  }

  return value;
}

function getCliOptions(args = process.argv.slice(2)): CliOptions {
  const count = readNumberOption(args, '--count', defaultDemoListingSeedCount, {
    min: 1,
    max: 5000,
  });
  const listingsPerSeller = readNumberOption(
    args,
    '--per-seller',
    defaultDemoListingsPerSeller,
    { min: 1, max: 80 },
  );
  const minimumCleanupSellerCount = Math.ceil(count / listingsPerSeller);
  const cleanupSellerCount = readNumberOption(
    args,
    '--cleanup-sellers',
    Math.max(minimumCleanupSellerCount, 250),
    { min: minimumCleanupSellerCount, max: 2000 },
  );

  return {
    count,
    listingsPerSeller,
    cleanupSellerCount,
    dryRun: readFlag(args, '--dry-run'),
    clearOnly: readFlag(args, '--clear'),
    keepExisting: readFlag(args, '--keep-existing'),
  };
}

function isDatabaseStore() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

async function clearDemoListings(options: Pick<CliOptions, 'cleanupSellerCount'>) {
  const sellerIds = Array.from({ length: options.cleanupSellerCount }, (_, index) =>
    getDemoSellerId(index),
  );

  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');
    const deleted = await prisma.user.deleteMany({
      where: {
        id: { in: sellerIds },
        email: { endsWith: '@smartstore-demo.local' },
      },
    });

    return {
      deletedUsers: deleted.count,
      deletedListings: null as number | null,
    };
  }

  const repository = await import('@/agent/marketplace/repository');
  let deletedListings = 0;

  for (const sellerId of sellerIds) {
    const listings = await repository.listSellerListings(sellerId);

    for (const listing of listings) {
      const isDemoListing =
        listing.attributes.demoDataset === demoDatasetId ||
        listing.title?.startsWith('[تجريبي]');

      if (!isDemoListing) {
        continue;
      }

      const updatedListing = await repository.setListingStatusForSeller(
        listing.id,
        sellerId,
        'deleted',
      );

      if (updatedListing?.status === 'deleted') {
        deletedListings += 1;
      }
    }
  }

  return {
    deletedUsers: null as number | null,
    deletedListings,
  };
}

export async function seedDemoListings(options = getCliOptions()) {
  const repository = await import('@/agent/marketplace/repository');
  const { getMaxListingsPerSeller } = await import(
    '@/agent/marketplace/listing-limits'
  );
  const maxListingsPerSeller = getMaxListingsPerSeller();
  const listingsPerSeller = Math.min(
    options.listingsPerSeller,
    Math.max(1, maxListingsPerSeller - 1),
  );
  const entries = buildDemoListingSeed(options.count, listingsPerSeller);
  const runId = randomUUID();
  let cleared = {
    deletedUsers: null as number | null,
    deletedListings: null as number | null,
  };

  console.log(
    `Preparing ${entries.length} demo listings across ${new Set(
      entries.map((entry) => entry.listing.category),
    ).size} categories using ${isDatabaseStore() ? 'database' : 'file'} store.`,
  );

  if (options.dryRun) {
    return {
      mode: 'dry-run',
      requested: entries.length,
      published: 0,
      pending: 0,
      rejected: 0,
      cleared,
    };
  }

  if (!options.keepExisting || options.clearOnly) {
    cleared = await clearDemoListings({
      cleanupSellerCount: options.cleanupSellerCount,
    });
  }

  if (options.clearOnly) {
    return {
      mode: 'clear',
      requested: 0,
      published: 0,
      pending: 0,
      rejected: 0,
      cleared,
    };
  }

  let published = 0;
  let pending = 0;
  let rejected = 0;

  for (const entry of entries) {
    const listing = await repository.createListingDraft(entry.seller, entry.listing);
    const imageUrl = createDemoListingImageDataUrl(entry);
    const image: ListingImage = {
      id: `demo-image-${runId}-${String(entry.index).padStart(4, '0')}`,
      listingId: listing.id,
      originalUrl: imageUrl,
      displayUrl: imageUrl,
      thumbnailUrl: imageUrl,
      isPrimary: true,
      qualityScore: 95,
      status: 'approved',
      enhancements: ['create_thumbnail', 'compress'],
    };

    await repository.addListingImageForSeller(listing.id, entry.seller.id, image);

    const updatedListing = await repository.setListingStatusForSeller(
      listing.id,
      entry.seller.id,
      'published',
    );

    if (updatedListing?.status === 'published') {
      published += 1;
    } else if (updatedListing?.status === 'rejected') {
      rejected += 1;
    } else {
      pending += 1;
    }

    if (entry.index % 100 === 0) {
      console.log(`Seeded ${entry.index}/${entries.length} demo listings...`);
    }
  }

  return {
    mode: 'seed',
    requested: entries.length,
    published,
    pending,
    rejected,
    cleared,
  };
}

async function main() {
  const options = getCliOptions();
  const result = await seedDemoListings(options);

  console.log(JSON.stringify(result, null, 2));

  if (isDatabaseStore()) {
    const { prisma } = await import('@/lib/db/prisma');
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
