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
 * Position (1..cycleLength) that the order *about to be placed* would occupy in the loyalty
 * card, given `points` orders already completed. Reaching `cycleLength` means this upcoming
 * order is the free one — so with the default 5-order cycle, the reward lands on order 5, 10,
 * 15... not one order later on 6, 11, 16, which is what a `(points - 1) % cycleLength` formula
 * would produce. Returns 0 when there are no completed orders yet.
 */
export function getLoyaltyCycleStamps(points, cycleLength = 5) {
  const safePoints = Number.isFinite(Number(points)) ? Math.max(0, Number(points)) : 0;
  const safeCycleLength = Number.isFinite(Number(cycleLength)) && Number(cycleLength) > 0
    ? Math.floor(Number(cycleLength))
    : 5;
  if (safePoints <= 0) return 0;
  return (safePoints % safeCycleLength) + 1;
}

/**
 * Whether this order should advance the customer's loyalty count. Points normally accrue on
 * every order, but if a reward was sitting ready (5th stamp already earned) and the customer
 * didn't redeem it this order — didn't check the box, or had nothing eligible in the cart —
 * points must *not* advance, or that earned reward silently vanishes and the customer has to
 * earn an entire extra cycle before it reappears. Freezing the count keeps the reward available
 * on every subsequent order until it's actually used.
 */
export function shouldAccrueLoyaltyPoint({ rewardWasAvailable, rewardWasRedeemed }) {
  return !rewardWasAvailable || Boolean(rewardWasRedeemed);
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
