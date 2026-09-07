import { recommendListingPrice } from './pricing-engine';
import type { ListingRecord } from './store';

export type NegotiationAdvice = {
  listingId: string;
  askingPrice: number | null;
  buyerOffer: number;
  offerPercentOfAsking: number | null;
  marketRange: {
    min: number | null;
    max: number | null;
  };
  comparableListingCount: number;
  confidence: 'low' | 'medium' | 'high';
  stance: 'too_low' | 'reasonable' | 'strong' | 'above_market' | 'insufficient_data';
  suggestedCounterRange: {
    min: number | null;
    max: number | null;
  };
  reasons: string[];
  requiresExplicitConfirmation: true;
};

function numericPrice(listing: ListingRecord) {
  return typeof listing.price === 'number' ? listing.price : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getStance(input: {
  offer: number;
  askingPrice: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
}) {
  if (!input.rangeMin || !input.rangeMax) {
    if (!input.askingPrice) {
      return 'insufficient_data' as const;
    }

    const ratio = input.offer / input.askingPrice;

    if (ratio < 0.85) {
      return 'too_low' as const;
    }

    if (ratio <= 1.05) {
      return 'reasonable' as const;
    }

    return 'strong' as const;
  }

  if (input.offer < input.rangeMin * 0.92) {
    return 'too_low' as const;
  }

  if (input.offer <= input.rangeMax) {
    return 'reasonable' as const;
  }

  return 'above_market' as const;
}

function buildCounterRange(input: {
  stance: NegotiationAdvice['stance'];
  askingPrice: number | null;
  buyerOffer: number;
  marketMin: number | null;
  marketMax: number | null;
}) {
  if (input.stance === 'insufficient_data') {
    return { min: null, max: null };
  }

  const anchorMin = input.marketMin ?? input.askingPrice ?? input.buyerOffer;
  const anchorMax = input.marketMax ?? input.askingPrice ?? input.buyerOffer;

  if (input.stance === 'too_low') {
    return {
      min: Math.round(anchorMin * 0.96),
      max: Math.round(anchorMax),
    };
  }

  if (input.stance === 'reasonable') {
    return {
      min: Math.round(clamp(input.buyerOffer * 1.02, anchorMin * 0.94, anchorMax)),
      max: Math.round(anchorMax),
    };
  }

  return {
    min: Math.round(input.buyerOffer),
    max: Math.round(input.buyerOffer),
  };
}

function buildReasons(input: {
  stance: NegotiationAdvice['stance'];
  askingPrice: number | null;
  offerPercentOfAsking: number | null;
  marketMin: number | null;
  marketMax: number | null;
  comparableListingCount: number;
}) {
  const reasons: string[] = [];

  if (input.offerPercentOfAsking !== null) {
    reasons.push(`العرض يساوي تقريبًا ${input.offerPercentOfAsking}% من السعر المطلوب`);
  }

  if (input.marketMin && input.marketMax) {
    reasons.push(
      `نطاق السوق المحسوب من المقارنات: ${input.marketMin} إلى ${input.marketMax} ريال`,
    );
  }

  if (input.comparableListingCount > 0) {
    reasons.push(`تم استخدام ${input.comparableListingCount} إعلان مشابه للتقييم`);
  }

  if (input.stance === 'too_low') {
    reasons.push('العرض أقل من النطاق المناسب حسب البيانات المتاحة');
  }

  if (input.stance === 'reasonable') {
    reasons.push('العرض قريب من النطاق المناسب ويمكن التفاوض عليه');
  }

  if (input.stance === 'above_market' || input.stance === 'strong') {
    reasons.push('العرض قوي مقارنة بالسعر أو نطاق السوق');
  }

  return reasons.slice(0, 4);
}

export function evaluateNegotiationOffer(
  listing: ListingRecord,
  buyerOffer: number,
  comparableListings: ListingRecord[],
): NegotiationAdvice {
  const askingPrice = numericPrice(listing);
  const pricing = recommendListingPrice(
    {
      category: listing.category,
      title: listing.title,
      description: listing.description,
      price: askingPrice ?? undefined,
      city: listing.city,
      condition: listing.condition,
      attributes: listing.attributes,
    },
    comparableListings,
  );
  const marketMin = pricing.recommendedRange.min;
  const marketMax = pricing.recommendedRange.max;
  const offerPercentOfAsking = askingPrice
    ? Math.round((buyerOffer / askingPrice) * 100)
    : null;
  const stance = getStance({
    offer: buyerOffer,
    askingPrice,
    rangeMin: marketMin,
    rangeMax: marketMax,
  });

  return {
    listingId: listing.id,
    askingPrice,
    buyerOffer,
    offerPercentOfAsking,
    marketRange: {
      min: marketMin,
      max: marketMax,
    },
    comparableListingCount: pricing.comparableListingCount,
    confidence: pricing.confidence,
    stance,
    suggestedCounterRange: buildCounterRange({
      stance,
      askingPrice,
      buyerOffer,
      marketMin,
      marketMax,
    }),
    reasons: buildReasons({
      stance,
      askingPrice,
      offerPercentOfAsking,
      marketMin,
      marketMax,
      comparableListingCount: pricing.comparableListingCount,
    }),
    requiresExplicitConfirmation: true,
  };
}
