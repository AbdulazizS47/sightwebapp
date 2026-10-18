// Starter questions the CFO Office works through. Grok can add follow-up questions at runtime;
// those are stored in cfo_questions alongside these.
export const CFO_STARTER_QUESTIONS = [
  {
    key: 'ingredient_costs',
    topic: 'costs',
    audience: 'any',
    priority: 10,
    en: 'What do we pay for our main ingredients and packaging? Beans per kg, milk per liter, cups, lids, syrups, ice, water. A photo of a recent bill works too.',
    ar: 'كم ندفع على المكونات والتغليف الأساسية؟ البن للكيلو، الحليب للتر، الأكواب، الأغطية، السيرب، الثلج، الماء. صورة فاتورة حديثة تكفي.',
  },
  {
    key: 'suppliers',
    topic: 'suppliers',
    audience: 'any',
    priority: 15,
    en: 'Who are our suppliers? For each one: what we buy, how often we order, and how we pay them (cash, transfer, credit).',
    ar: 'من هم موردينا؟ لكل مورد: ماذا نشتري، كم مرة نطلب، وطريقة الدفع (كاش، تحويل، آجل).',
  },
  {
    key: 'staff_and_salaries',
    topic: 'staff',
    audience: 'owner',
    priority: 20,
    en: 'Who works on the truck? For each person: role, monthly salary or hourly/daily rate, and any allowances (housing, transport, commission).',
    ar: 'من يعمل في الترك؟ لكل شخص: الدور، الراتب الشهري أو الأجر بالساعة/اليوم، وأي بدلات (سكن، مواصلات، عمولة).',
  },
  {
    key: 'staff_shifts',
    topic: 'staff',
    audience: 'staff',
    priority: 25,
    en: 'What are the usual shifts? Who works which days and hours?',
    ar: 'ما هي الشفتات المعتادة؟ من يعمل في أي أيام وساعات؟',
  },
  {
    key: 'location_fees',
    topic: 'fixed_costs',
    audience: 'owner',
    priority: 30,
    en: 'What do we pay for our location? Parking or site rent, event fees, or revenue share, and how often.',
    ar: 'كم ندفع على الموقع؟ إيجار الموقف أو المكان، رسوم الفعاليات أو نسبة من المبيعات، وكل كم.',
  },
  {
    key: 'truck_costs',
    topic: 'fixed_costs',
    audience: 'owner',
    priority: 35,
    en: 'What does the truck itself cost us? Financing or lease payments, insurance, registration (Istimara), and yearly inspection.',
    ar: 'كم يكلفنا الترك نفسه؟ أقساط التمويل أو الإيجار، التأمين، الاستمارة، والفحص الدوري.',
  },
  {
    key: 'energy_costs',
    topic: 'variable_costs',
    audience: 'any',
    priority: 40,
    en: 'How much do we spend on fuel, generator, gas, water and electricity in a normal week?',
    ar: 'كم نصرف على البنزين، المولد، الغاز، الماء والكهرباء في أسبوع عادي؟',
  },
  {
    key: 'payment_providers',
    topic: 'payments',
    audience: 'owner',
    priority: 45,
    en: 'Which card terminal or payment provider do we use (mada, Apple Pay, STC Pay)? What fees do they charge, and how many days until the money reaches the bank?',
    ar: 'أي جهاز شبكة أو مزود دفع نستخدم (مدى، أبل باي، STC Pay)؟ كم الرسوم، وكم يوم حتى تصل الفلوس للبنك؟',
  },
  {
    key: 'vat_registration',
    topic: 'tax',
    audience: 'owner',
    priority: 50,
    en: 'Are we registered for VAT with ZATCA? If yes, how often do we file (monthly or quarterly), and who files it?',
    ar: 'هل نحن مسجلون في ضريبة القيمة المضافة لدى الزكاة والضريبة؟ إذا نعم، كل كم نقدم الإقرار (شهري أو ربع سنوي)، ومن يقدمه؟',
  },
  {
    key: 'licenses_permits',
    topic: 'compliance',
    audience: 'owner',
    priority: 55,
    en: 'Which licenses and permits do we pay for (commercial registration, Balady license, health certificates, food truck permit)? What do they cost and when do they renew?',
    ar: 'ما هي الرخص والتصاريح التي ندفع عليها (السجل التجاري، رخصة بلدي، الشهادات الصحية، تصريح الفود ترك)؟ كم تكلف ومتى تتجدد؟',
  },
  {
    key: 'subscriptions',
    topic: 'fixed_costs',
    audience: 'owner',
    priority: 60,
    en: 'Which apps and subscriptions do we pay for (hosting, SMS, WhatsApp, domain, POS, design tools)? Monthly cost of each.',
    ar: 'ما هي التطبيقات والاشتراكات التي ندفعها (الاستضافة، الرسائل، واتساب، الدومين، نظام الكاشير، أدوات التصميم)؟ التكلفة الشهرية لكل واحد.',
  },
  {
    key: 'cash_handling',
    topic: 'cash',
    audience: 'staff',
    priority: 65,
    en: 'How is cash handled at closing? Who counts it, where is it kept, and how often is it deposited?',
    ar: 'كيف يتم التعامل مع الكاش عند الإغلاق؟ من يعده، أين يُحفظ، وكل كم يُودع في البنك؟',
  },
  {
    key: 'bank_and_cash_balance',
    topic: 'cash',
    audience: 'owner',
    priority: 70,
    en: 'Which bank account does the business use, and what is the current balance plus cash on hand?',
    ar: 'أي حساب بنكي يستخدمه النشاط، وكم الرصيد الحالي مع الكاش الموجود؟',
  },
  {
    key: 'investment_and_loans',
    topic: 'capital',
    audience: 'owner',
    priority: 75,
    en: 'How much has been invested so far (truck, machines, setup)? Are there any loans or installments, and what are the monthly payments?',
    ar: 'كم تم استثماره حتى الآن (الترك، المكائن، التجهيز)؟ هل يوجد قروض أو أقساط، وكم الدفعة الشهرية؟',
  },
  {
    key: 'equipment_maintenance',
    topic: 'variable_costs',
    audience: 'staff',
    priority: 80,
    en: 'What maintenance do the espresso machine, grinder and generator need, and what did the last service cost?',
    ar: 'ما الصيانة التي تحتاجها مكينة الإسبريسو والطاحونة والمولد، وكم كلفت آخر صيانة؟',
  },
  {
    key: 'marketing_spend',
    topic: 'marketing',
    audience: 'owner',
    priority: 85,
    en: 'What do we spend on marketing (ads, influencers, printing, giveaways), and is there a monthly budget?',
    ar: 'كم نصرف على التسويق (إعلانات، مشاهير، طباعة، هدايا)، وهل يوجد ميزانية شهرية؟',
  },
  {
    key: 'targets',
    topic: 'targets',
    audience: 'owner',
    priority: 90,
    en: 'What is our daily sales target, and what is the lowest profit margin you accept on a drink?',
    ar: 'كم هدف المبيعات اليومي، وما أقل هامش ربح تقبله على المشروب؟',
  },
  {
    key: 'owner_withdrawals',
    topic: 'capital',
    audience: 'owner',
    priority: 95,
    en: 'How does the owner take money out of the business (fixed monthly amount, from profits, as needed)?',
    ar: 'كيف يسحب المالك من النشاط (مبلغ شهري ثابت، من الأرباح، حسب الحاجة)؟',
  },
  {
    key: 'accountant',
    topic: 'reporting',
    audience: 'owner',
    priority: 100,
    en: 'Do we have an accountant? What do they need from us each month, and in what format?',
    ar: 'هل لدينا محاسب؟ ماذا يحتاج منا كل شهر، وبأي صيغة؟',
  },
];

export function formatQuestionMessage(question, { mention } = {}) {
  const audienceLine =
    question.audience === 'owner'
      ? 'For the owner / للمالك'
      : question.audience === 'staff'
        ? 'For the team / للفريق'
        : 'Anyone who knows / أي أحد يعرف';
  return [
    `CFO Office question · ${audienceLine}${mention ? ` · ${mention}` : ''}`,
    '',
    question.questionEn || question.en,
    '',
    question.questionAr || question.ar,
    '',
    'Reply to this message with the answer, a photo, or a document. / رد على هذه الرسالة بالإجابة أو صورة أو مستند.',
  ].join('\n');
}
