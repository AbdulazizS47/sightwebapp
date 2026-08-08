import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import logoImage from 'figma:asset/6a698afc3834913c1c2ac422fa5bd04b815dc28c.png';
import { apiBaseUrl } from '../utils/api';

interface LandingPageProps {
  onNavigate: (...args: ['menu' | 'contact']) => void;
  onAdminNavigate?: (mode: 'edit' | 'order') => void;
  isAdmin?: boolean;
  language: 'en' | 'ar';
}

export function LandingPage({ onNavigate, onAdminNavigate, isAdmin, language }: LandingPageProps) {
  const [openStatus, setOpenStatus] = useState(true);
  const [hoursEn, setHoursEn] = useState('Daily: 4:00 PM - 2:00 AM');
  const [hoursAr, setHoursAr] = useState('يوميًا: ٤:٠٠ مساءً - ٢:٠٠ صباحًا');

  const content = {
    en: {
      header: 'SIGHT',
      tagline: (
        <>
          OUT OF SIGHT,
          <br />
          ALWAYS ON YOUR SIDE
        </>
      ),
      viewMenu: 'MENU',
      pickUp: 'Pick Up Order',
      contact: 'Contact Us',
      adminEdit: 'Edit Items',
      adminOrder: 'Register Orders',
      openNow: 'Open now',
      closed: 'Closed',
    },
    ar: {
      header: 'سايت',
      tagline: (
        <>
          أطلب
          <br />
          واستلم على طريقك
        </>
      ),
      viewMenu: 'القائمة',
      pickUp: 'طلب استلام',
      contact: 'تواصل معنا',
      adminEdit: 'تعديل الأصناف',
      adminOrder: 'تسجيل الطلبات',
      openNow: 'مفتوح الآن',
      closed: 'مغلق',
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';
  const hoursText = language === 'ar' ? hoursAr : hoursEn;
  const buttonBaseClass =
    'group w-full border-2 px-6 py-4 text-center transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(0,0,0,0.12)] active:translate-y-0 active:shadow-[0_6px_14px_rgba(0,0,0,0.12)]';
  const buttonContentClass = 'flex items-center justify-center gap-4';
  const buttonLabelClass = 'flex-1 text-center tracking-[0.22em]';

  useEffect(() => {
    let mounted = true;
    const loadSettings = () => {
      fetch(`${apiBaseUrl}/settings/public`)
        .then((res) => res.json())
        .then((data) => {
          if (!mounted || !data?.success) return;
          if (typeof data.isOpen === 'boolean') setOpenStatus(data.isOpen);
          if (data?.hours?.en) setHoursEn(String(data.hours.en));
          if (data?.hours?.ar) setHoursAr(String(data.hours.ar));
        })
        .catch(() => {});
    };
    loadSettings();
    const interval = window.setInterval(loadSettings, 60000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div
      className="min-h-screen bg-[var(--crisp-white)] flex flex-col items-center justify-center px-6 py-8 relative overflow-hidden"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center -mt-16">
        {/* Bilingual Logo - SIGHT / سايت */}
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="mb-4"
        >
          <img src={logoImage} alt="SIGHT / سايت" className="w-full max-w-sm mx-auto" />
        </motion.div>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          className={`text-center mb-12 text-[var(--matte-black)] opacity-70 ${
            language === 'ar' ? 'text-base md:text-lg' : 'text-sm md:text-base'
          }`}
        >
          {text.tagline}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25, ease: 'easeOut' }}
          className="mb-8 flex items-center gap-2 text-[var(--matte-black)] opacity-80 text-sm"
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              display: 'inline-block',
              backgroundColor: openStatus ? '#16a34a' : '#9ca3af',
            }}
          />
          <span>
            {openStatus ? text.openNow : text.closed} • {hoursText}
          </span>
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' }}
          className="flex flex-col gap-3 w-full max-w-sm"
        >
          {isAdmin && onAdminNavigate ? (
            <>
              <button
                onClick={() => onAdminNavigate('edit')}
                className={`${buttonBaseClass} bg-[var(--matte-black)] text-[var(--crisp-white)] border-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:border-[var(--espresso-brown)]`}
              >
                <span className={buttonContentClass}>
                  <span className={buttonLabelClass}>{text.adminEdit}</span>
                </span>
              </button>
              <button
                onClick={() => onAdminNavigate('order')}
                className={`${buttonBaseClass} bg-[var(--espresso-brown)] text-[var(--crisp-white)] border-[var(--espresso-brown)] hover:bg-[var(--matte-black)] hover:border-[var(--matte-black)]`}
              >
                <span className={buttonContentClass}>
                  <span className={buttonLabelClass}>{text.adminOrder}</span>
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onNavigate('menu')}
                className={`${buttonBaseClass} bg-[var(--matte-black)] text-[var(--crisp-white)] border-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:border-[var(--espresso-brown)]`}
              >
                <span className={buttonContentClass}>
                  <span className={buttonLabelClass}>{text.viewMenu}</span>
                </span>
              </button>

              <button
                onClick={() => onNavigate('menu')}
                className={`${buttonBaseClass} bg-[var(--espresso-brown)] text-[var(--crisp-white)] border-[var(--espresso-brown)] hover:bg-[var(--matte-black)] hover:border-[var(--matte-black)]`}
              >
                <span className={buttonContentClass}>
                  <span className={buttonLabelClass}>{text.pickUp}</span>
                </span>
              </button>
            </>
          )}

          <button
            onClick={() => onNavigate('contact')}
            className={`${buttonBaseClass} bg-transparent text-[var(--matte-black)] border-[var(--matte-black)] hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)]`}
          >
            <span className={buttonContentClass}>
              <span className={buttonLabelClass}>{text.contact}</span>
            </span>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
