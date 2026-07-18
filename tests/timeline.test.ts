import { describe, expect, it } from "vitest";
import { curateReplayEvents, normalizeScoreEvents, scoreAt, visibleAt } from "../src/timeline";
import type { RawScoreEvent, ReplayMatch } from "../src/types";

const match: ReplayMatch = {
  fixtureId: "18241006",
  competition: "Teste",
  startTime: 1_000_000,
  participant1: { id: "1", name: "Azul", side: "participant1" },
  participant2: { id: "2", name: "Dourado", side: "participant2" },
  participant1IsHome: true,
};

function row(seq: number, ts: number, action = "goal"): RawScoreEvent {
  return {
    FixtureId: 18241006,
    Seq: seq,
    Ts: ts,
    Action: action,
    ScoreSoccer: {
      Participant1: { Total: { Goals: seq } },
      Participant2: { Total: { Goals: 0 } },
    },
    DataSoccer: { Minutes: seq * 10, Participant: 1 },
  };
}

describe("official participant-nested score normalization", () => {
  it("rejects score rows that are missing or mismatch the selected fixture", () => {
    const wrongFixture = row(1, 1_100_000);
    wrongFixture.FixtureId = 99999999;
    const missingFixture = row(2, 1_200_000);
    delete missingFixture.FixtureId;
    const result = normalizeScoreEvents([wrongFixture, missingFixture], match);
    expect(result.events).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(["fixture_mismatch", "fixture_mismatch"]);
  });

  it("maps top-level Participant side 1/2 to the selected match teams and identity", () => {
    const realIds: ReplayMatch = {
      ...match,
      participant1: { ...match.participant1, id: "901" },
      participant2: { ...match.participant2, id: "902" },
    };
    const participant2 = row(2, 1_200_000);
    participant2.Participant = 2;
    participant2.DataSoccer = { Minutes: 84 };
    const participant1Variant = { ...participant2, Participant: 1 };
    const result = normalizeScoreEvents([participant2, participant1Variant], realIds);
    expect(result.events[0]).toMatchObject({ participantId: "902", participantName: "Dourado", corrected: true });
    expect(result.issues.map((issue) => issue.code)).toContain("seq_conflict");
  });

  it("orders primarily by seq and maps both participant totals", () => {
    const result = normalizeScoreEvents([row(2, 1_200_000), row(1, 1_300_000)], match);
    expect(result.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(result.events[1].score).toEqual({ participant1: 2, participant2: 0 });
    expect(result.events[1].participantName).toBe("Azul");
  });

  it("does not misread the retired aggregate-only fake schema", () => {
    const aggregate = row(1, 1_100_000);
    aggregate.ScoreSoccer = { Total: { Goals: 9 } };
    const result = normalizeScoreEvents([aggregate], match);
    expect(result.events[0].score).toBeNull();
  });

  it("accepts the live historical Score alias while preserving participant nesting", () => {
    const liveHistorical = row(2, 1_200_000);
    liveHistorical.Score = liveHistorical.ScoreSoccer;
    delete liveHistorical.ScoreSoccer;
    liveHistorical.Data = liveHistorical.DataSoccer;
    delete liveHistorical.DataSoccer;
    const result = normalizeScoreEvents([liveHistorical], match);
    expect(result.events[0].score).toEqual({ participant1: 2, participant2: 0 });
    expect(result.events[0].participantName).toBe("Azul");
  });

  it("prefers complete official Stats 1/2 over a sparse live Score update", () => {
    const sparse = row(2, 1_200_000);
    sparse.Score = {
      Participant1: { Total: { Goals: 9 } },
    };
    delete sparse.ScoreSoccer;
    sparse.Stats = { "1": 0, "2": 1 };
    const result = normalizeScoreEvents([sparse], match);
    expect(result.events[0].score).toEqual({ participant1: 0, participant2: 1 });
  });

  it("uses the live feed clock and honest phase fallbacks instead of delivery timestamps", () => {
    const kickoff = row(1, 1_000_000, "kickoff");
    kickoff.DataSoccer = undefined;
    kickoff.Clock = { Seconds: 0 };
    const halftime = row(2, 4_060_000, "halftime_finalised");
    halftime.DataSoccer = undefined;
    const goal = row(3, 4_300_000, "goal");
    goal.DataSoccer = undefined;
    goal.Clock = { Seconds: 3_300 };
    const final = row(4, 9_040_000, "game_finalised");
    final.DataSoccer = undefined;
    const result = normalizeScoreEvents([kickoff, halftime, goal, final], match);
    expect(result.events.map((event) => event.minute)).toEqual([0, 45, 55, 90]);
  });

  it("collapses identical deliveries but surfaces conflicting same-seq corrections", () => {
    const original = row(2, 1_200_000);
    const corrected = row(2, 1_300_000);
    corrected.ScoreSoccer = {
      Participant1: { Total: { Goals: 1 } },
      Participant2: { Total: { Goals: 1 } },
    };
    const result = normalizeScoreEvents([row(1, 1_100_000), original, { ...original }, corrected], match);
    expect(result.events).toHaveLength(2);
    expect(result.events[1].corrected).toBe(true);
    expect(result.events[1].ts).toBe(1_300_000);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["duplicate", "seq_conflict"]));
  });

  it("surfaces malformed and explicit correction rows", () => {
    const malformed: RawScoreEvent = { Seq: 0, Action: "goal" };
    const amend = row(3, 1_400_000, "amend");
    const result = normalizeScoreEvents([malformed, amend], match);
    expect(result.issues.map((issue) => issue.code)).toEqual(["fixture_mismatch", "correction"]);
  });

  it("reveals only events at the playhead and derives the then-current score", () => {
    const result = normalizeScoreEvents([row(1, 1_000_000, "kick_off"), row(2, 1_100_000), row(3, 1_200_000, "game_finalised")], match);
    expect(visibleAt(result.events, 0)).toHaveLength(1);
    expect(visibleAt(result.events, 10_000)).toHaveLength(2);
    expect(scoreAt(result.events, 10_000)).toEqual({ participant1: 2, participant2: 0 });
  });

  it("curates telemetry into score-changing match milestones and recomputes playback", () => {
    const raw = [
      row(1, 1_000_000, "kickoff"),
      row(2, 1_001_000, "kickoff"),
      row(3, 1_010_000, "attack_possession"),
      row(4, 1_020_000, "goal"),
      row(5, 1_030_000, "goal"),
      row(6, 1_031_000, "goal"),
      row(7, 1_040_000, "yellow_card"),
      row(8, 1_041_000, "yellow_card"),
      row(9, 1_100_000, "game_finalised"),
    ];
    raw.forEach((event) => { event.Stats = { "1": 0, "2": 0 }; });
    raw[4].Stats = { "1": 1, "2": 0 };
    raw[5].Stats = { "1": 1, "2": 0 };
    raw[6].Stats = { "1": 1, "2": 0 };
    raw[7].Stats = { "1": 1, "2": 0 };
    raw[8].Stats = { "1": 1, "2": 0 };
    raw[6].DataSoccer = { Minutes: 40, Participant: 1 };
    raw[7].DataSoccer = { Minutes: 40, Participant: 1 };
    const normalized = normalizeScoreEvents(raw, match).events;
    const curated = curateReplayEvents(normalized);
    expect(curated.map((event) => event.action)).toEqual(["kickoff", "goal", "yellow_card", "game_finalised"]);
    expect(curated[1].score).toEqual({ participant1: 1, participant2: 0 });
    expect(curated[0].playbackMs).toBe(0);
    expect(curated[curated.length - 1]?.playbackMs).toBe(20_000);
    expect(curated[1].playbackMs).toBeGreaterThan(0);
    expect(curated[1].playbackMs).toBeLessThan(20_000);
  });

  it("keeps the first goal when no kickoff row is available", () => {
    const firstGoal = row(10, 1_100_000, "goal");
    firstGoal.Stats = { "1": 1, "2": 0 };
    const final = row(11, 1_200_000, "game_finalised");
    final.Stats = { "1": 1, "2": 0 };
    const curated = curateReplayEvents(normalizeScoreEvents([firstGoal, final], match).events);
    expect(curated.map((event) => event.action)).toEqual(["goal", "game_finalised"]);
    expect(curated[0].playbackMs).toBeGreaterThan(0);
  });

  it("projects decreasing delivery timestamps without revealing future results at zero", () => {
    const kickoff = row(1, 1_300_000, "kickoff");
    kickoff.Stats = { "1": 0, "2": 0 };
    const goal = row(2, 1_200_000, "goal");
    goal.Stats = { "1": 1, "2": 0 };
    const final = row(3, 1_100_000, "game_finalised");
    final.Stats = { "1": 1, "2": 0 };
    const curated = curateReplayEvents(normalizeScoreEvents([kickoff, goal, final], match).events);
    expect(curated.map((event) => event.playbackMs)).toEqual([...curated.map((event) => event.playbackMs)].sort((a, b) => a - b));
    expect(visibleAt(curated, 0).map((event) => event.action)).toEqual(["kickoff"]);
    expect(curated.find((event) => event.action === "goal")?.playbackMs).toBeGreaterThan(0);
    expect(curated.find((event) => event.action === "game_finalised")?.playbackMs).toBe(20_000);
  });
});
