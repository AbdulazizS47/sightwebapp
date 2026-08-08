import { ArrowLeft, ArrowUpRight, Instagram, MapPin, MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiBaseUrl } from '../utils/api';

interface ContactPageProps {
  onBack: () => void;
  language: 'en' | 'ar';
}

export function ContactPage({ onBack, language }: ContactPageProps) {
  const [hoursEn, setHoursEn] = useState('Daily: 4:00 PM - 2:00 AM');
  const [hoursAr, setHoursAr] = useState('يوميًا: ٤:٠٠ مساءً - ٢:٠٠ صباحًا');

  const content = {
    en: {
      title: 'Contact Us',
      subtitle: 'Get in touch with our team',
      instagram: 'Instagram',
      whatsapp: 'WhatsApp',
      location: 'Location',
      instagramHandle: 'sightcafee',
      instagramUrl: 'https://www.instagram.com/sightcafee/',
      whatsappLabel: 'Message us directly',
      whatsappUrl: 'https://wa.me/message/XSELOLSOUUHPM1',
      address: 'Al Hofuf, Saudi Arabia',
      locationUrl: 'https://maps.app.goo.gl/XNoBCTw3PpgcMCrRA?g_st=ic',
      hours: 'Hours',
      hoursText: hoursEn,
    },
    ar: {
      title: 'تواصل معنا',
      subtitle: 'تواصل مع فريقنا',
      instagram: 'انستغرام',
      whatsapp: 'واتساب',
      location: 'الموقع',
      instagramHandle: 'sightcafee',
      instagramUrl: 'https://www.instagram.com/sightcafee/',
      whatsappLabel: 'راسلنا مباشرة',
      whatsappUrl: 'https://wa.me/message/XSELOLSOUUHPM1',
      address: 'الحسا حساك لو الدهر .. ؟',
      locationUrl: 'https://maps.app.goo.gl/XNoBCTw3PpgcMCrRA?g_st=ic',
      hours: 'ساعات العمل',
      hoursText: hoursAr,
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';
  const cardClass =
    'group block border-2 border-transparent bg-[var(--cool-gray)] p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--matte-black)] hover:bg-[var(--crisp-white)] hover:shadow-[0_16px_32px_rgba(0,0,0,0.08)] active:translate-y-0';
  const cardRowClass = `flex items-start justify-between gap-4 ${isRTL ? 'flex-row-reverse' : ''}`;
  const cardIconClass =
    'mt-1 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-[var(--matte-black)]/10 bg-[var(--crisp-white)] transition-colors duration-200 group-hover:bg-[var(--matte-black)] group-hover:text-[var(--crisp-white)]';
  const cardActionClass =
    'mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[var(--matte-black)]/15 bg-[var(--crisp-white)] text-[var(--matte-black)] transition-all duration-200 group-hover:border-[var(--matte-black)] group-hover:bg-[var(--matte-black)] group-hover:text-[var(--crisp-white)]';

  useEffect(() => {
    let mounted = true;
    fetch(`${apiBaseUrl}/settings/public`)
      .then((res) => res.json())
      .then((data) => {
        if (!mounted || !data?.success) return;
        if (data?.hours?.en) setHoursEn(String(data.hours.en));
        if (data?.hours?.ar) setHoursAr(String(data.hours.ar));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

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
          {/* Instagram */}
          <a
            className={cardClass}
            href={text.instagramUrl}
            target="_blank"
            rel="noreferrer"
          >
            <div className={cardRowClass}>
              <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                <div className={cardIconClass}>
                  <Instagram size={24} />
                </div>
                <div>
                  <h3 className="mb-2 text-xl text-[var(--matte-black)]">{text.instagram}</h3>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--espresso-brown)]">
                    {language === 'ar' ? 'افتح الرابط' : 'Open link'}
                  </p>
                  <p className="mt-2 opacity-70" dir="ltr">
                    {text.instagramHandle}
                  </p>
                </div>
              </div>
              <div className={cardActionClass}>
                <ArrowUpRight size={18} className={isRTL ? 'rotate-180' : ''} />
              </div>
            </div>
          </a>

          {/* WhatsApp */}
          <a
            className={cardClass}
            href={text.whatsappUrl}
            target="_blank"
            rel="noreferrer"
          >
            <div className={cardRowClass}>
              <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                <div className={cardIconClass}>
                  <MessageCircle size={24} />
                </div>
                <div>
                  <h3 className="mb-2 text-xl text-[var(--matte-black)]">{text.whatsapp}</h3>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--espresso-brown)]">
                    {language === 'ar' ? 'ابدأ المحادثة' : 'Start chat'}
                  </p>
                  <p className="mt-2 opacity-70" dir="ltr">
                    {text.whatsappLabel}
                  </p>
                </div>
              </div>
              <div className={cardActionClass}>
                <ArrowUpRight size={18} className={isRTL ? 'rotate-180' : ''} />
              </div>
            </div>
          </a>

          {/* Location */}
          <a
            className={cardClass}
            href={text.locationUrl}
            target="_blank"
            rel="noreferrer"
          >
            <div className={cardRowClass}>
              <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                <div className={cardIconClass}>
                  <MapPin size={24} />
                </div>
                <div>
                  <h3 className="mb-2 text-xl text-[var(--matte-black)]">{text.location}</h3>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--espresso-brown)]">
                    {language === 'ar' ? 'افتح الخريطة' : 'Open map'}
                  </p>
                  <p className="mt-2 opacity-70">{text.address}</p>
                </div>
              </div>
              <div className={cardActionClass}>
                <ArrowUpRight size={18} className={isRTL ? 'rotate-180' : ''} />
              </div>
            </div>
          </a>

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
