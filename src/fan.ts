/** Fan-facing translations: live momentum and plain-language event reads.
 *
 * Pure and DOM-free so the client can render an intuitive "who's on top" meter
 * and explain TxLINE jargon in supporter language. */

import type { Team, TurningPoint } from "./types";

export type MomentumLeader = 0 | 1 | 2;

export interface MarketPosition {
  /** Returned TxLINE percentage expressed on the participant1 side, 0–100. */
  share1: number;
  leader: MomentumLeader;
  dominant: MomentumLeader;
  observedPct: number;
  observedTeam: 1 | 2;
  snapshot: "before" | "after";
}

function normalizedName(value: string | null): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Position the meter only from the comparable odds outcome returned by
 * TxLINE. A score or event never changes this value. If the returned outcome
 * cannot be tied to either participant, callers must render no meter. */
export function computeMarketPosition(
  turningPoint: TurningPoint | null,
  p1: Team,
  p2: Team,
  playheadMs: number,
): MarketPosition | null {
  if (!turningPoint) return null;
  const outcome = normalizedName(turningPoint.movement.tuple.priceName);
  const observedTeam = outcome === normalizedName(p1.name)
    ? 1
    : outcome === normalizedName(p2.name)
      ? 2
      : null;
  if (observedTeam === null) return null;
  const snapshot = playheadMs < turningPoint.playbackMs ? "before" : "after";
  const observedPct = turningPoint.movement[snapshot].pct;
  if (!Number.isFinite(observedPct) || observedPct < 0 || observedPct > 100) return null;
  const share1 = Math.round((observedTeam === 1 ? observedPct : 100 - observedPct) * 1_000) / 1_000;
  let leader: MomentumLeader = 0;
  if (Math.abs(share1 - 50) >= 6) leader = share1 > 50 ? 1 : 2;
  let dominant: MomentumLeader = 0;
  if (share1 >= 62) dominant = 1;
  else if (share1 <= 38) dominant = 2;
  return { share1, leader, dominant, observedPct, observedTeam, snapshot };
}

type Lang = "pt-BR" | "en";

const FAN_READS: Record<Lang, Record<string, string>> = {
  "pt-BR": {
    kick_off: "Bola rolando.",
    kickoff: "Bola rolando.",
    goal: "Gol! O placar muda.",
    own_goal: "Gol contra — presente para o adversário.",
    goal_cancelled: "Gol anulado pelo VAR.",
    yellow_card: "Cartão amarelo: alerta para o jogador.",
    red_card: "Expulsão! O time fica com um a menos.",
    penalty: "Pênalti marcado.",
    penalty_missed: "Pênalti perdido — chance desperdiçada.",
    shot_on_target: "Finalização perigosa, o goleiro trabalha.",
    shot: "Finalização.",
    corner: "Escanteio.",
    foul: "Falta cometida.",
    free_kick: "Tiro livre.",
    offside: "Impedimento assinalado.",
    substitution: "Substituição feita.",
    throw_in: "Lateral.",
    injury: "Atendimento médico em campo.",
    var_start: "VAR entrando em ação.",
    var_end: "Decisão do VAR confirmada.",
    period_start: "Voltam a jogar.",
    period_end: "Fim de período.",
    halftime_finalised: "Intervalo — respira fundo.",
    game_finalised: "Fim de jogo!",
    amend: "Correção de lance aplicada.",
  },
  en: {
    kick_off: "Kick-off.",
    kickoff: "Kick-off.",
    goal: "Goal! The score changes.",
    own_goal: "Own goal — a gift for the other side.",
    goal_cancelled: "Goal ruled out by VAR.",
    yellow_card: "Yellow card: a warning for the player.",
    red_card: "Sent off! That side is down to ten.",
    penalty: "Penalty awarded.",
    penalty_missed: "Penalty missed — chance wasted.",
    shot_on_target: "A dangerous strike, the keeper saves.",
    shot: "A shot.",
    corner: "Corner kick.",
    foul: "A foul given away.",
    free_kick: "Free kick.",
    offside: "Offside flagged.",
    substitution: "A substitution made.",
    throw_in: "Throw-in.",
    injury: "Treatment on the pitch.",
    var_start: "VAR is taking a look.",
    var_end: "The VAR decision is in.",
    period_start: "Back under way.",
    period_end: "End of a period.",
    halftime_finalised: "Half-time — catch your breath.",
    game_finalised: "Full-time!",
    amend: "A correction to the play.",
  },
};

export function fanRead(action: string, lang: Lang): string {
  return FAN_READS[lang][action] ?? (lang === "pt-BR" ? "Lance registrado." : "Play logged.");
}

export function insightFanRead(direction: "up" | "down", teamName: string, lang: Lang): string {
  const team = teamName.trim() || (lang === "pt-BR" ? "O time" : "The team");
  if (direction === "up") {
    return lang === "pt-BR"
      ? `Para o torcedor: o mercado agora aposta forte no ${team}.`
      : `For fans: the market now strongly backs ${team}.`;
  }
  return lang === "pt-BR"
    ? `Para o torcedor: o mercado esfriou o ${team}.`
    : `For fans: the market cooled on ${team}.`;
}
