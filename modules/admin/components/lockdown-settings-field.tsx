"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MAX_ALLOWED_LEAVES } from "@/lib/lockdown";

/** Lockdown (exam mode) switch + allowed-leaves input, shared by the create form and the editor. */
export function LockdownSettingsField({
  idPrefix,
  enabled,
  allowedLeaves,
  onEnabledChange,
  onAllowedLeavesChange,
  isFreeMock,
  locked,
  error,
}: {
  idPrefix: string;
  enabled: boolean;
  allowedLeaves: string;
  onEnabledChange: (enabled: boolean) => void;
  onAllowedLeavesChange: (value: string) => void;
  isFreeMock: boolean;
  /** True once attempts exist (settings would change running attempts). */
  locked: boolean;
  error?: string;
}) {
  const disabled = isFreeMock || locked;

  return (
    <div className="space-y-3 border px-3 py-2.5 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor={`${idPrefix}-lockdown`}>Lockdown (exam mode)</Label>
          <p className="text-xs text-muted-foreground">
            Students take the exam in fullscreen. Leaving the window (tab
            switch, other app, exiting fullscreen, refresh) counts as a leave;
            more than the allowed number cancels the attempt. A deterrent, not
            a guarantee.
            {isFreeMock ? " Not available for free mocks." : ""}
            {locked ? " Locked: students have already started attempts." : ""}
          </p>
        </div>
        <Switch
          id={`${idPrefix}-lockdown`}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
        />
      </div>

      {enabled ? (
        <div className="flex items-center gap-3">
          <Label
            htmlFor={`${idPrefix}-allowed-leaves`}
            className="text-xs text-muted-foreground"
          >
            Allowed leaves (0 = cancel immediately)
          </Label>
          <Input
            id={`${idPrefix}-allowed-leaves`}
            type="number"
            min={0}
            max={MAX_ALLOWED_LEAVES}
            className="h-8 w-20"
            value={allowedLeaves}
            disabled={disabled}
            onChange={(event) => onAllowedLeavesChange(event.target.value)}
          />
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
