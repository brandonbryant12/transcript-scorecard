import { PROVIDER_LABELS, type ScoringProvider } from "@scorecard/domain";

export function ProviderPicker({ provider, onChange, disabled = false }: {
  provider: ScoringProvider;
  onChange: (provider: ScoringProvider) => void;
  disabled?: boolean;
}) {
  return <div className="provider-picker" role="group" aria-label="Scoring provider">
    <span>Scoring provider</span>
    <div>{(["openai", "jev"] as const).map((value) =>
      <button key={value} type="button" aria-pressed={provider === value} disabled={disabled}
        className={provider === value ? "active" : ""} onClick={() => onChange(value)}>
        {PROVIDER_LABELS[value]}
      </button>)}</div>
  </div>;
}
