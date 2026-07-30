export function RiskManagementGlyph() {
  return (
    <svg
      viewBox="0 0 260 130"
      width="100%"
      height={130}
      role="img"
      aria-label="Automated risk management keeps borrowing below the vault limit"
    >
      <path
        d="M130 15 184 34v35c0 27-21 43-54 53-33-10-54-26-54-53V34l54-19Z"
        fill="rgba(87,198,255,0.11)"
        stroke="#57c6ff"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      <path d="m108 68 14 14 31-34" fill="none" stroke="#5be8b5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="34" y1="112" x2="226" y2="112" stroke="rgba(190,172,255,0.32)" />
      <circle cx="179" cy="112" r="7" fill="#5be8b5" />
      <line x1="202" y1="102" x2="202" y2="122" stroke="#ffb75c" strokeWidth="2" />
      <text x="202" y="96" fill="#ffb75c" fontSize="9" textAnchor="middle" fontFamily="ui-monospace, monospace">LIMIT</text>
    </svg>
  );
}
