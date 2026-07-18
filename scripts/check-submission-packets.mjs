import { readFile } from "node:fs/promises";

const paths = ["docs/SUBMISSION_GLOBAL.md", "docs/SUBMISSION_BRASIL.md"];
const [globalPacket, brasilPacket] = await Promise.all(paths.map((path) => readFile(path, "utf8")));
const packets = [globalPacket, brasilPacket];
const urlNames = ["LIVE_URL", "VIDEO_URL", "REPO_URL"];

for (const name of urlNames) {
  const values = packets.map((packet, index) => {
    const match = packet.match(new RegExp("^- `" + name + "`: (.+)$", "m"));
    if (!match) throw new Error(`${paths[index]} does not define ${name}.`);
    return match[1];
  });
  if (values[0] !== values[1]) throw new Error(`${name} differs between the Global and Brasil packets.`);
  if (process.env.SUBMISSION_FINAL === "1" && values[0].includes("[REQUIRED")) {
    throw new Error(`${name} is still a placeholder.`);
  }
}

for (const forbidden of ["/odds/updates/", "Live mode exists", "Modo ao vivo existe", "GitHub Pages"]) {
  if (packets.some((packet) => packet.includes(forbidden))) {
    throw new Error(`Submission packet contains stale claim: ${forbidden}`);
  }
}
if (!globalPacket.includes("Submit this form **first**")) throw new Error("Global-first order is missing.");
if (!brasilPacket.includes("CONFIRMAÇÃO EXPLÍCITA DE DUPLA SUBMISSÃO")) {
  throw new Error("Brasil double-submission declaration is missing.");
}
if ((globalPacket.match(/^### \d+\./gm) ?? []).length !== 12) throw new Error("Global packet is not field-complete.");
if ((brasilPacket.match(/^### \d+\./gm) ?? []).length !== 9) throw new Error("Brasil packet is not field-complete.");

process.stdout.write("SUBMISSION PACKETS OK: current fields, identical URL set, Global-first order, and explicit Brasil double submission.\n");
