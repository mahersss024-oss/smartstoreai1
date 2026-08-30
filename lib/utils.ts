import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency string with proper symbol
 * USD29.00 -> $29.00
 * Other currencies remain as-is (e.g., EUR29.00)
 */
export function formatCurrency(currency: string, amount: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US')}`;
  }
}

/**
 * Convert camelCase/PascalCase strings to space-separated words
 * InStock -> In Stock
 * outOfStock -> out Of Stock
 * BackOrdered -> Back Ordered
 */
export function formatCamelCase(text: string): string {
  return text
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/\s+/g, ' ');
}
