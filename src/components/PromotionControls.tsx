import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';

export interface Promotion {
  count: number;
  itemIds: string[];
  allowDuplicates: boolean;
  startsAt?: number | null;
  endsAt?: number | null;
}
export interface PromoSelection {
  id: string;
  nameEn: string;
  nameAr: string;
  temperature?: 'hot' | 'iced';
}
export interface Product {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
  price: number;
  available: boolean;
  promotion?: Promotion | null;
}
export const promoKey = (id: string, selections: PromoSelection[]) =>
  `${id}:${JSON.stringify(selections.map((s) => [s.id, s.temperature || '']).sort())}`;
export function PromotionFields({
  value,
  onChange,
  items,
  language,
  ownId,
}: {
  value?: Promotion | null;
  onChange: (v: Promotion | null) => void;
  items: Product[];
  language: string;
  ownId?: string;
}) {
  const ar = language === 'ar';
  return (
    <div className="space-y-3 border p-3 rounded-lg">
      <label className="block">
        {ar ? 'نوع الصنف' : 'Item type'}
        <select
          className="block border p-2 w-full"
          value={value ? 'promo' : 'regular'}
          onChange={(e) =>
            onChange(
              e.target.value === 'promo' ? { count: 2, itemIds: [], allowDuplicates: true } : null
            )
          }
        >
          <option value="regular">{ar ? 'صنف عادي' : 'Regular item'}</option>
          <option value="promo">{ar ? 'عرض ترويجي' : 'Promotion bundle'}</option>
        </select>
      </label>
      {value && (
        <>
          <p className="text-sm">
            {ar
              ? 'السعر المحدد للصنف هو سعر العرض كاملاً.'
              : 'The item price is the price of the whole bundle.'}
          </p>
          <label className="block">
            {ar ? 'عدد الاختيارات' : 'Required selections'}
            <input
              className="border p-2 w-full"
              type="number"
              min="1"
              max="20"
              value={value.count}
              onChange={(e) => onChange({ ...value, count: Number(e.target.value) })}
            />
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={value.allowDuplicates}
              onChange={(e) => onChange({ ...value, allowDuplicates: e.target.checked })}
            />
            {ar ? 'السماح بتكرار نفس الصنف' : 'Allow the same item more than once'}
          </label>
          <fieldset className="max-h-48 overflow-auto border p-2">
            <legend>{ar ? 'الأصناف المشمولة' : 'Eligible items'}</legend>
            {items
              .filter((i) => i.id !== ownId && !i.promotion)
              .map((i) => (
                <label key={i.id} className="flex gap-2 p-1">
                  <input
                    type="checkbox"
                    checked={value.itemIds.includes(i.id)}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        itemIds: e.target.checked
                          ? [...value.itemIds, i.id]
                          : value.itemIds.filter((id) => id !== i.id),
                      })
                    }
                  />
                  {ar ? i.nameAr : i.nameEn}
                </label>
              ))}
          </fieldset>
          {(['startsAt', 'endsAt'] as const).map((key) => (
            <label key={key} className="block">
              {key === 'startsAt'
                ? ar
                  ? 'بداية العرض (اختياري)'
                  : 'Starts (optional)'
                : ar
                  ? 'نهاية العرض (اختياري)'
                  : 'Ends (optional)'}
              <input
                type="datetime-local"
                className="border p-2 w-full"
                value={
                  value[key]
                    ? new Date(value[key]! - new Date(value[key]!).getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16)
                    : ''
                }
                onChange={(e) =>
                  onChange({
                    ...value,
                    [key]: e.target.value ? new Date(e.target.value).getTime() : null,
                  })
                }
              />
            </label>
          ))}
        </>
      )}
    </div>
  );
}
export function PromotionPicker({
  item,
  items,
  language,
  onClose,
  onAdd,
  initialSelections = [],
}: {
  initialSelections?: PromoSelection[];
  item: Product;
  items: Product[];
  language: string;
  onClose: () => void;
  onAdd: (s: PromoSelection[]) => void;
}) {
  const ar = language === 'ar';
  const promo = item.promotion!;
  const [choices, setChoices] = useState<PromoSelection[]>(initialSelections.slice(0, promo.count));
  const active =
    (!promo.startsAt || Date.now() >= promo.startsAt) &&
    (!promo.endsAt || Date.now() < promo.endsAt);
  const eligible = items.filter((i) => promo.itemIds.includes(i.id) && i.available && !i.promotion);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto bg-white z-[70]"
        dir={ar ? 'rtl' : 'ltr'}
      >
        <DialogTitle className="px-6">{ar ? item.nameAr : item.nameEn}</DialogTitle>
        <DialogDescription>
          {ar
            ? `اختر ${promo.count} أصناف — ${item.price.toFixed(2)} ريال`
            : `Choose ${promo.count} items — SAR ${item.price.toFixed(2)}`}
        </DialogDescription>
        {!active ? (
          <p role="alert">
            {ar ? 'العرض غير متاح حالياً' : 'This promotion is not currently active.'}
          </p>
        ) : (
          <>
            {Array.from({ length: promo.count }, (_, index) => (
              <fieldset
                key={index}
                className="space-y-3 rounded-xl border border-[var(--cool-gray)] p-3"
              >
                <legend className="px-2 text-sm font-semibold">
                  {ar ? `الاختيار ${index + 1}` : `Choice ${index + 1}`}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {eligible.flatMap((product) =>
                    (product.category.toLowerCase() === 'v60'
                      ? (['hot', 'iced'] as const)
                      : [undefined]
                    ).map((temperature) => {
                      const selected =
                        choices[index]?.id === product.id &&
                        choices[index]?.temperature === temperature;
                      const disabled =
                        !promo.allowDuplicates &&
                        choices.some((c, n) => n !== index && c?.id === product.id);
                      return (
                        <button
                          key={`${product.id}:${temperature || ''}`}
                          type="button"
                          aria-pressed={selected}
                          disabled={disabled}
                          className={`min-h-[56px] rounded-lg border-2 px-3 py-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--espresso-brown)] disabled:opacity-35 disabled:cursor-not-allowed ${selected ? 'border-[var(--espresso-brown)] bg-[var(--espresso-brown)] text-white' : 'border-[var(--cool-gray)] bg-white text-[var(--matte-black)] hover:border-[var(--espresso-brown)]'}`}
                          onClick={() =>
                            setChoices((prev) => {
                              if (selected) return prev;
                              const next = [...prev];
                              next[index] = {
                                id: product.id,
                                nameEn: product.nameEn,
                                nameAr: product.nameAr,
                                ...(temperature ? { temperature } : {}),
                              };
                              return next;
                            })
                          }
                        >
                          {selected && (
                            <span aria-hidden="true" className="me-2">
                              ✓
                            </span>
                          )}
                          {ar ? product.nameAr : product.nameEn}
                          {temperature && (
                            <span className="block mt-1 text-xs">
                              {temperature === 'hot' ? (ar ? 'ساخن' : 'Hot') : ar ? 'بارد' : 'Iced'}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </fieldset>
            ))}
            {!eligible.length && (
              <p>{ar ? 'لا توجد أصناف متاحة' : 'No eligible items are available.'}</p>
            )}
            <button
              className="border rounded p-3 bg-[var(--matte-black)] text-white disabled:opacity-40"
              disabled={
                Array.from({ length: promo.count }, (_, i) => choices[i]).some(
                  (c) => !c || !eligible.some((i) => i.id === c.id)
                ) ||
                (!promo.allowDuplicates && new Set(choices.map((c) => c?.id)).size !== promo.count)
              }
              onClick={() => onAdd(choices)}
            >
              {ar ? 'إضافة العرض للسلة' : 'Add promotion to cart'}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function PromotionSummary({
  selections,
  language,
}: {
  selections?: PromoSelection[];
  language: string;
}) {
  return selections?.length ? (
    <div className="text-xs opacity-70 whitespace-normal">
      {selections.map((s, i) => (
        <div key={i}>
          {language === 'ar' ? s.nameAr : s.nameEn}
          {s.temperature
            ? ` · ${language === 'ar' ? (s.temperature === 'hot' ? 'ساخن' : 'بارد') : s.temperature}`
            : ''}
        </div>
      ))}
    </div>
  ) : null;
}
