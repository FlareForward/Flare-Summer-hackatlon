type Props = {
  variant: 'centered' | 'drifted';
};

export function RangeGlyph({ variant }: Props) {
  const drifted = variant === 'drifted';

  return (
    <svg
      viewBox="0 0 260 130"
      width="100%"
      height={drifted ? 130 : 108}
      role="img"
      aria-label={drifted ? 'Money drifting out of its earning zone' : 'Your position sitting comfortably in its earning zone'}
    >
      <rect x="14" y="42" width="232" height="38" rx="10" fill="#57c6ff" opacity="0.13" />
      <rect x="14" y="42" width="232" height="38" rx="10" fill="none" stroke="#57c6ff" strokeOpacity="0.48" />
      <line x1="14" y1="102" x2="246" y2="102" stroke="rgba(190,172,255,0.32)" strokeWidth="1" />
      {drifted ? (
        <>
          <line x1="205" y1="80" x2="205" y2="98" stroke="#ffb75c" strokeWidth="1.5" strokeDasharray="3 3" />
          <circle cx="205" cy="104" r="7" fill="#ffb75c" />
        </>
      ) : (
        <>
          <circle cx="150" cy="61" r="7" fill="#5be8b5" />
          <circle cx="150" cy="61" r="12" fill="none" stroke="#5be8b5" strokeOpacity="0.4" />
        </>
      )}
    </svg>
  );
}
