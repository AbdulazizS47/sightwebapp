export function parsePromotion(value) {
  return typeof value === 'string' ? JSON.parse(value) : value || null;
}
export function validatePromotion(value, products, ownId) {
  if (!value) return null;
  const count = Number(value.count);
  const itemIds = [...new Set(Array.isArray(value.itemIds) ? value.itemIds.map(String) : [])];
  if (!Number.isInteger(count) || count < 1 || count > 20)
    throw new Error('Choose between 1 and 20 items per promotion');
  if (
    !itemIds.length ||
    itemIds.some(
      (id) => id === ownId || !products.some((p) => p.id === id && !parsePromotion(p.promotion))
    )
  )
    throw new Error('Select existing regular items for the promotion');
  const allowDuplicates = value.allowDuplicates !== false;
  if (!allowDuplicates && itemIds.length < count)
    throw new Error('Select enough different eligible items');
  const startsAt = value.startsAt ? Number(value.startsAt) : null;
  const endsAt = value.endsAt ? Number(value.endsAt) : null;
  if (
    (startsAt !== null && !Number.isFinite(startsAt)) ||
    (endsAt !== null && !Number.isFinite(endsAt)) ||
    (startsAt && endsAt && endsAt <= startsAt)
  )
    throw new Error('Invalid promotion dates');
  return { count, itemIds, allowDuplicates, startsAt, endsAt };
}
export function validateSelections(promotion, selections, now = Date.now()) {
  if (
    (promotion.startsAt && now < promotion.startsAt) ||
    (promotion.endsAt && now >= promotion.endsAt)
  )
    throw new Error('This promotion is not currently active');
  if (!Array.isArray(selections) || selections.length !== promotion.count)
    throw new Error(`Choose exactly ${promotion.count} items for this promotion`);
  if (
    selections.some(
      (s) =>
        !s ||
        typeof s.id !== 'string' ||
        !promotion.itemIds.includes(s.id) ||
        (s.temperature != null && !['hot', 'iced'].includes(s.temperature))
    )
  )
    throw new Error('An item is not eligible for this promotion');
  if (!promotion.allowDuplicates && new Set(selections.map((s) => s.id)).size !== selections.length)
    throw new Error('Choose different items for this promotion');
}
