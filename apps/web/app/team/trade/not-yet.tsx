import { phaseReached, type PhaseCode } from "@msim/engine";
import { Panel } from "@/components/ui/ui";

/** Before 02:15 the trading screens explain Round 3 instead; null once trading has started. */
export function TradingNotYet({ phase, title }: { phase: PhaseCode; title: string }) {
  if (phaseReached(phase, "MARKET_BLIND")) return null;
  return (
    <Panel title={title}>
      <p className="text-sm text-slate-700" data-testid="trading-notice">
        Trading starts after Round 2. Every team gets $50,000, then $1,000 more for each point of its Round 2 score at the 02:45 reveal (a score of 50 makes $100,000 in all). Nine rounds (15 minutes each unless the organisers change it), buy and sell only, at most 5,000 shares of any company, never the
        company you built or the one you rescued. Every order in a round fills at the same new price when the round clears.
      </p>
    </Panel>
  );
}
