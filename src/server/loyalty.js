const NON_COFFEE_CATEGORY_TERMS = [
  'not-coffee',
  'not coffee',
  'non-coffee',
  'non coffee',
  'غير القهوة',
];

const COFFEE_CATEGORY_TERMS = [
  'coffee',
  'espresso',
  'v60',
  'hot drinks',
  'cold drinks',
  'قهوة',
  'إسبريسو',
  'اسبرسو',
  'في60',
];

const LEGACY_COFFEE_CATEGORY_IDS = new Set(['hot', 'cold']);

/**
 * Loyalty rewards are for prepared coffee only. Category metadata is used so
 * an expensive sweet or other non-coffee product can never become the reward.
 */
export function isCoffeeRewardEligible(item) {
  const categoryText = [item?.category, item?.categoryNameEn, item?.categoryNameAr]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (!categoryText) return false;
  if (NON_COFFEE_CATEGORY_TERMS.some((term) => categoryText.includes(term))) return false;

  const categoryId = String(item?.category || '').trim().toLowerCase();
  const hasCoffeeCategory =
    LEGACY_COFFEE_CATEGORY_IDS.has(categoryId) ||
    COFFEE_CATEGORY_TERMS.some((term) => categoryText.includes(term));

  // A Coffee + sweet bundle contains an eligible cup, but a sweets-only item does not.
  return hasCoffeeCategory;
}

/**
 * Selects one eligible coffee unit. Quantity is deliberately ignored: even if
 * the customer orders several cups, only one unit is free.
 */
export function selectFreeCoffeeReward(items, maxRewardValue = Number.POSITIVE_INFINITY) {
  const safeMaxRewardValue = Number.isFinite(Number(maxRewardValue))
    ? Math.max(0, Number(maxRewardValue))
    : Number.POSITIVE_INFINITY;

  return (Array.isArray(items) ? items : []).reduce((selected, item) => {
    if (!isCoffeeRewardEligible(item)) return selected;
    const itemUnitPrice = Number(item?.price || 0);
    if (!Number.isFinite(itemUnitPrice) || itemUnitPrice <= 0) return selected;
    const rewardValue = Math.min(itemUnitPrice, safeMaxRewardValue);
    if (rewardValue <= 0) return selected;
    if (!selected || rewardValue > selected.unitPrice) {
      return { item, unitPrice: rewardValue };
    }
    return selected;
  }, null);
}
