import logoImage from 'figma:asset/6a698afc3834913c1c2ac422fa5bd04b815dc28c.png';

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 200, className = '' }: LogoProps) {
  return (
    <img
      src={logoImage}
      alt="SIGHT / سايت"
      className={className}
      style={{ width: size, height: 'auto' }}
    />
  );
}
