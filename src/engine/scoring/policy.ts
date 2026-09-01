import type { NormalizedProduct } from '../core/types.js';

/**
 * Ad-policy screening.
 *
 * A product you cannot advertise is worthless to a paid-traffic store, however
 * good its margins look. Meta and TikTok reject whole categories outright and
 * throttle others, so this runs before scoring and can veto a product rather
 * than nudging its number down a few points.
 *
 * Keyword matching is a blunt instrument and will occasionally misfire — that
 * is why matches are reported with the term that triggered them, so a false
 * positive is visible rather than silently buried in a score.
 */

export type PolicySeverity = 'prohibited' | 'restricted' | 'caution';

export interface PolicyMatch {
  severity: PolicySeverity;
  category: string;
  /** The term that triggered the match, so you can audit a false positive. */
  term: string;
}

interface Rule {
  severity: PolicySeverity;
  category: string;
  terms: string[];
}

const RULES: Rule[] = [
  {
    severity: 'prohibited',
    category: 'weapons',
    terms: ['knuckle duster', 'brass knuckle', 'stun gun', 'taser', 'pepper spray',
            'butterfly knife', 'switchblade', 'silencer', 'ammunition', 'gun holster'],
  },
  {
    severity: 'prohibited',
    category: 'adult',
    terms: ['sex toy', 'vibrator', 'lingerie fetish', 'bondage', 'adult toy'],
  },
  {
    severity: 'prohibited',
    category: 'tobacco and vaping',
    terms: ['vape', 'e-cigarette', 'nicotine', 'hookah', 'shisha', 'bong', 'grinder herb'],
  },
  {
    severity: 'prohibited',
    category: 'drugs and supplements',
    terms: ['cbd', 'kratom', 'nootropic', 'testosterone booster', 'detox tea'],
  },
  {
    severity: 'restricted',
    category: 'medical claims',
    terms: ['cure', 'treats anxiety', 'blood pressure monitor', 'medical grade',
            'therapeutic', 'pain relief device', 'posture corrector'],
  },
  {
    severity: 'restricted',
    category: 'weight loss',
    terms: ['weight loss', 'slimming', 'fat burner', 'waist trainer', 'appetite suppressant'],
  },
  {
    severity: 'restricted',
    category: 'counterfeit risk',
    terms: ['replica', 'inspired by', 'style like', 'oem branded', 'aaa quality',
            'nike', 'adidas', 'gucci', 'louis vuitton', 'apple airpods', 'rolex'],
  },
  {
    severity: 'caution',
    category: 'electrical safety',
    terms: ['lithium battery', 'power bank', 'car charger', 'laser pointer', 'e-bike battery'],
  },
  {
    severity: 'caution',
    category: 'children and safety',
    terms: ['baby walker', 'crib bumper', 'infant sleep', 'car seat', 'small parts toy'],
  },
  {
    severity: 'caution',
    category: 'high return rate',
    terms: ['glass', 'ceramic', 'porcelain', 'mirror', 'fragile', 'aquarium'],
  },
];

export function screenPolicy(product: NormalizedProduct): PolicyMatch[] {
  const haystack = [product.title, product.description, product.category, ...(product.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matches: PolicyMatch[] = [];
  for (const rule of RULES) {
    for (const term of rule.terms) {
      if (haystack.includes(term)) {
        matches.push({ severity: rule.severity, category: rule.category, term });
        break; // One hit per category is enough; listing every synonym is noise.
      }
    }
  }
  return matches;
}

/** Worst severity found, or null when the product screens clean. */
export function worstSeverity(matches: PolicyMatch[]): PolicySeverity | null {
  if (matches.some((m) => m.severity === 'prohibited')) return 'prohibited';
  if (matches.some((m) => m.severity === 'restricted')) return 'restricted';
  if (matches.some((m) => m.severity === 'caution')) return 'caution';
  return null;
}
