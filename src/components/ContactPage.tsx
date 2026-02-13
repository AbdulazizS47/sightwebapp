import { ArrowLeft, Phone, Mail, MapPin } from 'lucide-react';

interface ContactPageProps {
  onBack: () => void;
  language: 'en' | 'ar';
}

export function ContactPage({ onBack, language }: ContactPageProps) {
  const content = {
    en: {
      title: 'Contact Us',
      subtitle: 'Get in touch with our team',
      phone: 'Phone',
      email: 'Email',
      location: 'Location',
      phoneNumber: '+966 54 744 4145',
      emailAddress: 'outofsight.co@outlook.com',
      address: 'Al Hofuf, Saudi Arabia',
      hours: 'Hours',
      hoursText: 'Daily: 4:00 PM - 2:00 AM',
    },
    ar: {
      title: 'اتصل بنا',
      subtitle: 'تواصل مع فريقنا',
      phone: 'الهاتف',
      email: 'البريد الإلكتروني',
      location: 'الموقع',
      phoneNumber: '+966 54 744 4145',
      emailAddress: 'outofsight.co@outlook.com',
      address: 'الحسا حساك لو الدهر .. ؟',
      hours: 'ساعات العمل',
      hoursText: 'يوميًا: ٤:٠٠ مساءً - ٢:٠٠ صباحًا',
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';

  return (
    <div className="min-h-screen bg-[var(--crisp-white)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="sticky top-0 bg-[var(--crisp-white)] border-b-2 border-[var(--matte-black)] z-10">
        <div className="flex items-center gap-4 p-6">
          <button
            onClick={onBack}
            className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
          >
            <ArrowLeft size={24} className={isRTL ? 'rotate-180' : ''} />
          </button>
          <h1 className="text-xl text-[var(--matte-black)]">{text.title}</h1>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-[var(--matte-black)] opacity-70 mb-12 text-center">{text.subtitle}</p>

        <div className="space-y-6">
          {/* Phone */}
          <div className="p-6 bg-[var(--cool-gray)] hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] transition-colors group">
            <div className="flex items-start gap-4">
              <Phone size={24} className="flex-shrink-0 mt-1" />
              <div>
                <h3 className="mb-2">{text.phone}</h3>
                <p className="opacity-70" dir="ltr">
                  {text.phoneNumber}
                </p>
              </div>
            </div>
          </div>

          {/* Email */}
          <div className="p-6 bg-[var(--cool-gray)] hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] transition-colors group">
            <div className="flex items-start gap-4">
              <Mail size={24} className="flex-shrink-0 mt-1" />
              <div>
                <h3 className="mb-2">{text.email}</h3>
                <p className="opacity-70" dir="ltr">
                  {text.emailAddress}
                </p>
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="p-6 bg-[var(--cool-gray)] hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] transition-colors group">
            <div className="flex items-start gap-4">
              <MapPin size={24} className="flex-shrink-0 mt-1" />
              <div>
                <h3 className="mb-2">{text.location}</h3>
                <p className="opacity-70">{text.address}</p>
              </div>
            </div>
          </div>

          {/* Hours */}
          <div className="p-6 border-2 border-[var(--matte-black)] mt-8">
            <h3 className="mb-2 text-[var(--matte-black)]">{text.hours}</h3>
            <p className="text-[var(--matte-black)] opacity-70">{text.hoursText}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
