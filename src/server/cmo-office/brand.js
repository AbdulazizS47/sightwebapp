// Starter brand profile for the CMO Office, from the SIGHT brand kit (Nov 2026).
// These are seeded into cmo_brand_notes once; after that the owner edits them from the
// CMO Office chat (or by sending the brand book), so the database is the source of truth.

export const BRAND_FACTS = `
Brand: SIGHT / سايت ("SIGHT Coffee Space" on the website, "SIGHT CAFE" on packaging; the business is OUT OF SIGHT).
A specialty coffee truck in Al Hofuf, Al Ahsa, Eastern Province, Saudi Arabia. Evening and late-night spot.
Default hours: daily 4:00 PM - 2:00 AM (check get_store_hours; the owner can change them).
Order ahead: https://sightcoffeespace.com
Instagram: @outofsight.cafe (owner confirmed Nov 2026; older material says @sightcafee).
Taglines: "OUT OF SIGHT, ALWAYS ON YOUR SIDE", "Always on your mind", "أطلب واستلم على طريقك", "هني وعافية عليكم".
Colors: Matte Black #1C1C1C, Crisp White #FFFFFF, Espresso Brown #4F3A2C, Cool Gray #F5F5F5, Cream ~#F3EDE3.
Fonts: Work Sans (English, bold headings, wide tracking), Almarai (Arabic).
Look: minimal, monochrome, lots of white space, thin lines, wide letter-spacing. No loud colors, busy collages or cartoons.
`.trim();

export const STARTER_BRAND_NOTES = [
  { key: 'voice-words', category: 'voice', note: 'Calm. Minimal. Knowledgeable. Warm. Talk like a barista who knows coffee and does not need to shout.' },
  { key: 'voice-short', category: 'voice', note: 'Keep it short: one idea per post, short lines, confident, a little mysterious (play on "out of sight").' },
  { key: 'voice-coffee', category: 'voice', note: 'Lead with the coffee: origin, tasting notes, process. Tasting notes sell better than "amazing coffee".' },
  { key: 'voice-name', category: 'voice', note: 'Play on the name: sight / out of sight / always on your mind / always on your side.' },
  { key: 'lang-order', category: 'language', note: 'Arabic first in a light, polite Saudi (Eastern Province) tone, English underneath.' },
  { key: 'cta', category: 'voice', note: 'End with one clear action: order ahead (sightcoffeespace.com), find us (Maps), or DM.' },
  { key: 'audience-night', category: 'audience', note: 'Talk to the night crowd: after work, after dinner, late drives, study nights.' },
  { key: 'timing-daily', category: 'platform', note: 'The daily "we are open tonight" post goes out around 3-4 PM, before opening at 4 PM.' },
  { key: 'dont-hype', category: 'dont', note: 'No ALL-CAPS hype, no "BEST COFFEE IN TOWN", no strings of 🔥. One or two emoji at most (☕ 🤍 🖤 🌙).' },
  { key: 'dont-offers', category: 'dont', note: 'Never mention discounts, prices or offers the owner has not approved. Prices only from get_menu.' },
  { key: 'dont-unavailable', category: 'dont', note: 'Never promote menu items that are currently unavailable.' },
  { key: 'dont-fake-drinks', category: 'dont', note: 'No AI images of drinks we do not serve, or that look nothing like our cups.' },
  { key: 'dont-religion-politics', category: 'dont', note: 'No religious or political content apart from respectful greetings for Ramadan, Eid, Founding Day and National Day.' },
  { key: 'visual-style', category: 'visual', note: 'Designs stay minimal and monochrome (black, white, espresso brown, cream) with Work Sans / Almarai.' },
];
