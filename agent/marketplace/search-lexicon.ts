export type SearchAliasEntry = {
  canonical: string;
  aliases: string[];
};

export type VehicleModelAliasEntry = SearchAliasEntry & {
  brand: string;
  model: string;
};

export const marketplaceTermAliasEntries: SearchAliasEntry[] = [
  { canonical: 'canon', aliases: ['كانون'] },
  { canonical: 'nikon', aliases: ['نيكون'] },
  { canonical: 'iphone', aliases: ['ايفون', 'آيفون'] },
];

export const vehicleBrandAliasEntries: SearchAliasEntry[] = [
  { canonical: 'Toyota', aliases: ['تويوتا', 'تايوتا', 'toyota'] },
  { canonical: 'Nissan', aliases: ['نيسان', 'nissan'] },
  { canonical: 'Hyundai', aliases: ['هيونداي', 'hyundai'] },
  { canonical: 'Kia', aliases: ['كيا', 'kia'] },
  { canonical: 'Honda', aliases: ['هوندا', 'honda'] },
  { canonical: 'Lexus', aliases: ['لكزس', 'lexus'] },
  { canonical: 'Mercedes-Benz', aliases: ['مرسيدس', 'mercedes', 'mercedes-benz'] },
];

export const vehicleModelAliasEntries: VehicleModelAliasEntry[] = [
  {
    canonical: 'Camry',
    brand: 'Toyota',
    model: 'Camry',
    aliases: ['كامري', 'camry'],
  },
  {
    canonical: 'Corolla',
    brand: 'Toyota',
    model: 'Corolla',
    aliases: ['كورولا', 'corolla'],
  },
  {
    canonical: 'Yaris',
    brand: 'Toyota',
    model: 'Yaris',
    aliases: ['يارس', 'yaris'],
  },
  {
    canonical: 'Patrol',
    brand: 'Nissan',
    model: 'Patrol',
    aliases: ['باترول', 'بترول', 'patrol'],
  },
  {
    canonical: 'X-Trail',
    brand: 'Nissan',
    model: 'X-Trail',
    aliases: ['اكس تريل', 'إكس تريل', 'x-trail', 'xtrail', 'x trail'],
  },
  {
    canonical: 'Elantra',
    brand: 'Hyundai',
    model: 'Elantra',
    aliases: ['النترا', 'إلنترا', 'elantra'],
  },
  {
    canonical: 'Sonata',
    brand: 'Hyundai',
    model: 'Sonata',
    aliases: ['سوناتا', 'sonata'],
  },
  {
    canonical: 'Accord',
    brand: 'Honda',
    model: 'Accord',
    aliases: ['اكورد', 'أكورد', 'accord'],
  },
];
