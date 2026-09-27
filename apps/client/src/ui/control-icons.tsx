export function MouseButtonIcon({ button = 'left' }: { button?: 'left' | 'right' }) {
  const isLeft = button === 'left';
  return (
    <svg className="control-icon control-icon--mouse" viewBox="0 0 28 38" aria-hidden="true">
      <path d="M5 14V9a9 9 0 0 1 18 0v5" />
      <path className={isLeft ? 'control-icon__active' : undefined} d="M5 14h9V2A9 9 0 0 0 5 11Z" />
      <path
        className={!isLeft ? 'control-icon__active' : undefined}
        d="M14 2v12h9v-3a9 9 0 0 0-9-9Z"
      />
      <rect x="5" y="14" width="18" height="21" rx="8" />
      <path d="M14 6v4" />
    </svg>
  );
}

export function KeyboardKeyIcon({ keyLabel }: { keyLabel: string }) {
  return (
    <span className="control-icon control-icon--key" aria-hidden="true">
      {keyLabel}
    </span>
  );
}
