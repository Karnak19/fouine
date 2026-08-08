import {
  TRIGGER_ACTIONS,
  TRIGGER_LABELS,
  type ReviewTriggers,
  type TriggerAction,
} from "@/lib/api";

// Editor for a ReviewTriggers value. Shared by the global card on the settings
// page and the per-repo override on the repo page, so the two always read the
// same way. Plain-language labels first, the raw GitHub action name second —
// "synchronize" tells nobody that it fires on every push.
export function TriggerFields({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: ReviewTriggers;
  onChange: (next: ReviewTriggers) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const toggleAction = (action: TriggerAction, on: boolean) =>
    onChange({
      ...value,
      actions: on ? [...value.actions, action] : value.actions.filter((a) => a !== action),
    });

  return (
    <div className="space-y-2">
      {TRIGGER_ACTIONS.map((action) => (
        <label
          key={action}
          className="flex items-start gap-2 text-sm text-zinc-300 select-none"
        >
          <input
            id={`${idPrefix}_${action}`}
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-zinc-200"
            disabled={disabled}
            checked={value.actions.includes(action)}
            onChange={(e) => toggleAction(action, e.target.checked)}
          />
          <span>
            {TRIGGER_LABELS[action]}
            <span className="ml-1.5 font-mono text-xs text-zinc-500">{action}</span>
            {action === "synchronize" && (
              <span className="block text-xs text-zinc-500">
                Fires on every push — the main driver of review volume and cost.
              </span>
            )}
          </span>
        </label>
      ))}
      <label className="flex items-start gap-2 text-sm text-zinc-300 select-none">
        <input
          id={`${idPrefix}_drafts`}
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-zinc-200"
          disabled={disabled}
          checked={value.reviewDrafts}
          onChange={(e) => onChange({ ...value, reviewDrafts: e.target.checked })}
        />
        <span>
          Review draft pull requests
          <span className="block text-xs text-zinc-500">
            Off by default. With it off, a PR opened as a draft waits until it's marked ready.
          </span>
        </span>
      </label>
    </div>
  );
}
